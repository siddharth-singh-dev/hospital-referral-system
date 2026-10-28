import express from "express";
import prisma from "../utils/prismaClient.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORTS, parseRange, runReport } from "../utils/reports.js";
import { writeExcel, writePdf } from "../utils/reportExport.js";

// The admin Reports section.
//   GET /api/reports                               the list of reports
//   GET /api/reports/:type?from=&to=               one report, as JSON
//   GET /api/reports/:type/export?format=excel|pdf the same report as a download
// Optional filters on every report: marketingPersonId, includeDirect=true (cohort reports only:
// count imported and manually added patients too). Admin only.

const router = express.Router();
router.use(requireAuth, requireRole("ADMIN"));

router.get("/", (req, res) => {
  res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, description: r.description, usesCohort: r.cohort })));
});

// Validates the request and builds the report; sends the error and returns null when it can't.
async function build(req, res) {
  const { type } = req.params;
  if (!REPORTS[type]) { res.status(404).json({ error: "Unknown report" }); return null; }
  const range = parseRange(req.query);
  if (range.error) { res.status(400).json({ error: range.error }); return null; }

  const hospitalId = req.user.hospitalId;
  let marketingPersonId = null;
  let marketingPersonName = null;
  if (req.query.marketingPersonId) {
    const person = await prisma.marketingPerson.findFirst({ where: { id: String(req.query.marketingPersonId), hospitalId }, select: { id: true, name: true } });
    if (!person) { res.status(400).json({ error: "That marketing person was not found" }); return null; }
    marketingPersonId = person.id;
    marketingPersonName = person.name;
  }
  const includeDirect = req.query.includeDirect === "true";

  const report = await runReport(type, { hospitalId, range, marketingPersonId, includeDirect });
  return {
    ...report,
    period: { from: range.from, to: range.to },
    generatedAt: new Date().toISOString(),
    filters: { marketingPerson: marketingPersonName, includeDirect: report.usesCohort ? includeDirect : false },
  };
}

router.get("/:type", async (req, res) => {
  try {
    const report = await build(req, res);
    if (report) res.json(report);
  } catch (err) {
    console.error("Report failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Couldn't build this report" });
  }
});

router.get("/:type/export", async (req, res) => {
  try {
    const report = await build(req, res);
    if (!report) return;
    if (req.query.format === "pdf") writePdf(res, report);
    else await writeExcel(res, report);
  } catch (err) {
    console.error("Report export failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Couldn't export this report" });
  }
});

export default router;
