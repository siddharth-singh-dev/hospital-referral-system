import prisma from "./prismaClient.js";
import { logActivity, ACTIONS } from "./activityLog.js";

// Leads that sit in Pending or Card Activity for too long are rejected automatically, so the
// queues don't fill up with patients who never turned up.
//
// Settings (all optional environment variables — the defaults need no .env change):
//   AUTO_REJECT_AFTER_DAYS     days a lead may wait before it's rejected. Default 3. Set to 0
//                              to switch the whole thing off.
//   AUTO_REJECT_CREATED_AFTER  an ISO date (e.g. 2026-10-08). When set, leads submitted before
//                              it are never auto-rejected — use it to leave an old backlog alone.
//
// The clock runs from when the lead was submitted (createdAt), or from when an admin last
// reverted it back to Pending (reopenedAt) — otherwise a reverted lead would be rejected again
// within the hour, before reception could confirm it.

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000; // hourly
const FIRST_CHECK_DELAY_MS = 60 * 1000; // let the server settle after a restart first

function readConfig() {
  const raw = process.env.AUTO_REJECT_AFTER_DAYS;
  const parsed = raw === undefined || raw === "" ? 3 : Number(raw);
  const days = Number.isFinite(parsed) ? parsed : 3;
  const createdAfter = process.env.AUTO_REJECT_CREATED_AFTER ? new Date(process.env.AUTO_REJECT_CREATED_AFTER) : null;
  return { days, createdAfter: createdAfter && !Number.isNaN(createdAfter.getTime()) ? createdAfter : null };
}

// Rejects every stale Pending/Card Activity lead. Returns how many it rejected.
export async function autoRejectStaleLeads() {
  const { days, createdAfter } = readConfig();
  if (!(days > 0)) return 0;

  const cutoff = new Date(Date.now() - days * DAY_MS);
  const reason = `Auto-rejected: not confirmed within ${days} day${days === 1 ? "" : "s"}`;

  const stale = await prisma.referral.findMany({
    where: {
      status: { in: ["PENDING", "CARD_REVIEW"] },
      OR: [
        { reopenedAt: null, createdAt: { lt: cutoff, ...(createdAfter ? { gte: createdAfter } : {}) } },
        { reopenedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, patientName: true, status: true, doctor: { select: { hospitalId: true } } },
  });

  let rejected = 0;
  for (const r of stale) {
    // Guarded on the status we just read: if reception confirmed or rejected this lead in the
    // meantime (or another server instance got there first), count is 0 and we leave it alone.
    const result = await prisma.referral.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: "REJECTED", rejectedReason: reason },
    });
    if (result.count !== 1) continue;
    rejected++;

    logActivity({
      actor: { hospitalId: r.doctor.hospitalId, name: "System (auto-reject)" },
      action: ACTIONS.REFERRAL_REJECTED,
      entityType: "Referral",
      entityId: r.id,
      entityLabel: r.patientName,
      changes: { status: { from: r.status, to: "REJECTED" } },
      metadata: { reason, automatic: true },
    });
  }
  return rejected;
}

// Called once from index.js after the server starts listening.
export function startAutoRejectJob() {
  const { days, createdAfter } = readConfig();
  if (!(days > 0)) {
    console.log("Auto-reject is off (AUTO_REJECT_AFTER_DAYS=0)");
    return;
  }

  let running = false; // never let two runs overlap
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await autoRejectStaleLeads();
      if (n > 0) console.log(`Auto-rejected ${n} stale lead(s)`);
    } catch (err) {
      console.error("Auto-reject job failed:", err);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, FIRST_CHECK_DELAY_MS).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
  console.log(
    `Auto-reject on: Pending/Card Activity leads older than ${days} day(s) are rejected, checked hourly` +
      (createdAfter ? ` (only leads submitted on/after ${createdAfter.toISOString().slice(0, 10)})` : "")
  );
}
