import prisma from "./prismaClient.js";

// Fire-and-forget, same pattern as logActivity: never let a notification write fail the
// actual request that triggered it. Broadcast to the whole hospital — every ADMIN/RECEPTION/
// STAFF account in it will see this in their bell, with read state tracked per-user.
export async function notify({ hospitalId, type, message, referralId }) {
  try {
    await prisma.notification.create({
      data: { hospitalId, type, message, referralId: referralId || null },
    });
  } catch (err) {
    console.error("Failed to write notification:", err);
  }
}

export const NOTIFICATION_TYPES = {
  CARD_REVIEW_NEW: "CARD_REVIEW_NEW",   // a marketing-submitted lead with a card photo needs verification
  PENDING_NEW: "PENDING_NEW",           // a fresh lead landed in the Pending queue
  REFERRAL_CREDITED: "REFERRAL_CREDITED",
  REFERRAL_REJECTED: "REFERRAL_REJECTED",
};
