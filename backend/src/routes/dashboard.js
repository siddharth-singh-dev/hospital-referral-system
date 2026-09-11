import express from "express";
import prisma from "../utils/prismaClient.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { istDateString, startOfIstDay, startOfIstWeek, startOfIstMonth } from "../utils/istDate.js";

const router = express.Router();

// Windows offered by the period toggle on the "Top-performing doctors", "Top-performing
// Marketing Emp", and "Pending redemptions" cards.
const PERIODS = { week: 7, month: 30, "3months": 90, "6months": 180, year: 365 };

// Windows shown side-by-side (not toggled) on the "Marketing employee comparison" table and
// its pie charts, plus the per-slice referral drill-down below.
const COMPARISON_PERIODS = { week: 7, fortnight: 14, month: 30, "3months": 90, "6months": 180 };

function withinPeriod(date, days) {
  return new Date(date).getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

// Calendar-week (Monday-start) and calendar-month buckets, in IST, oldest first, for the
// "New leaders" growth chart. The most recent bucket is always the current (possibly
// partial — e.g. "this week" might only be 2 days old so far) period, by design: it's the
// one the headline comparison cares about, and a partial current period vs. a full prior one
// is a normal, well-understood way to read a growth chart (like any analytics dashboard).
function buildWeeklyBuckets(count) {
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = startOfIstWeek(i);
    const end = startOfIstWeek(i - 1);
    buckets.push({ label: istDateString(start), start, end });
  }
  return buckets;
}
function buildMonthlyBuckets(count) {
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = startOfIstMonth(i);
    const end = startOfIstMonth(i - 1);
    // `start` is already "IST midnight" as a UTC instant (e.g. Aug 1 00:00 IST == Jul 31
    // 18:30 UTC) — shifting it by the IST offset again turns it into a value whose UTC
    // calendar fields read correctly as the IST wall-clock date, the same trick istDateString
    // uses. Formatting with `timeZone: "UTC"` directly would read the pre-shift UTC date and
    // land a month early.
    const shifted = new Date(start.getTime() + 5.5 * 60 * 60 * 1000);
    const label = `${MONTH_NAMES[shifted.getUTCMonth()]} ${String(shifted.getUTCFullYear()).slice(-2)}`;
    buckets.push({ label, start, end });
  }
  return buckets;
}

