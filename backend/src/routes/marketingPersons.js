import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { z } from "zod";
import prisma from "../utils/prismaClient.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { startOfIstDay, istDateString } from "../utils/istDate.js";
import { logActivity, diffFields, ACTIONS } from "../utils/activityLog.js";

const router = express.Router();

const marketingPersonSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(4),
});

const marketingPersonUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  active: z.boolean().optional(),
  password: z.string().min(4).optional(), // omit to keep the existing password unchanged
});

// GET /api/marketing-persons  (admin) — every marketing-team member for this hospital,
// with how many leaders they're associated with and how many leads those leaders have
// brought in, mirroring the stats shown on the Leaders tab.
router.get("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const people = await prisma.marketingPerson.findMany({
    where: { hospitalId: req.user.hospitalId },
    orderBy: { createdAt: "desc" },
    include: {
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
  const data = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  const person = await prisma.marketingPerson.update({ where: { id: req.params.id }, data });

  logActivity({
    actor: req.user,
    action: ACTIONS.MARKETING_PERSON_UPDATED,
    entityType: "MarketingPerson",
    entityId: person.id,
    entityLabel: person.name,
    changes: diffFields(existing, person, ["name", "phone", "email", "active"]),
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

// Card types that reception has to verify (CARD_REVIEW) before a lead can move on. For these,
// a lead that's now PENDING (or further) got there because reception marked the card active.
const CARD_TYPES_NEEDING_CHECK = ["AYUSHMAN", "CAPF", "OTHER"];
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

export default router;
