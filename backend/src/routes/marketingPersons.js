import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { z } from "zod";
import prisma from "../utils/prismaClient.js";
import { requireAuth, requireRole, requireAccess } from "../middleware/auth.js";
import { TEAM_HEAD_PERMISSION } from "../utils/permissions.js";
import { startOfIstDay, istDateString } from "../utils/istDate.js";
import { logActivity, diffFields, ACTIONS } from "../utils/activityLog.js";

const router = express.Router();

const marketingPersonSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(4),
  headId: z.string().uuid().nullable().optional(), // the team head (staff account) they report to
});

const marketingPersonUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  active: z.boolean().optional(),
  password: z.string().min(4).optional(), // omit to keep the existing password unchanged
  headId: z.string().uuid().nullable().optional(), // null removes them from any team
});

// GET /api/marketing-persons  (admin) — every marketing-team member for this hospital,
// with how many leaders they're associated with and how many leads those leaders have
// brought in, mirroring the stats shown on the Leaders tab.
router.get("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const people = await prisma.marketingPerson.findMany({
    where: { hospitalId: req.user.hospitalId },
    orderBy: { createdAt: "desc" },
    include: {
      teamHead: { select: { id: true, name: true } },
      doctors: {
        select: {
          id: true,
          transactions: { select: { amount: true, redeemed: true } },
          _count: { select: { referrals: true } },
          referrals: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const result = people.map((p) => {
    const allTx = p.doctors.flatMap((d) => d.transactions);
    const lastReferralAt = p.doctors.reduce((latest, d) => {
      const dLatest = d.referrals[0]?.createdAt || null;
      if (!dLatest) return latest;
      return !latest || dLatest > latest ? dLatest : latest;
    }, null);
    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      active: p.active,
      createdAt: p.createdAt,
      hasPassword: Boolean(p.passwordHash),
      headId: p.headId,
      headName: p.teamHead?.name || null,
      leaderCount: p.doctors.length,
      totalReferrals: p.doctors.reduce((sum, d) => sum + d._count.referrals, 0),
      totalCredited: allTx.reduce((sum, t) => sum + Number(t.amount), 0),
      totalPending: allTx.filter((t) => !t.redeemed).reduce((sum, t) => sum + Number(t.amount), 0),
      lastReferralAt,
    };
  });

  res.json(result);
});

// GET /api/marketing-persons/lite  — minimal list for the leader edit/create dropdown.
router.get("/lite", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const people = await prisma.marketingPerson.findMany({
    where: { hospitalId: req.user.hospitalId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  res.json(people);
});

// Staff accounts that can act as a team head: STAFF users whose custom role grants
// VIEW_MY_MARKETING_TEAM.
async function listTeamHeads(hospitalId) {
  const staff = await prisma.staffUser.findMany({
    where: { hospitalId, role: "STAFF", customRoleId: { not: null } },
    select: { id: true, name: true, customRole: { select: { name: true, permissions: true } } },
    orderBy: { name: "asc" },
  });
  return staff
    .filter((s) => Array.isArray(s.customRole?.permissions) && s.customRole.permissions.includes(TEAM_HEAD_PERMISSION))
    .map((s) => ({ id: s.id, name: s.name, roleName: s.customRole.name }));
}

// GET /api/marketing-persons/heads  (admin) — who can be picked as a team head.
router.get("/heads", requireAuth, requireRole("ADMIN"), async (req, res) => {
  res.json(await listTeamHeads(req.user.hospitalId));
});

const NOT_A_HEAD_ERROR =
  "That staff account can't be a team head. Give their role the \"View their own marketing team\" permission first.";

// Shared by the admin detail view and the marketing person's own portal — every leader
// under this person, plus weekly (last 8 weeks) and monthly (last 6 months) referral
// counts and credited amounts.
async function buildPersonDetail(person) {
  const doctors = await prisma.doctor.findMany({
    where: { marketingPersonId: person.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { referrals: true } },
      transactions: { select: { amount: true, redeemed: true } },
    },
  });

  const leaders = doctors.map((d) => ({
    id: d.id,
    name: d.name,
    clinicName: d.clinicName,
    active: d.active,
    totalReferrals: d._count.referrals,
    totalCredited: d.transactions.reduce((sum, t) => sum + Number(t.amount), 0),
  }));

  const doctorIds = doctors.map((d) => d.id);
  const referrals = doctorIds.length
    ? await prisma.referral.findMany({
        where: { doctorId: { in: doctorIds } },
        select: { createdAt: true, transaction: { select: { amount: true } } },
      })
    : [];

  // Weekly buckets: last 8 weeks, Monday-start, labeled by the week's start date.
  const weekly = [];
  for (let w = 7; w >= 0; w--) {
    const end = startOfIstDay(w * 7);
    const start = startOfIstDay(w * 7 + 7);
    const inWeek = referrals.filter((r) => r.createdAt >= start && r.createdAt < end);
    weekly.push({
      weekStart: istDateString(start),
      count: inWeek.length,
      credited: inWeek.reduce((sum, r) => sum + (r.transaction ? Number(r.transaction.amount) : 0), 0),
    });
  }

  // Monthly buckets: last 6 calendar months (IST), most recent last.
  const monthly = [];
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // shift to IST wall-clock
  for (let m = 5; m >= 0; m--) {
    const bucketDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    const y = bucketDate.getUTCFullYear();
    const mo = bucketDate.getUTCMonth();
    const label = bucketDate.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    const inMonth = referrals.filter((r) => {
      const shifted = new Date(r.createdAt.getTime() + 5.5 * 60 * 60 * 1000);
      return shifted.getUTCFullYear() === y && shifted.getUTCMonth() === mo;
    });
    monthly.push({
      month: label,
      count: inMonth.length,
      credited: inMonth.reduce((sum, r) => sum + (r.transaction ? Number(r.transaction.amount) : 0), 0),
    });
  }

  return {
    person: { id: person.id, name: person.name, phone: person.phone, email: person.email, active: person.active },
    leaders,
    totalReferrals: referrals.length,
    totalCredited: referrals.reduce((sum, r) => sum + (r.transaction ? Number(r.transaction.amount) : 0), 0),
    weekly,
    monthly,
  };
}

// GET /api/marketing-persons/:id  (admin) — detail view for a specific person.
router.get("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const person = await prisma.marketingPerson.findFirst({
    where: { id: req.params.id, hospitalId: req.user.hospitalId },
  });
  if (!person) return res.status(404).json({ error: "Marketing person not found" });
  res.json(await buildPersonDetail(person));
});

