import prisma from "./prismaClient.js";
import { ACTIONS } from "./activityLog.js";
import { istDateString, istDayBounds } from "./istDate.js";

// The Reports section of the admin panel. Every report is a function that takes the chosen date
// range (plus optional filters) and returns the same generic shape, which the screen, the Excel
// export and the PDF export all render from:
//
//   { summary:  [{ label, display, sub? }],                       headline numbers
//     sections: [{ title, note?, columns: [{ key, label, type }],  tables
//                  rows: [{ [key]: rawValue }] }],
//     notes:    [string] }                                        caveats worth knowing
//
// Column types: "text" | "int" | "pct" (a number like 62.5) | "pts" | "duration" (hours).
//
// Two kinds of report:
//  - COHORT reports (funnel, card, admission, rejection, marketing) look at the leads that CAME IN
//    during the range and say what became of them — the honest way to measure conversion.
//  - EVENT reports (credits) look at what HAPPENED during the range (credited, paid out).
// Cohort reports leave out bulk-imported and manually-added patients by default: those enter the
// system already admitted, with date-only data, so they would inflate every admission rate and
// make every timing meaningless.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------------------------
// Formatting (mirrored in frontend/src/components/ReportsPanel.jsx)
// ---------------------------------------------------------------------------------------------

export function formatDuration(hours) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function formatCell(type, value) {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "int": return Number(value).toLocaleString("en-IN");
    case "pct": return `${value}%`;
    case "pts": return `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} pts`;
    case "duration": return formatDuration(value);
    default: return String(value);
  }
}

const col = (key, label, type = "text") => ({ key, label, type });
const pctOf = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const stat = (label, type, value, sub) => ({ label, display: formatCell(type, value), ...(sub ? { sub } : {}) });

function hoursStats(hours) {
  if (hours.length === 0) return { avg: null, median: null };
  const sorted = [...hours].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    avg: sum(sorted, (h) => h) / sorted.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}

// ---------------------------------------------------------------------------------------------
// Date range + trend buckets
// ---------------------------------------------------------------------------------------------

// from / to are "YYYY-MM-DD" as typed into the date pickers, both days included, read as Indian
// calendar days.
export function parseRange(query) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  let { from, to } = query || {};
  if (!re.test(from || "") || !re.test(to || "")) return { error: "Choose a start and end date" };
  if (from > to) [from, to] = [to, from];
  const start = istDayBounds(from).start;
  const end = istDayBounds(to).end;
  const days = Math.round((end - start) / DAY);
  if (days > 732) return { error: "Choose a range of two years or less" };
  return { from, to, start, end, days };
}

const bucketUnit = (range) => (range.days <= 45 ? "day" : range.days <= 150 ? "week" : "month");

function bucketKeyFromDay(day, unit) {
  if (unit === "day") return day;
  if (unit === "month") return day.slice(0, 7);
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // back to Monday
  return dt.toISOString().slice(0, 10);
}
const bucketKey = (date, unit) => bucketKeyFromDay(istDateString(date), unit);