// GET /api/dashboard/summary  (admin only) — everything the Admin Dashboard home page needs
// in one call: KPI counts, a 14-day referral trend, top doctors, top marketing employees,
// pending redemptions grouped by doctor, and a full marketing-employee comparison table
// across 5 fixed windows — plus recent referrals.
router.get("/summary", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const hospitalId = req.user.hospitalId;

  const [doctors, referrals, transactions, marketingPersons] = await Promise.all([
    prisma.doctor.findMany({ where: { hospitalId }, select: { id: true, name: true, clinicName: true, active: true, createdAt: true } }),
    prisma.referral.findMany({
      where: { doctor: { hospitalId } },
      select: {
        id: true, patientName: true, patientAge: true, patientGender: true, status: true, createdAt: true, rejectedReason: true,
        doctor: { select: { id: true, name: true, clinicName: true, marketingPersonId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.creditTransaction.findMany({
      where: { doctor: { hospitalId } },
      select: {
        id: true, amount: true, redeemed: true, createdAt: true,
        doctor: { select: { id: true, name: true, clinicName: true, creditAmount: true } },
        referral: { select: { id: true, patientName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.marketingPerson.findMany({ where: { hospitalId }, select: { id: true, name: true } }),
  ]);

  const totalDoctors = doctors.length;
  const activeDoctors = doctors.filter((d) => d.active).length;
  const totalReferrals = referrals.length;
  const pendingReferrals = referrals.filter((r) => r.status === "PENDING").length;
  const totalCreditsRedeemed = transactions.filter((t) => t.redeemed).reduce((s, t) => s + Number(t.amount), 0);
  const totalPendingPayouts = transactions.filter((t) => !t.redeemed).reduce((s, t) => s + Number(t.amount), 0);

  // 14-day referral trend, bucketed by IST calendar day (independent of server timezone)
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = startOfIstDay(i);
    const dayLabel = istDateString(dayStart);
    const count = referrals.filter((r) => istDateString(r.createdAt) === dayLabel).length;
    trend.push({ date: dayLabel, count });
  }

  // Top doctors by total credited (redeemed + pending) within the period, by credit date.
  function topDoctorsForPeriod(days) {
    const byDoctor = {};
    for (const t of transactions) {
      if (!withinPeriod(t.createdAt, days)) continue;
      const key = t.doctor.id;
      if (!byDoctor[key]) byDoctor[key] = { id: t.doctor.id, name: t.doctor.name, clinicName: t.doctor.clinicName, total: 0, count: 0 };
      byDoctor[key].total += Number(t.amount);
      byDoctor[key].count += 1;
    }
    return Object.values(byDoctor).sort((a, b) => b.total - a.total).slice(0, 15);
  }
  const topDoctors = Object.fromEntries(Object.entries(PERIODS).map(([key, days]) => [key, topDoctorsForPeriod(days)]));

  // New leaders added, bucketed by calendar week and calendar month — powers the "New
  // leaders" growth card's headline ("this week vs last week") and its trend chart.
  const newLeadersTrend = {
    weekly: buildWeeklyBuckets(8).map((b) => ({
      label: b.label,
      count: doctors.filter((d) => d.createdAt >= b.start && d.createdAt < b.end).length,
    })),
    monthly: buildMonthlyBuckets(6).map((b) => ({
      label: b.label,
      count: doctors.filter((d) => d.createdAt >= b.start && d.createdAt < b.end).length,
    })),
  };

  // Top marketing employees, one ranking per toggle period. "Leads" = referrals brought in
  // by doctors linked to that marketing person (any status); "amount" = the credit points
  // those leads generated (redeemed + pending), both counted by the referral's own date so
  // a lead and its credit land in the same bucket even if the credit posted moments later.
  const marketingPersonMap = new Map(marketingPersons.map((m) => [m.id, m]));
  const creditAmountByReferralId = new Map();
  for (const t of transactions) {
    if (t.referral) creditAmountByReferralId.set(t.referral.id, Number(t.amount));
  }
  function topMarketingForPeriod(days) {
    const byPerson = {};
    for (const r of referrals) {
      if (!withinPeriod(r.createdAt, days)) continue;
      const mpId = r.doctor.marketingPersonId;
      if (!mpId || !marketingPersonMap.has(mpId)) continue;
      if (!byPerson[mpId]) byPerson[mpId] = { id: mpId, name: marketingPersonMap.get(mpId).name, leadsCount: 0, amount: 0 };
      byPerson[mpId].leadsCount += 1;
      byPerson[mpId].amount += creditAmountByReferralId.get(r.id) || 0;
    }
    return Object.values(byPerson).sort((a, b) => b.amount - a.amount).slice(0, 15);
  }
  const topMarketingPersons = Object.fromEntries(Object.entries(PERIODS).map(([key, days]) => [key, topMarketingForPeriod(days)]));

  // Pending redemptions, grouped by doctor (one row per doctor instead of one per patient) so
  // a doctor with many unpaid patients — e.g. "Hospitech" — shows once with a running total.
  // Each group carries its own list of individual pending transactions for the row to expand
  // into on click, without a second request.
  function pendingGroupsForPeriod(days) {
    const byDoctor = {};
    for (const t of transactions) {
      if (t.redeemed || !withinPeriod(t.createdAt, days)) continue;
      const key = t.doctor.id;
      if (!byDoctor[key]) byDoctor[key] = { doctorId: t.doctor.id, doctorName: t.doctor.name, clinicName: t.doctor.clinicName, total: 0, count: 0, transactions: [] };
      byDoctor[key].total += Number(t.amount);
      byDoctor[key].count += 1;
      byDoctor[key].transactions.push({ id: t.id, amount: Number(t.amount), createdAt: t.createdAt, patientName: t.referral?.patientName || null });
    }
    return Object.values(byDoctor).sort((a, b) => b.total - a.total).slice(0, 30);
  }
  const pendingRedemptions = Object.fromEntries(Object.entries(PERIODS).map(([key, days]) => [key, pendingGroupsForPeriod(days)]));

  // Marketing employee comparison table — every marketing person as one row, with leads +
  // credit amount for each of 5 fixed windows as columns, all computed in a single pass over
  // referrals (rather than the once-per-period reduction the toggle cards above use) since
  // every period is shown at once here rather than picked one at a time.
  const comparisonByPerson = new Map(
    marketingPersons.map((m) => [
      m.id,
      { id: m.id, name: m.name, byPeriod: Object.fromEntries(Object.keys(COMPARISON_PERIODS).map((k) => [k, { leadsCount: 0, amount: 0 }])) },
    ])
  );
  for (const r of referrals) {
    const mpId = r.doctor.marketingPersonId;
    const row = mpId && comparisonByPerson.get(mpId);
    if (!row) continue;
    const amount = creditAmountByReferralId.get(r.id) || 0;
    for (const [key, days] of Object.entries(COMPARISON_PERIODS)) {
      if (withinPeriod(r.createdAt, days)) {
        row.byPeriod[key].leadsCount += 1;
        row.byPeriod[key].amount += amount;
      }
    }
  }
  // Busiest employees (by 6-month lead count) first.
  const marketingComparison = Array.from(comparisonByPerson.values()).sort(
    (a, b) => b.byPeriod["6months"].leadsCount - a.byPeriod["6months"].leadsCount
  );

  const recentReferrals = referrals.slice(0, 30);

  // Per-leader and per-marketing-employee performance: lead volume, credited/rejected counts,
  // conversion rate, and the average credit size among referrals that DID convert. That last
  // figure is deliberately not diluted by non-converting leads — conversion rate already
  // covers that — so it answers a different question: "when this person's leads do convert,
  // how big are they typically?" (lots of small Cash-panel patients vs. fewer, bigger
  // insurance ones). All bucketed by the referral's own createdAt, same convention as the
  // marketing comparison table above, and using the same PERIODS toggle as topDoctors/
  // topMarketingPersons so the frontend can reuse one period-switcher component for all of it.
  function performanceForPeriod(days, groupBy) {
    const byEntity = {};
    for (const r of referrals) {
      if (!withinPeriod(r.createdAt, days)) continue;
      let entity;
      if (groupBy === "doctor") {
        entity = { id: r.doctor.id, name: r.doctor.name, clinicName: r.doctor.clinicName };
      } else {
        const mpId = r.doctor.marketingPersonId;
        if (!mpId || !marketingPersonMap.has(mpId)) continue;
        entity = { id: mpId, name: marketingPersonMap.get(mpId).name };
      }
      if (!byEntity[entity.id]) byEntity[entity.id] = { ...entity, totalLeads: 0, credited: 0, rejected: 0, creditedAmount: 0 };
      const row = byEntity[entity.id];
      row.totalLeads += 1;
      if (r.status === "CREDITED") {
        row.credited += 1;
        row.creditedAmount += creditAmountByReferralId.get(r.id) || 0;
      } else if (r.status === "REJECTED") {
        row.rejected += 1;
      }
    }
    return Object.values(byEntity)
      .map((row) => ({
        id: row.id,
        name: row.name,
        clinicName: row.clinicName,
        totalLeads: row.totalLeads,
        credited: row.credited,
        rejected: row.rejected,
        conversionRate: row.totalLeads > 0 ? row.credited / row.totalLeads : 0,
        rejectionRate: row.totalLeads > 0 ? row.rejected / row.totalLeads : 0,
        avgCreditPerLead: row.credited > 0 ? row.creditedAmount / row.credited : null,
      }))
      .sort((a, b) => b.totalLeads - a.totalLeads)
      .slice(0, 20);
  }
  const leaderPerformance = Object.fromEntries(Object.entries(PERIODS).map(([key, days]) => [key, performanceForPeriod(days, "doctor")]));
  const marketingPerformance = Object.fromEntries(Object.entries(PERIODS).map(([key, days]) => [key, performanceForPeriod(days, "marketing")]));

  // Top rejection reasons, normalized by trimming/case-folding so e.g. "Wrong number" and
  // "wrong number " don't split into separate buckets — the reject action is a free-text
  // browser prompt() with no fixed list, so without this every minor typo would count as its
  // own reason. Each normalized bucket displays using whichever exact original casing was
  // typed most often for it, and carries the individual referrals behind it (leader,
  // marketing employee, patient) so a reason can be traced back to whose lead it was.
  function rejectionReasonsForPeriod(days) {
    const buckets = new Map(); // normalized text -> { count, labelCounts: Map<original label, count>, referrals: [] }
    for (const r of referrals) {
      if (r.status !== "REJECTED" || !withinPeriod(r.createdAt, days)) continue;
      const raw = (r.rejectedReason || "").trim();
      const normalized = raw ? raw.toLowerCase().replace(/\s+/g, " ") : "";
      const label = raw || "No reason given";
      if (!buckets.has(normalized)) buckets.set(normalized, { count: 0, labelCounts: new Map(), referrals: [] });
      const bucket = buckets.get(normalized);
      bucket.count += 1;
      bucket.labelCounts.set(label, (bucket.labelCounts.get(label) || 0) + 1);
      const mpId = r.doctor.marketingPersonId;
      bucket.referrals.push({
        id: r.id,
        patientName: r.patientName,
        leaderName: r.doctor.name,
        marketingPersonName: mpId && marketingPersonMap.has(mpId) ? marketingPersonMap.get(mpId).name : null,
        createdAt: r.createdAt,
      });
    }
    return Array.from(buckets.values())
      .map((bucket) => ({
        reason: Array.from(bucket.labelCounts.entries()).sort((a, b) => b[1] - a[1])[0][0],
        count: bucket.count,
        referrals: bucket.referrals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
  const rejectionReasons = Object.fromEntries(Object.entries(PERIODS).map(([key, days]) => [key, rejectionReasonsForPeriod(days)]));

  res.json({
    kpis: {
      totalDoctors,
      activeDoctors,
      totalReferrals,
      pendingReferrals,
      totalCreditsRedeemed,
      totalPendingPayouts,
    },
    trend,
    topDoctors,
    newLeadersTrend,
    topMarketingPersons,
    marketingComparison,
    recentReferrals,
    pendingRedemptions,
    leaderPerformance,
    marketingPerformance,
    rejectionReasons,
  });
});

// GET /api/dashboard/marketing-comparison/:marketingPersonId/referrals?period=week (admin
// only) — drill-down for a slice of the "Marketing employee comparison" pie charts: every
// referral brought in by leaders linked to this marketing person within the given window,
// with enough per-patient detail (file number, admission date, credit status) to fill the
// table that opens when a pie slice is clicked. Same period keys/windows as the comparison
// table itself (COMPARISON_PERIODS above), so a slice and its drill-down always agree.
router.get("/marketing-comparison/:marketingPersonId/referrals", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const days = COMPARISON_PERIODS[req.query.period];
  if (!days) return res.status(400).json({ error: `period must be one of ${Object.keys(COMPARISON_PERIODS).join(", ")}` });

  const hospitalId = req.user.hospitalId;
  const marketingPerson = await prisma.marketingPerson.findFirst({
    where: { id: req.params.marketingPersonId, hospitalId },
  });
  if (!marketingPerson) return res.status(404).json({ error: "Marketing employee not found" });

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const referrals = await prisma.referral.findMany({
    where: {
      createdAt: { gte: cutoff },
      doctor: { hospitalId, marketingPersonId: marketingPerson.id },
    },
    select: {
      id: true,
      fileNumber: true,
      patientName: true,
      createdAt: true,
      status: true,
      transaction: { select: { amount: true, redeemed: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    marketingPersonId: marketingPerson.id,
    marketingPersonName: marketingPerson.name,
    period: req.query.period,
    referrals: referrals.map((r) => ({
      id: r.id,
      fileNumber: r.fileNumber,
      patientName: r.patientName,
      doa: r.createdAt,
      status: r.status,
      // A referral only has a transaction once it's been credited. Split into "paid" vs
      // "pending" here (rather than sending amount + redeemed and letting the frontend
      // figure it out) since that's exactly the two columns the drill-down table needs.
      paidAmount: r.transaction && r.transaction.redeemed ? Number(r.transaction.amount) : null,
      pendingAmount: r.transaction && !r.transaction.redeemed ? Number(r.transaction.amount) : null,
    })),
  });
});

export default router;