// GET /api/marketing-persons/:id/qr  (admin) — the marketing person's own portal link + QR
// code image, so admin can share it with them (print, download, or send directly).
router.get("/:id/qr", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const person = await prisma.marketingPerson.findFirst({
    where: { id: req.params.id, hospitalId: req.user.hospitalId },
  });
  if (!person) return res.status(404).json({ error: "Marketing person not found" });

  const portalUrl = `${process.env.FRONTEND_URL}/marketing/${person.id}`;
  const qrDataUrl = await QRCode.toDataURL(portalUrl);
  res.json({ portalUrl, qrDataUrl });
});

// POST /api/marketing-persons  (admin) — add a new marketing-team member. A password is
// required up front, since this immediately creates their portal login.
router.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = marketingPersonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { password, ...rest } = parsed.data;
  if (rest.headId && !(await listTeamHeads(req.user.hospitalId)).some((h) => h.id === rest.headId)) {
    return res.status(400).json({ error: NOT_A_HEAD_ERROR });
  }
  const passwordHash = await bcrypt.hash(password, 10);

  const person = await prisma.marketingPerson.create({
    data: { ...rest, passwordHash, hospitalId: req.user.hospitalId },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.MARKETING_PERSON_CREATED,
    entityType: "MarketingPerson",
    entityId: person.id,
    entityLabel: person.name,
  });

  const portalUrl = `${process.env.FRONTEND_URL}/marketing/${person.id}`;
  const qrDataUrl = await QRCode.toDataURL(portalUrl);
  res.status(201).json({ person, portalUrl, qrDataUrl });
});

// PATCH /api/marketing-persons/:id  (admin) — edit details, reset the portal password, or
// toggle active. Omitting `password` leaves the existing one unchanged.
router.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = marketingPersonUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.marketingPerson.findFirst({ where: { id: req.params.id, hospitalId: req.user.hospitalId } });
  if (!existing) return res.status(404).json({ error: "Marketing person not found" });

  const { password, ...rest } = parsed.data;
  if (rest.headId && !(await listTeamHeads(req.user.hospitalId)).some((h) => h.id === rest.headId)) {
    return res.status(400).json({ error: NOT_A_HEAD_ERROR });
  }
  const data = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  const person = await prisma.marketingPerson.update({ where: { id: req.params.id }, data });

  logActivity({
    actor: req.user,
    action: ACTIONS.MARKETING_PERSON_UPDATED,
    entityType: "MarketingPerson",
    entityId: person.id,
    entityLabel: person.name,
    changes: diffFields(existing, person, ["name", "phone", "email", "active", "headId"]),
    metadata: password ? { passwordReset: true } : undefined,
  });

  res.json(person);
});