function bucketLabel(key, unit) {
  if (unit === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const [y, m, d] = key.split("-");
  const text = `${d}/${m}/${y.slice(2)}`;
  return unit === "week" ? `Week of ${text}` : text;
}

// Every bucket from the first day to the last, oldest first, so quiet days still show as zero.
function bucketKeys(range, unit) {
  const keys = [];
  const seen = new Set();
  const [y, m, d] = range.from.split("-").map(Number);
  for (let i = 0; i < range.days; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    const key = bucketKeyFromDay(day, unit);
    if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------
// The cohort: leads that came in during the range, with what the Activity Log knows about them
// ---------------------------------------------------------------------------------------------

const EVENT_ACTIONS = [
  ACTIONS.REFERRAL_CARD_VERIFIED_ACTIVE,
  ACTIONS.REFERRAL_CARD_VERIFIED_INACTIVE,
  ACTIONS.REFERRAL_REJECTED,
  ACTIONS.REFERRAL_ADDED_MANUALLY,
];

async function loadCohort({ hospitalId, range, marketingPersonId, includeDirect }) {
  const referrals = await prisma.referral.findMany({
    where: {
      createdAt: { gte: range.start, lt: range.end },
      doctor: { hospitalId, ...(marketingPersonId ? { marketingPersonId } : {}) },
    },
    select: {
      id: true, status: true, createdAt: true, arrivedAt: true, convertedAt: true, reopenedAt: true,
      visitType: true, rejectedReason: true, idType: true, importBatchId: true,
      doctor: { select: { id: true, name: true, marketingPerson: { select: { id: true, name: true, teamHead: { select: { name: true } } } } } },
      transaction: { select: { amount: true } },
    },
  });

  // Card-check results, rejection times and "added manually" markers exist only in the Activity Log.
  const events = new Map();
  const ids = referrals.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await prisma.activityLog.findMany({
      where: { hospitalId, entityType: "Referral", entityId: { in: ids.slice(i, i + 1000) }, action: { in: EVENT_ACTIONS } },
      select: { entityId: true, action: true, createdAt: true, changes: true, metadata: true },
      orderBy: { createdAt: "asc" },
    });
    for (const e of rows) {
      if (!events.has(e.entityId)) events.set(e.entityId, []);
      events.get(e.entityId).push(e);
    }
  }

  let directExcluded = 0;
  const leads = [];
  for (const r of referrals) {
    const evs = events.get(r.id) || [];
    const manual = evs.some((e) => e.action === ACTIONS.REFERRAL_ADDED_MANUALLY);
    const direct = Boolean(r.importBatchId) || manual;
    if (direct && !includeDirect) { directExcluded++; continue; }

    const cardEv = [...evs].reverse().find((e) => e.action === ACTIONS.REFERRAL_CARD_VERIFIED_ACTIVE || e.action === ACTIONS.REFERRAL_CARD_VERIFIED_INACTIVE);
    const rejEv = [...evs].reverse().find((e) => e.action === ACTIONS.REFERRAL_REJECTED);
    const cardVerified = cardEv
      ? { active: cardEv.action === ACTIONS.REFERRAL_CARD_VERIFIED_ACTIVE, at: cardEv.createdAt, reason: cardEv.metadata?.reason || null }
      : null;
    const rejection = rejEv
      ? { at: rejEv.createdAt, automatic: rejEv.metadata?.automatic === true, from: rejEv.changes?.status?.from || null }
      : null;

    leads.push({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      arrivedAt: r.arrivedAt,
      convertedAt: r.convertedAt,
      reopenedAt: r.reopenedAt,
      visitType: r.visitType,
      rejectedReason: r.rejectedReason || "",
      idType: r.idType,
      leaderId: r.doctor.id,
      leaderName: r.doctor.name,
      mpId: r.doctor.marketingPerson?.id || null,
      mpName: r.doctor.marketingPerson?.name || "No marketing person",
      headName: r.doctor.marketingPerson?.teamHead?.name || null,
      amount: r.transaction ? Number(r.transaction.amount) : 0,
      cardVerified,
      rejection,
      hadCardReview: r.status === "CARD_REVIEW" || Boolean(cardVerified) || rejection?.from === "CARD_REVIEW",
    });
  }
  return { leads, directExcluded };
}

const isAdmitted = (l) => l.status === "CREDITED";
const isRejected = (l) => l.status === "REJECTED";
const isOpen = (l) => l.status === "PENDING" || l.status === "CARD_REVIEW";

function rejectionKind(l) {
  const reason = l.rejectedReason || "";
  if (l.rejection?.automatic || /^auto-rejected/i.test(reason)) return "auto";
  if (l.cardVerified?.active === false) return "card";
  if (/card/i.test(reason) && /not active|inactive/i.test(reason)) return "card";
  return "manual";
}
const KIND_LABEL = { auto: "Auto-rejected (not confirmed in time)", card: "Card inactive", manual: "Rejected by reception / admin" };

const admitHours = (l) => (l.arrivedAt ? Math.max(0, (new Date(l.arrivedAt) - new Date(l.createdAt)) / HOUR) : null);

// Rows for "by marketing person" style tables.
function groupBy(leads, keyFn) {
  const map = new Map();
  for (const l of leads) {
    const k = keyFn(l);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(l);
  }
  return map;
}

function cohortNotes(directExcluded, includeDirect) {
  const notes = [];
  if (!includeDirect && directExcluded > 0) {
    notes.push(`${directExcluded} imported or manually added patient${directExcluded === 1 ? " was" : "s were"} left out — they enter already admitted, which would distort conversion and timing. Tick "Include imported & manually added" to count them.`);
  }
  return notes;
}

// ---------------------------------------------------------------------------------------------
// 1. Lead funnel
// ---------------------------------------------------------------------------------------------

function buildFunnel({ leads, range, directExcluded, includeDirect }) {
  const total = leads.length;
  const admitted = leads.filter(isAdmitted);
  const rejected = leads.filter(isRejected);
  const pending = leads.filter((l) => l.status === "PENDING");
  const cardReview = leads.filter((l) => l.status === "CARD_REVIEW");

  const outcome = [
    { stage: "Admitted — IPD", leads: admitted.filter((l) => l.visitType === "IPD").length },
    { stage: "Admitted — OPD", leads: admitted.filter((l) => l.visitType === "OPD").length },
    { stage: "Admitted — visit type not set", leads: admitted.filter((l) => !l.visitType).length },
    { stage: KIND_LABEL.auto, leads: rejected.filter((l) => rejectionKind(l) === "auto").length },
    { stage: KIND_LABEL.card, leads: rejected.filter((l) => rejectionKind(l) === "card").length },
    { stage: KIND_LABEL.manual, leads: rejected.filter((l) => rejectionKind(l) === "manual").length },
    { stage: "Still waiting — Pending", leads: pending.length },
    { stage: "Still waiting — Card activity", leads: cardReview.length },
  ].filter((r) => r.leads > 0).map((r) => ({ ...r, pct: pctOf(r.leads, total) }));

  const unit = bucketUnit(range);
  const byBucket = groupBy(leads, (l) => bucketKey(l.createdAt, unit));
  const trend = bucketKeys(range, unit).map((k) => {
    const ls = byBucket.get(k) || [];
    const a = ls.filter(isAdmitted).length;
    return {
      period: bucketLabel(k, unit), received: ls.length, admitted: a, rejected: ls.filter(isRejected).length,
      open: ls.filter(isOpen).length, rate: pctOf(a, ls.length),
    };
  });

  return {
    summary: [
      stat("Leads received", "int", total),
      stat("Admitted", "int", admitted.length, total ? `${pctOf(admitted.length, total)}% of leads` : undefined),
      stat("Rejected", "int", rejected.length, total ? `${pctOf(rejected.length, total)}% of leads` : undefined),
      stat("Still open", "int", pending.length + cardReview.length, `${pending.length} pending · ${cardReview.length} in card activity`),
    ],
    sections: [
      { title: "Where the leads ended up", note: "Every lead that came in during the period, by what has happened to it so far.",
        columns: [col("stage", "Outcome"), col("leads", "Leads", "int"), col("pct", "% of leads", "pct")], rows: outcome },
      { title: `Leads received, by ${unit}`,
        columns: [col("period", "Period"), col("received", "Received", "int"), col("admitted", "Admitted", "int"), col("rejected", "Rejected", "int"), col("open", "Still open", "int"), col("rate", "Admission rate", "pct")],
        rows: trend },
    ],
    notes: [
      "Recent leads may still be open, so the admission rate for the last few days will rise as reception confirms them.",
      ...cohortNotes(directExcluded, includeDirect),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Card activity conversion
// ---------------------------------------------------------------------------------------------

function buildCard({ leads, directExcluded, includeDirect }) {
  const cardLeads = leads.filter((l) => l.hadCardReview);
  const active = cardLeads.filter((l) => l.cardVerified?.active === true);
  const inactive = cardLeads.filter((l) => l.cardVerified?.active === false);
  const waiting = cardLeads.filter((l) => !l.cardVerified && l.status === "CARD_REVIEW");
  const expired = cardLeads.filter((l) => !l.cardVerified && l.status !== "CARD_REVIEW");
  const checked = active.length + inactive.length;
  const activeAdmitted = active.filter(isAdmitted);
  const verifyHours = cardLeads
    .filter((l) => l.cardVerified)
    .map((l) => (new Date(l.cardVerified.at) - new Date(l.createdAt)) / HOUR)
    .filter((h) => h >= 0);
  const verify = hoursStats(verifyHours);

  const outcome = [
    { outcome: "Card active — moved on to Pending", leads: active.length },
    { outcome: "Card inactive — rejected", leads: inactive.length },
    { outcome: "Not checked — still waiting", leads: waiting.length },
    { outcome: "Not checked — closed without a card check", leads: expired.length },
  ].filter((r) => r.leads > 0).map((r) => ({ ...r, pct: pctOf(r.leads, cardLeads.length) }));

  const afterActive = [
    { result: "Admitted", leads: activeAdmitted.length },
    { result: "Rejected later (e.g. didn't arrive in time)", leads: active.filter(isRejected).length },
    { result: "Still open", leads: active.filter(isOpen).length },
  ].filter((r) => r.leads > 0).map((r) => ({ ...r, pct: pctOf(r.leads, active.length) }));

  const byType = [...groupBy(cardLeads, (l) => l.idType || "Not recorded")].map(([type, ls]) => {
    const a = ls.filter((l) => l.cardVerified?.active === true).length;
    const i = ls.filter((l) => l.cardVerified?.active === false).length;
    return { type, sent: ls.length, active: a, inactive: i, inactiveRate: pctOf(i, a + i), admitted: ls.filter(isAdmitted).length };
  }).sort((x, y) => y.sent - x.sent);

  const byPerson = [...groupBy(cardLeads, (l) => l.mpName)].map(([name, ls]) => {
    const a = ls.filter((l) => l.cardVerified?.active === true).length;
    const i = ls.filter((l) => l.cardVerified?.active === false).length;
    return { name, sent: ls.length, active: a, inactive: i, inactiveRate: pctOf(i, a + i), admitted: ls.filter(isAdmitted).length };
  }).sort((x, y) => y.sent - x.sent);

  const reasons = [...groupBy(inactive, (l) => (l.cardVerified.reason || "No reason given").trim())]
    .map(([reason, ls]) => ({ reason, leads: ls.length })).sort((x, y) => y.leads - x.leads).slice(0, 15);

  const sections = [
    { title: "Card check outcome", columns: [col("outcome", "Outcome"), col("leads", "Leads", "int"), col("pct", "% of leads sent", "pct")], rows: outcome },
    { title: "What happened to leads with an active card", columns: [col("result", "Result"), col("leads", "Leads", "int"), col("pct", "% of active cards", "pct")], rows: afterActive },
    { title: "By card type", columns: [col("type", "Card type"), col("sent", "Sent for check", "int"), col("active", "Active", "int"), col("inactive", "Inactive", "int"), col("inactiveRate", "Inactive rate", "pct"), col("admitted", "Admitted", "int")], rows: byType },
    { title: "By marketing person", columns: [col("name", "Marketing person"), col("sent", "Sent for check", "int"), col("active", "Active", "int"), col("inactive", "Inactive", "int"), col("inactiveRate", "Inactive rate", "pct"), col("admitted", "Admitted", "int")], rows: byPerson },
  ];
  if (reasons.length) sections.push({ title: "Why cards were inactive", columns: [col("reason", "Reason"), col("leads", "Leads", "int")], rows: reasons });

  return {
    summary: [
      stat("Sent for card check", "int", cardLeads.length),
      stat("Card active", "int", active.length, checked ? `${pctOf(active.length, checked)}% of cards checked` : undefined),
      stat("Card inactive", "int", inactive.length, checked ? `${pctOf(inactive.length, checked)}% of cards checked` : undefined),
      stat("Active card → admitted", "pct", pctOf(activeAdmitted.length, active.length), active.length ? `${activeAdmitted.length} of ${active.length}` : undefined),
      stat("Avg time to verify a card", "duration", verify.avg, verify.median !== null ? `median ${formatDuration(verify.median)}` : undefined),
    ],
    sections,
    notes: [
      "Card checks are read from the Activity Log, so leads checked before the log existed are not counted here.",
      "\"Inactive rate\" is the share of checked cards that turned out inactive.",
      ...cohortNotes(directExcluded, includeDirect),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Pending → admission
// ---------------------------------------------------------------------------------------------

const SPEED_BUCKETS = [
  { label: "Within 1 hour", max: 1 },
  { label: "1 – 6 hours", max: 6 },
  { label: "6 – 24 hours", max: 24 },
  { label: "1 – 2 days", max: 48 },
  { label: "2 – 3 days", max: 72 },
  { label: "More than 3 days", max: Infinity },
];

function buildAdmission({ leads, range, directExcluded, includeDirect }) {
  const admitted = leads.filter((l) => isAdmitted(l) && l.arrivedAt);
  const hours = admitted.map(admitHours);
  const overall = hoursStats(hours);
  const open = leads.filter(isOpen);
  const oldestOpenDays = open.length ? Math.max(...open.map((l) => (Date.now() - new Date(l.reopenedAt || l.createdAt)) / DAY)) : null;

  const speed = SPEED_BUCKETS.map((b, i) => {
    const min = i === 0 ? -1 : SPEED_BUCKETS[i - 1].max;
    return { bucket: b.label, leads: hours.filter((h) => h >= min && h < b.max).length };
  }).map((r) => ({ ...r, pct: pctOf(r.leads, admitted.length) }));

  const byVisit = ["IPD", "OPD"].map((v) => {
    const ls = admitted.filter((l) => l.visitType === v);
    return { visit: v, admitted: ls.length, pct: pctOf(ls.length, admitted.length), avg: hoursStats(ls.map(admitHours)).avg, converted: v === "IPD" ? ls.filter((l) => l.convertedAt).length : null };
  });
  const noVisit = admitted.filter((l) => !l.visitType);
  if (noVisit.length) byVisit.push({ visit: "Not set", admitted: noVisit.length, pct: pctOf(noVisit.length, admitted.length), avg: hoursStats(noVisit.map(admitHours)).avg, converted: null });

  const byPerson = [...groupBy(leads, (l) => l.mpName)].map(([name, ls]) => {
    const a = ls.filter((l) => isAdmitted(l) && l.arrivedAt);
    return { name, leads: ls.length, admitted: a.length, rate: pctOf(a.length, ls.length), avg: hoursStats(a.map(admitHours)).avg };
  }).sort((x, y) => y.admitted - x.admitted);

  const unit = bucketUnit(range);
  const byBucket = groupBy(leads, (l) => bucketKey(l.createdAt, unit));
  const trend = bucketKeys(range, unit).map((k) => {
    const ls = byBucket.get(k) || [];
    const a = ls.filter((l) => isAdmitted(l) && l.arrivedAt);
    return { period: bucketLabel(k, unit), received: ls.length, admitted: a.length, rate: pctOf(a.length, ls.length), avg: hoursStats(a.map(admitHours)).avg };
  });

  return {
    summary: [
      stat("Leads received", "int", leads.length),
      stat("Admitted", "int", admitted.length, leads.length ? `${pctOf(admitted.length, leads.length)}% admission rate` : undefined),
      stat("Average time to admit", "duration", overall.avg, overall.median !== null ? `median ${formatDuration(overall.median)}` : undefined),
      stat("Still waiting", "int", open.length, oldestOpenDays !== null ? `oldest ${oldestOpenDays.toFixed(1)} days` : undefined),
    ],
    sections: [
      { title: "How long admission took", note: "Time from the lead coming in to reception admitting the patient.",
        columns: [col("bucket", "Time taken"), col("leads", "Admitted", "int"), col("pct", "% of admitted", "pct")], rows: speed },
      { title: "By visit type", columns: [col("visit", "Visit"), col("admitted", "Admitted", "int"), col("pct", "% of admitted", "pct"), col("avg", "Avg time to admit", "duration"), col("converted", "Converted from OPD", "int")], rows: byVisit },
      { title: "By marketing person", columns: [col("name", "Marketing person"), col("leads", "Leads", "int"), col("admitted", "Admitted", "int"), col("rate", "Admission rate", "pct"), col("avg", "Avg time to admit", "duration")], rows: byPerson },
      { title: `By ${unit} the lead came in`, columns: [col("period", "Period"), col("received", "Received", "int"), col("admitted", "Admitted", "int"), col("rate", "Admission rate", "pct"), col("avg", "Avg time to admit", "duration")], rows: trend },
    ],
    notes: [
      "Recent leads may still be open, so the admission rate and average time for the last few days will change.",
      "For leads that went through a card check, the time includes the wait for the card to be verified.",
      ...cohortNotes(directExcluded, includeDirect),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// 4. Pending → rejection
// ---------------------------------------------------------------------------------------------

function buildRejection({ leads, directExcluded, includeDirect }) {
  const rejected = leads.filter(isRejected);
  const kinds = { auto: 0, card: 0, manual: 0 };
  rejected.forEach((l) => { kinds[rejectionKind(l)]++; });
  const reopened = leads.filter((l) => l.reopenedAt).length;

  const reasonMap = new Map();
  for (const l of rejected) {
    const kind = rejectionKind(l);
    const reason = (l.rejectedReason || (kind === "card" ? "Card not active" : "No reason given")).trim();
    const key = `${kind}|${reason.toLowerCase()}`;
    if (!reasonMap.has(key)) reasonMap.set(key, { reason, type: KIND_LABEL[kind], leads: 0 });
    reasonMap.get(key).leads++;
  }
  const reasonRows = [...reasonMap.values()].sort((a, b) => b.leads - a.leads);
  const shown = reasonRows.slice(0, 20);
  if (reasonRows.length > 20) shown.push({ reason: `${reasonRows.length - 20} other reasons`, type: "", leads: sum(reasonRows.slice(20), (r) => r.leads) });
  shown.forEach((r) => { r.pct = pctOf(r.leads, rejected.length); });

  const stageOf = (l) => (l.rejection?.from === "CARD_REVIEW" || rejectionKind(l) === "card" ? "Card activity" : l.rejection?.from === "PENDING" ? "Pending" : "Not recorded");
  const stageRows = [...groupBy(rejected, stageOf)].map(([stage, ls]) => ({ stage, leads: ls.length, pct: pctOf(ls.length, rejected.length) })).sort((a, b) => b.leads - a.leads);

  const rejectHours = rejected
    .map((l) => (l.rejection ? (new Date(l.rejection.at) - new Date(l.createdAt)) / HOUR : l.cardVerified && !l.cardVerified.active ? (new Date(l.cardVerified.at) - new Date(l.createdAt)) / HOUR : null))
    .filter((h) => h !== null && h >= 0);
  const timeToReject = hoursStats(rejectHours);

  const personRow = (name, ls) => {
    const rj = ls.filter(isRejected);
    return {
      name, leads: ls.length, rejected: rj.length, rate: pctOf(rj.length, ls.length),
      auto: rj.filter((l) => rejectionKind(l) === "auto").length,
      card: rj.filter((l) => rejectionKind(l) === "card").length,
      manual: rj.filter((l) => rejectionKind(l) === "manual").length,
    };
  };
  const byPerson = [...groupBy(leads, (l) => l.mpName)].map(([n, ls]) => personRow(n, ls)).sort((a, b) => b.rejected - a.rejected);

  const byLeader = [...groupBy(leads, (l) => l.leaderId)].map(([, ls]) => ({ ...personRow(ls[0].leaderName, ls), person: ls[0].mpName }))
    .filter((r) => r.rejected > 0).sort((a, b) => b.rejected - a.rejected).slice(0, 15);

  return {
    summary: [
      stat("Leads received", "int", leads.length),
      stat("Rejected", "int", rejected.length, leads.length ? `${pctOf(rejected.length, leads.length)}% of leads` : undefined),
      stat("Auto-rejected", "int", kinds.auto, "not confirmed in time"),
      stat("Card inactive", "int", kinds.card),
      stat("Rejected by staff", "int", kinds.manual),
      stat("Reopened after rejection", "int", reopened),
    ],
    sections: [
      { title: "Why leads were rejected", columns: [col("reason", "Reason"), col("type", "Type"), col("leads", "Leads", "int"), col("pct", "% of rejected", "pct")], rows: shown },
      { title: "Stage when rejected", columns: [col("stage", "Stage"), col("leads", "Leads", "int"), col("pct", "% of rejected", "pct")], rows: stageRows },
      { title: "By marketing person", columns: [col("name", "Marketing person"), col("leads", "Leads", "int"), col("rejected", "Rejected", "int"), col("rate", "Rejection rate", "pct"), col("auto", "Auto", "int"), col("card", "Card inactive", "int"), col("manual", "By staff", "int")], rows: byPerson },
      { title: "Leaders with the most rejected leads", note: "Top 15 by number of rejected leads.", columns: [col("name", "Leader"), col("person", "Marketing person"), col("leads", "Leads", "int"), col("rejected", "Rejected", "int"), col("rate", "Rejection rate", "pct")], rows: byLeader },
    ],
    notes: [
      `Average time before a lead was rejected: ${formatDuration(timeToReject.avg)}${timeToReject.median !== null ? ` (median ${formatDuration(timeToReject.median)})` : ""}. This comes from the Activity Log, so it covers rejections made since logging began.`,
      "A lead that was rejected and then reopened by an admin is counted by its current status, so it is not in the rejected totals above.",
      ...cohortNotes(directExcluded, includeDirect),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// 5. Marketing team performance
// ---------------------------------------------------------------------------------------------

async function buildMarketing({ leads, hospitalId, marketingPersonId, directExcluded, includeDirect }) {
  const people = await prisma.marketingPerson.findMany({
    where: { hospitalId, active: true, ...(marketingPersonId ? { id: marketingPersonId } : {}) },
    select: { id: true, name: true, teamHead: { select: { name: true } } },
  });

  const byPerson = groupBy(leads, (l) => l.mpId || "none");
  const make = (name, head, ls) => {
    const a = ls.filter(isAdmitted);
    const rj = ls.filter(isRejected);
    return {
      name, head: head || "—", leads: ls.length, admitted: a.length, rejected: rj.length, open: ls.filter(isOpen).length,
      rate: pctOf(a.length, ls.length), rejRate: pctOf(rj.length, ls.length),
      avg: hoursStats(a.filter((l) => l.arrivedAt).map(admitHours)).avg, credits: sum(a, (l) => l.amount),
    };
  };

  const rows = [];
  for (const p of people) rows.push(make(p.name, p.teamHead?.name, byPerson.get(p.id) || []));
  // anyone with leads who isn't in the active list (deactivated) or leaders with no marketing person
  for (const [id, ls] of byPerson) {
    if (id === "none") rows.push(make("No marketing person (direct leaders)", null, ls));
    else if (!people.some((p) => p.id === id)) rows.push(make(`${ls[0].mpName} (inactive)`, ls[0].headName, ls));
  }
  rows.sort((a, b) => b.admitted - a.admitted || b.leads - a.leads || a.name.localeCompare(b.name));

  const heads = [...groupBy(leads.filter((l) => l.mpId), (l) => l.headName || "No team head")].map(([name, ls]) => {
    const r = make(name, null, ls);
    return { name, people: new Set(ls.map((l) => l.mpId)).size, leads: r.leads, admitted: r.admitted, rate: r.rate, rejRate: r.rejRate, credits: r.credits };
  }).sort((a, b) => b.admitted - a.admitted);

  const withLeads = rows.filter((r) => r.leads > 0 && !r.name.startsWith("No marketing person"));
  const top = [...withLeads].sort((a, b) => b.admitted - a.admitted)[0];
  const totalAdmitted = leads.filter(isAdmitted).length;

  const sections = [
    { title: "Marketing people", columns: [col("name", "Marketing person"), col("head", "Team head"), col("leads", "Leads", "int"), col("admitted", "Admitted", "int"), col("rejected", "Rejected", "int"), col("open", "Open", "int"), col("rate", "Admission rate", "pct"), col("rejRate", "Rejection rate", "pct"), col("avg", "Avg time to admit", "duration"), col("credits", "Credits earned", "pts")], rows },
  ];
  if (heads.length > 1 || (heads.length === 1 && heads[0].name !== "No team head")) {
    sections.push({ title: "By team head", columns: [col("name", "Team head"), col("people", "Marketing people", "int"), col("leads", "Leads", "int"), col("admitted", "Admitted", "int"), col("rate", "Admission rate", "pct"), col("rejRate", "Rejection rate", "pct"), col("credits", "Credits earned", "pts")], rows: heads });
  }

  return {
    summary: [
      stat("Leads received", "int", leads.length),
      stat("Admitted", "int", totalAdmitted, leads.length ? `${pctOf(totalAdmitted, leads.length)}% admission rate` : undefined),
      stat("Marketing people with leads", "int", withLeads.length, `of ${people.length} active`),
      stat("Most admissions", "text", top && top.admitted > 0 ? top.name : null, top && top.admitted > 0 ? `${top.admitted} admitted` : undefined),
      stat("Credits earned", "pts", sum(leads.filter(isAdmitted), (l) => l.amount)),
    ],
    sections,
    notes: [
      "Credits earned are the credits on the admitted leads from this period, whether or not they have been paid out yet.",
      ...cohortNotes(directExcluded, includeDirect),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// 6. Credits & payouts (an EVENT report: what happened during the range)
// ---------------------------------------------------------------------------------------------

async function buildCredits({ range, hospitalId, marketingPersonId }) {
  const doctorWhere = { hospitalId, ...(marketingPersonId ? { marketingPersonId } : {}) };
  const doctorSelect = { select: { id: true, name: true, marketingPerson: { select: { name: true } } } };
  const pick = { amount: true, createdAt: true, redeemedAt: true, paymentMethod: true, doctor: doctorSelect };

  const [credited, redeemed, outstanding] = await Promise.all([
    prisma.creditTransaction.findMany({ where: { createdAt: { gte: range.start, lt: range.end }, doctor: doctorWhere }, select: pick }),
    prisma.creditTransaction.findMany({ where: { redeemed: true, redeemedAt: { gte: range.start, lt: range.end }, doctor: doctorWhere }, select: pick }),
    prisma.creditTransaction.findMany({ where: { redeemed: false, doctor: doctorWhere }, select: pick }),
  ]);
  const amt = (t) => Number(t.amount);
  const oldUnpaid = outstanding.filter((t) => Date.now() - new Date(t.createdAt) > 30 * DAY);
  const redeemDays = redeemed.map((t) => (new Date(t.redeemedAt) - new Date(t.createdAt)) / DAY).filter((d) => d >= 0);
  const avgRedeemHours = redeemDays.length ? (sum(redeemDays, (d) => d) / redeemDays.length) * 24 : null;

  const unit = bucketUnit(range);
  const cByB = groupBy(credited, (t) => bucketKey(t.createdAt, unit));
  const rByB = groupBy(redeemed, (t) => bucketKey(t.redeemedAt, unit));
  const trend = bucketKeys(range, unit).map((k) => ({
    period: bucketLabel(k, unit),
    credited: sum(cByB.get(k) || [], amt), creditedCount: (cByB.get(k) || []).length,
    redeemed: sum(rByB.get(k) || [], amt), redeemedCount: (rByB.get(k) || []).length,
  }));

  const leaders = new Map();
  const touch = (t) => {
    if (!leaders.has(t.doctor.id)) leaders.set(t.doctor.id, { name: t.doctor.name, person: t.doctor.marketingPerson?.name || "—", credited: 0, redeemed: 0, outstanding: 0 });
    return leaders.get(t.doctor.id);
  };
  credited.forEach((t) => { touch(t).credited += amt(t); });
  redeemed.forEach((t) => { touch(t).redeemed += amt(t); });
  outstanding.forEach((t) => { touch(t).outstanding += amt(t); });
  const leaderRows = [...leaders.values()].sort((a, b) => b.outstanding - a.outstanding || b.credited - a.credited).slice(0, 100);

  const methods = [...groupBy(redeemed, (t) => t.paymentMethod || "Not recorded")]
    .map(([method, ts]) => ({ method, payments: ts.length, amount: sum(ts, amt) })).sort((a, b) => b.amount - a.amount);

  const sections = [
    { title: `Credited and paid out, by ${unit}`, columns: [col("period", "Period"), col("credited", "Credited", "pts"), col("creditedCount", "Credits", "int"), col("redeemed", "Paid out", "pts"), col("redeemedCount", "Payments", "int")], rows: trend },
    { title: "By leader", note: "Credited and paid out in the period; \"Owed now\" is the leader's unpaid balance today. Top 100 by balance owed.", columns: [col("name", "Leader"), col("person", "Marketing person"), col("credited", "Credited", "pts"), col("redeemed", "Paid out", "pts"), col("outstanding", "Owed now", "pts")], rows: leaderRows },
  ];
  if (methods.length) sections.push({ title: "Payments by method", columns: [col("method", "Method"), col("payments", "Payments", "int"), col("amount", "Amount", "pts")], rows: methods });

  return {
    summary: [
      stat("Credited in period", "pts", sum(credited, amt), `${credited.length} credit${credited.length === 1 ? "" : "s"}`),
      stat("Paid out in period", "pts", sum(redeemed, amt), `${redeemed.length} credit${redeemed.length === 1 ? "" : "s"}`),
      stat("Owed now", "pts", sum(outstanding, amt), `${outstanding.length} unpaid credit${outstanding.length === 1 ? "" : "s"}`),
      stat("Unpaid over 30 days", "pts", sum(oldUnpaid, amt), `${oldUnpaid.length} credit${oldUnpaid.length === 1 ? "" : "s"}`),
      stat("Avg time to pay out", "duration", avgRedeemHours, redeemDays.length ? `${redeemDays.length} payment${redeemDays.length === 1 ? "" : "s"} in period` : undefined),
    ],
    sections,
    notes: [
      "\"Owed now\" and \"Unpaid over 30 days\" are as of today, whatever date range is chosen.",
      "This report counts credits by the day they were created or paid out, and includes every credit — bulk-imported ones too.",
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

export const REPORTS = {
  funnel: { title: "Lead funnel", cohort: true, description: "Of the leads that came in, how many were admitted, rejected or are still open." },
  card: { title: "Card activity conversion", cohort: true, description: "Leads sent for a card check: how many cards were active, and how many of those were admitted." },
  admission: { title: "Pending → admission", cohort: true, description: "How many leads got admitted, and how long reception took." },
  rejection: { title: "Pending → rejection", cohort: true, description: "Which leads were rejected, why, and which marketing people and leaders they came from." },
  marketing: { title: "Marketing team performance", cohort: true, description: "Leads, admissions, rejections and credits for each marketing person and team head." },
  credits: { title: "Credits & payouts", cohort: false, description: "Credits earned and paid out in the period, and what is still owed to leaders." },
};

export async function runReport(type, { hospitalId, range, marketingPersonId, includeDirect }) {
  const meta = REPORTS[type];
  let body;
  if (type === "credits") {
    body = await buildCredits({ range, hospitalId, marketingPersonId });
  } else {
    const { leads, directExcluded } = await loadCohort({ hospitalId, range, marketingPersonId, includeDirect });
    const ctx = { leads, range, directExcluded, includeDirect, hospitalId, marketingPersonId };
    body = type === "funnel" ? buildFunnel(ctx)
      : type === "card" ? buildCard(ctx)
      : type === "admission" ? buildAdmission(ctx)
      : type === "rejection" ? buildRejection(ctx)
      : await buildMarketing(ctx);
  }
  return { key: type, title: meta.title, description: meta.description, usesCohort: meta.cohort, ...body };
}
