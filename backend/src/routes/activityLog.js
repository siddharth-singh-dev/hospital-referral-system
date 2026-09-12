import express from "express";
import ExcelJS from "exceljs";
import prisma from "../utils/prismaClient.js";
import { requireAuth, requireRole, requireAccess } from "../middleware/auth.js";
import { ACTIONS } from "../utils/activityLog.js";
import { formatDateTime } from "../utils/formatDate.js";

const router = express.Router();
const PAGE_SIZE = 50;

function buildWhere(req) {
  const { entityType, action, actorUserId, from, to } = req.query;
  const where = { hospitalId: req.user.hospitalId };
  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (actorUserId) where.actorUserId = actorUserId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = toDate;
    }
  }
  return where;
}

function actionLabel(action) {
  if (!action) return "";
  return action.split(".").join(" ").split("_").join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatChanges(changes) {
  if (!changes) return "";
  return Object.entries(changes)
    .map(([field, { from, to }]) => `${field}: ${from ?? "—"} → ${to ?? "—"}`)
    .join("; ");
}

function formatMetadata(metadata) {
  if (!metadata) return "";
  return Object.entries(metadata)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("; ");
}

// GET /api/activity-log  (admin only) — paginated, filterable audit trail for this hospital.
// Query params (all optional): entityType, action, actorUserId, from, to, page.
router.get("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const where = buildWhere(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const [total, entries] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      // See the same fix in referrals.js's list route — createdAt alone isn't unique (log
      // entries written in a tight loop, e.g. during a bulk import, can share the exact same
      // timestamp), so pagination needs a secondary, always-unique tiebreaker to avoid
      // silently skipping or duplicating rows across pages.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  res.json({ entries, total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

// GET /api/activity-log/filters  (admin only) — distinct entity types, actions, and actors
// actually present in this hospital's log, so the filter dropdowns only show options that
// will return results, and stay in sync as new action types get logged over time.
router.get("/filters", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const hospitalId = req.user.hospitalId;
  const [entityTypes, actorRows] = await Promise.all([
    prisma.activityLog.findMany({ where: { hospitalId }, distinct: ["entityType"], select: { entityType: true } }),
    prisma.activityLog.findMany({
      where: { hospitalId, actorUserId: { not: null } },
      distinct: ["actorUserId"],
      select: { actorUserId: true, actorName: true },
      orderBy: { actorName: "asc" },
    }),
  ]);

  res.json({
    entityTypes: entityTypes.map((e) => e.entityType).sort(),
    actions: Object.values(ACTIONS).sort(),
    actors: actorRows.map((a) => ({ id: a.actorUserId, name: a.actorName })),
  });
});

// GET /api/activity-log/export/excel  (admin, or STAFF with EXPORT_REPORTS) — every entry
// matching the current filters (not just the current page), as a row-and-column spreadsheet.
router.get("/export/excel", requireAuth, requireAccess(["ADMIN"], ["EXPORT_REPORTS"]), async (req, res) => {
  const entries = await prisma.activityLog.findMany({
    where: buildWhere(req),
    orderBy: { createdAt: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Activity Log");
  sheet.columns = [
    { header: "Timestamp", key: "timestamp", width: 20 },
    { header: "Action", key: "action", width: 22 },
    { header: "Entity Type", key: "entityType", width: 16 },
    { header: "Entity", key: "entityLabel", width: 22 },
    { header: "Done By", key: "actorName", width: 20 },
    { header: "Role", key: "actorRole", width: 12 },
    { header: "What Changed", key: "changes", width: 45 },
    { header: "Details", key: "metadata", width: 45 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const e of entries) {
    sheet.addRow({
      timestamp: formatDateTime(e.createdAt),
      action: actionLabel(e.action),
      entityType: e.entityType,
      entityLabel: e.entityLabel || "",
      actorName: e.actorName,
      actorRole: e.actorRole || "",
      changes: formatChanges(e.changes),
      metadata: formatMetadata(e.metadata),
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=activity-log.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

export default router;