// ---------------------------------------------------------------------------------------
// Public portal endpoints — used by the marketing person themselves, not by hospital staff.
// No hospital-staff auth required to reach these; the password on the person's own record
// is the only gate. The resulting token only ever grants access to that one person's own
// data (see requireRole("MARKETING") + buildPersonDetail scoped to req.user.marketingPersonId
// below) — never other marketing people's data, and no referral-management actions at all.
// ---------------------------------------------------------------------------------------

// POST /api/marketing-persons/public/:id/login  { password }
router.post("/public/:id/login", async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password is required" });

  const person = await prisma.marketingPerson.findUnique({ where: { id: req.params.id } });
  if (!person || !person.passwordHash) {
    return res.status(401).json({ error: "This portal link isn't set up yet. Ask your admin to set a password." });
  }
  if (!person.active) {
    return res.status(403).json({ error: "This account has been deactivated. Ask your admin for help." });
  }

  const valid = await bcrypt.compare(password, person.passwordHash);
  if (!valid) return res.status(401).json({ error: "Incorrect password" });

  const token = jwt.sign(
    { role: "MARKETING", marketingPersonId: person.id, hospitalId: person.hospitalId, name: person.name },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({ token, name: person.name });
});

// GET /api/marketing-persons/public/me  — the logged-in marketing person's own report.
// Always scoped to req.user.marketingPersonId from the token — the :id in the URL they
// visited is never trusted for data access, only the token is.
router.get("/public/me", requireAuth, requireRole("MARKETING"), async (req, res) => {
  const person = await prisma.marketingPerson.findUnique({ where: { id: req.user.marketingPersonId } });
  if (!person) return res.status(404).json({ error: "Account not found" });
  res.json(await buildPersonDetail(person));
});

// Only Ayushman cards are verified by reception (CARD_REVIEW) before a lead can move on. For
// these, a lead that's now PENDING (or further) got there because reception marked the card
// active. Every other type goes straight to PENDING at submission and is never "card checked".
const CARD_TYPES_NEEDING_CHECK = ["AYUSHMAN"];
const DEFAULT_CARD_INACTIVE_REASON = "Card not active"; // what POST /referrals/:id/verify-card writes

// Collapses a referral's raw status + timestamps into the one stage a marketing person cares
// about. Kept server-side so the portal doesn't need to know how reception's actions map
// onto statuses.
function leadStage(r) {
  switch (r.status) {
    case "CARD_REVIEW":
      return { stage: "CARD_REVIEW", label: "Card under review", note: "Waiting for reception" };
    case "PENDING":
      return CARD_TYPES_NEEDING_CHECK.includes(r.idType)
        ? { stage: "CARD_ACTIVE", label: "Card active", note: "Awaiting arrival" }
        : { stage: "PENDING", label: "Awaiting arrival", note: null };
    case "CREDITED":
      if (r.dischargedAt) return { stage: "DISCHARGED", label: "Discharged", note: r.visitType || null };
      return r.visitType === "OPD"
        ? { stage: "OPD", label: "OPD visit", note: null }
        : { stage: "ADMITTED", label: "Admitted", note: r.visitType || null };
    case "REJECTED": {
      const reason = r.rejectedReason && r.rejectedReason !== "No reason given" ? r.rejectedReason : null;
      return r.rejectedReason === DEFAULT_CARD_INACTIVE_REASON
        ? { stage: "CARD_INACTIVE", label: "Card inactive", note: null }
        : { stage: "REJECTED", label: "Rejected", note: reason };
    }
    default:
      return { stage: r.status, label: r.status, note: null };
  }
}

