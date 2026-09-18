import express from "express";
import prisma from "../utils/prismaClient.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// How far back the bell looks. Keeps the query cheap and the dropdown from ever showing
// ancient events — anything older just ages out of the bell (still sits in the Notification
// table, but nothing currently reads it back past this window).
const WINDOW_DAYS = 30;
const LIST_LIMIT = 50;

function windowStart() {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

// GET /api/notifications  (any logged-in hospital staff — admin, reception, or a custom
// STAFF role) — the last 50 referral-related events for this hospital, from the last 30
// days, each flagged read/unread for the calling user specifically.
router.get("/", requireAuth, requireRole("ADMIN", "RECEPTION", "STAFF"), async (req, res) => {
  const userId = req.user.id;
  const notifications = await prisma.notification.findMany({
    where: { hospitalId: req.user.hospitalId, createdAt: { gte: windowStart() } },
    include: { reads: { where: { userId } } },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });

  const shaped = notifications.map((n) => ({
    id: n.id,
    type: n.type,
    message: n.message,
    referralId: n.referralId,
    createdAt: n.createdAt,
    read: n.reads.length > 0,
  }));
  const unreadCount = shaped.filter((n) => !n.read).length;

  res.json({ notifications: shaped, unreadCount });
});

// POST /api/notifications/:id/read — mark one notification read for the calling user.
// Idempotent: reading an already-read notification is a no-op, not an error.
router.post("/:id/read", requireAuth, requireRole("ADMIN", "RECEPTION", "STAFF"), async (req, res) => {
  const notification = await prisma.notification.findFirst({
    where: { id: req.params.id, hospitalId: req.user.hospitalId },
  });
  if (!notification) return res.status(404).json({ error: "Notification not found" });

  await prisma.notificationRead.upsert({
    where: { notificationId_userId: { notificationId: notification.id, userId: req.user.id } },
    create: { notificationId: notification.id, userId: req.user.id },
    update: {},
  });

  res.json({ message: "Marked as read" });
});

// POST /api/notifications/read-all — mark every currently-unread notification (within the
// same 30-day window the list above uses) read for the calling user in one go.
router.post("/read-all", requireAuth, requireRole("ADMIN", "RECEPTION", "STAFF"), async (req, res) => {
  const userId = req.user.id;
  const unread = await prisma.notification.findMany({
    where: {
      hospitalId: req.user.hospitalId,
      createdAt: { gte: windowStart() },
      reads: { none: { userId } },
    },
    select: { id: true },
  });

  if (unread.length > 0) {
    await prisma.notificationRead.createMany({
      data: unread.map((n) => ({ notificationId: n.id, userId })),
      skipDuplicates: true,
    });
  }

  res.json({ message: "All caught up", markedCount: unread.length });
});

export default router;
