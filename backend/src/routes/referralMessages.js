import express from "express";
import { z } from "zod";
import prisma from "../utils/prismaClient.js";
import { requireAuth } from "../middleware/auth.js";
import { logActivity, ACTIONS } from "../utils/activityLog.js";
import { notify, NOTIFICATION_TYPES } from "../utils/notifications.js";
import { TEAM_HEAD_PERMISSION } from "../utils/permissions.js";

// The note thread on a lead: a short back-and-forth between reception/admin/staff and the
// marketing person who sent it. Mounted at /api/referrals, so the paths below are
//   GET  /api/referrals/:id/messages
//   POST /api/referrals/:id/messages
//
// Who can do what (all scoped to the caller's own hospital):
//   ADMIN, RECEPTION, and STAFF with MANAGE_REFERRALS — read, and reply at any lead status
//   STAFF with VIEW_REFERRALS only                    — read only
//   MARKETING (the lead's own marketing person)       — read, and reply while the lead is still
//                                                       Pending / Card Activity (the same rule as
//                                                       sending an update from their portal)
//   Team head (VIEW_MY_MARKETING_TEAM)                — read only, and only their team's leads
// Messages are internal: nothing here is reachable from a leader's public dashboard.

const router = express.Router();

const MAX_MESSAGES_PER_LEAD = 100;
const messageSchema = z.object({
  body: z.string().trim().min(1, "Write a message first").max(500, "Keep the message to 500 characters or fewer"),
});

// "STAFF" / "MARKETING" with view + reply flags, or null when this person has no business seeing
// this lead's thread.
function accessFor(user, referral) {
  const perms = user.permissions || [];
  if (user.role === "ADMIN" || user.role === "RECEPTION") return { as: "STAFF", canView: true, canReply: true };
  if (user.role === "STAFF") {
    if (perms.includes("MANAGE_REFERRALS")) return { as: "STAFF", canView: true, canReply: true };
    if (perms.includes("VIEW_REFERRALS")) return { as: "STAFF", canView: true, canReply: false };
    if (perms.includes(TEAM_HEAD_PERMISSION) && referral.doctor.marketingPerson?.headId === user.id) {
      return { as: "HEAD", canView: true, canReply: false };
    }
    return null;
  }
  if (user.role === "MARKETING") {
    if (!user.marketingPersonId || referral.doctor.marketingPersonId !== user.marketingPersonId) return null;
    return { as: "MARKETING", canView: true, canReply: ["PENDING", "CARD_REVIEW"].includes(referral.status) };
  }
  return null;
}

async function loadReferral(req) {
  return prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
    select: {
      id: true, patientName: true, status: true, leadNote: true,
      doctor: { select: { name: true, marketingPersonId: true, marketingPerson: { select: { headId: true, active: true } } } },
    },
  });
}

// A deactivated marketing person's login shouldn't keep working here either.
const marketingInactive = (user, referral) => user.role === "MARKETING" && referral.doctor.marketingPerson?.active === false;

const publicMessage = (m) => ({ id: m.id, senderType: m.senderType, senderName: m.senderName, body: m.body, createdAt: m.createdAt });

router.get("/:id/messages", requireAuth, async (req, res) => {
  const referral = await loadReferral(req);
  const access = referral && !marketingInactive(req.user, referral) ? accessFor(req.user, referral) : null;
  if (!access) return res.status(404).json({ error: "Lead not found" });

  const messages = await prisma.referralMessage.findMany({
    where: { referralId: referral.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Opening the thread is what clears the marketing person's "unread reply" badge.
  if (access.as === "MARKETING" && messages.some((m) => m.senderType === "STAFF" && !m.readAt)) {
    await prisma.referralMessage.updateMany({
      where: { referralId: referral.id, senderType: "STAFF", readAt: null },
      data: { readAt: new Date() },
    });
  }

  res.json({
    leadNote: referral.leadNote,
    status: referral.status,
    canReply: access.canReply,
    messages: messages.map(publicMessage),
  });
});

router.post("/:id/messages", requireAuth, async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid message" });

  const referral = await loadReferral(req);
  const access = referral && !marketingInactive(req.user, referral) ? accessFor(req.user, referral) : null;
  if (!access) return res.status(404).json({ error: "Lead not found" });
  if (!access.canReply) {
    return res.status(access.as === "MARKETING" ? 409 : 403).json({
      error:
        access.as === "MARKETING"
          ? `This lead is already ${referral.status.replace("_", " ").toLowerCase()}, so you can't reply here now. Tell reception directly.`
          : "You can read this conversation but not reply to it",
    });
  }

  const existing = await prisma.referralMessage.count({ where: { referralId: referral.id } });
  if (existing >= MAX_MESSAGES_PER_LEAD) {
    return res.status(400).json({ error: "This conversation is full — please talk directly instead" });
  }

  const message = await prisma.referralMessage.create({
    data: {
      referralId: referral.id,
      senderType: access.as,
      senderUserId: req.user.id || req.user.marketingPersonId || null, // marketing tokens carry marketingPersonId, not id
      senderName: String(req.user.name || (access.as === "MARKETING" ? "Marketing" : "Staff")).slice(0, 191),
      body: parsed.data.body,
    },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_MESSAGE_SENT,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    metadata: { from: access.as, preview: parsed.data.body.slice(0, 120) },
  });

  // Staff replies are seen by the marketing person through the unread badge in their portal.
  // A marketing person's reply goes to the staff bell (it's hospital-wide, so reception and
  // admin both see it). Notification messages are capped at 191 characters.
  if (access.as === "MARKETING") {
    const text = `Reply from ${req.user.name} on ${referral.patientName} (via ${referral.doctor.name})`;
    notify({
      hospitalId: req.user.hospitalId,
      type: NOTIFICATION_TYPES.LEAD_REPLY,
      message: text.length > 191 ? `${text.slice(0, 188)}...` : text,
      referralId: referral.id,
    });
  }

  res.status(201).json({ message: publicMessage(message) });
});

export default router;