// GET /api/marketing-persons/public/me/leads — the logged-in marketing person's own leads
// (every referral under the leaders associated with them) and where each one stands. Scoped
// strictly by the token's marketingPersonId. Returns only what the table needs — no phone,
// no ID number, no location.
router.get("/public/me/leads", requireAuth, requireRole("MARKETING"), async (req, res) => {
  const person = await prisma.marketingPerson.findUnique({ where: { id: req.user.marketingPersonId } });
  if (!person || !person.active) return res.status(403).json({ error: "This account is not active" });

  const referrals = await prisma.referral.findMany({
    where: { doctor: { marketingPersonId: req.user.marketingPersonId } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      patientName: true,
      idType: true,
      panel: true,
      status: true,
      rejectedReason: true,
      visitType: true,
      dischargedAt: true,
      createdAt: true,
      doctor: { select: { name: true } },
    },
  });

  res.json(
    referrals.map((r) => ({
      id: r.id,
      patientName: r.patientName,
      leaderName: r.doctor.name,
      cardType: r.idType,
      panel: r.panel,
      submittedAt: r.createdAt,
      ...leadStage(r),
    }))
  );
});

// ---------------------------------------------------------------------------------------
// Team head endpoints — for a staff account whose role grants VIEW_MY_MARKETING_TEAM.
// Everything here is scoped by the logged-in account's own id (MarketingPerson.headId =
// req.user.id), taken from the verified token, never from the request — so a head can't see
// anyone outside their team no matter what they send. Read-only; returns no phone numbers,
// card/ID numbers, or locations of patients.
// ---------------------------------------------------------------------------------------
const teamHeadAccess = [requireAuth, requireAccess([], [TEAM_HEAD_PERMISSION])];
const teamOf = (req) => ({ hospitalId: req.user.hospitalId, headId: req.user.id });

// GET /api/marketing-persons/team/overview — the head's people, each with their leader count,
// credited total, and how many leads sit at each stage; plus team-wide totals.
router.get("/team/overview", ...teamHeadAccess, async (req, res) => {
  const people = await prisma.marketingPerson.findMany({
    where: teamOf(req),
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, phone: true, active: true,
      doctors: { select: { id: true, transactions: { select: { amount: true } } } },
    },
  });

  const personByDoctor = new Map();
  for (const p of people) for (const d of p.doctors) personByDoctor.set(d.id, p.id);

  const referrals = personByDoctor.size
    ? await prisma.referral.findMany({
        where: { doctorId: { in: [...personByDoctor.keys()] } },
        select: { doctorId: true, status: true, idType: true, visitType: true, dischargedAt: true, rejectedReason: true, createdAt: true },
      })
    : [];

  const stats = new Map(people.map((p) => [p.id, { stages: {}, totalLeads: 0, lastLeadAt: null }]));
  const teamStages = {};
  for (const r of referrals) {
    const s = stats.get(personByDoctor.get(r.doctorId));
    if (!s) continue;
    const { stage } = leadStage(r);
    s.stages[stage] = (s.stages[stage] || 0) + 1;
    teamStages[stage] = (teamStages[stage] || 0) + 1;
    s.totalLeads += 1;
    if (!s.lastLeadAt || r.createdAt > s.lastLeadAt) s.lastLeadAt = r.createdAt;
  }

  const members = people.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    active: p.active,
    leaderCount: p.doctors.length,
    totalCredited: p.doctors.reduce((sum, d) => sum + d.transactions.reduce((a, t) => a + Number(t.amount), 0), 0),
    ...stats.get(p.id),
  }));

  res.json({
    members,
    totals: {
      members: members.length,
      leaders: members.reduce((n, m) => n + m.leaderCount, 0),
      leads: referrals.length,
      credited: members.reduce((n, m) => n + m.totalCredited, 0),
      stages: teamStages,
    },
  });
});

// GET /api/marketing-persons/team/leads[?memberId=] — latest 500 leads across the head's team
// (or just one member's), each with where it currently stands.
router.get("/team/leads", ...teamHeadAccess, async (req, res) => {
  const memberId = typeof req.query.memberId === "string" && req.query.memberId ? req.query.memberId : undefined;
  const referrals = await prisma.referral.findMany({
    where: {
      doctor: {
        marketingPerson: { is: teamOf(req) },
        ...(memberId ? { marketingPersonId: memberId } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true, patientName: true, idType: true, panel: true, status: true, rejectedReason: true,
      visitType: true, dischargedAt: true, createdAt: true,
      doctor: { select: { name: true, marketingPerson: { select: { id: true, name: true } } } },
    },
  });

  res.json(
    referrals.map((r) => ({
      id: r.id,
      patientName: r.patientName,
      leaderName: r.doctor.name,
      memberId: r.doctor.marketingPerson?.id,
      memberName: r.doctor.marketingPerson?.name,
      cardType: r.idType,
      panel: r.panel,
      submittedAt: r.createdAt,
      ...leadStage(r),
    }))
  );
});

export default router;
