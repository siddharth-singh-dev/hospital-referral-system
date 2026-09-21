import express from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import prisma from "../utils/prismaClient.js";
import { requireAuth, requireRole, requireAccess } from "../middleware/auth.js";
import { startOfIstDay, istDayBounds } from "../utils/istDate.js";
import { formatDate, formatDateTime } from "../utils/formatDate.js";
import { logActivity, diffFields, ACTIONS } from "../utils/activityLog.js";
import { notify, NOTIFICATION_TYPES } from "../utils/notifications.js";
import { normalizePanel } from "../utils/panels.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Referral attachments (a photo of an ID/insurance card, a prescription, etc.) are saved to
// disk rather than the database — these are images, sometimes several MB, and don't belong
// in SQL rows. Stored outside the served /public path since they're never meant to be
// reachable by a guessable URL; the only way to read one back is the authenticated
// GET /:id/attachment route further down, which checks the requester actually has a reason
// to see this particular referral before streaming the file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_DIR = path.join(__dirname, "..", "..", "uploads", "referral-attachments");
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
const uploadAttachment = multer({
  storage: multer.diskStorage({
    destination: ATTACHMENTS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 10) || "";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

const router = express.Router();

// Prevent abuse of the public, unauthenticated referral-submission endpoint
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many submissions from this device. Please try again later." },
});

const referralSchema = z.object({
  doctorCode: z.string().uuid(),
  patientName: z.string().min(1),
  patientAge: z.number().int().positive().max(130),
  patientPhone: z.string().optional(),
  patientGender: z.enum(["MALE", "FEMALE", "OTHER"]),
  panel: z.string().optional(),
  idNumber: z.string().optional(),
  forceType: z.string().optional(),
  wardType: z.string().optional(),
  scanLatitude: z.number().optional(),
  scanLongitude: z.number().optional(),
  scanAccuracyM: z.number().optional(),
});

// Reverse-geocode lat/long into a human readable address using OpenStreetMap Nominatim.
// Best-effort only: if it fails, we still keep the raw coordinates.
async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
      { headers: { "User-Agent": "hospital-referral-system/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}

// Shared filter builder used by the list view and both export endpoints, so exports
// always match whatever the admin currently has filtered/searched for on screen.
function buildWhere(req) {
  const { search, status, doctorId, range, from: fromDate, to: toDate, unpaidOnly, paidOnly } = req.query;
  const where = { doctor: { hospitalId: req.user.hospitalId } };
  if (status) where.status = status;
  if (doctorId) where.doctorId = doctorId;
  // Only meaningful for CREDITED referrals (that's the only status with a credit
  // transaction at all), but harmless to apply regardless — a PENDING/REJECTED referral
  // has no transaction, so it simply won't match either filter.
  if (unpaidOnly === "true") where.transaction = { redeemed: false };
  if (paidOnly === "true") where.transaction = { redeemed: true };
  if (search) {
    where.OR = [
      { patientName: { contains: search } },
      { patientPhone: { contains: search } },
      { fileNumber: { contains: search } },
    ];
  }
  if (fromDate || toDate) {
    // Explicit calendar range from a date picker, interpreted as IST calendar days.
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = istDayBounds(fromDate).start;
    if (toDate) where.createdAt.lt = istDayBounds(toDate).end;
  } else if (range && range !== "all") {
    const now = new Date();
    let from = null;
    if (range === "today") from = startOfIstDay(0);
    else if (range === "7d") from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (range === "30d") from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    else if (range === "90d") from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    if (from) where.createdAt = { gte: from };
  }
  return where;
}

// POST /api/referrals  (public - no auth, this is what the QR code links to)
router.post("/", publicLimiter, async (req, res) => {
  const parsed = referralSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { doctorCode, patientName, patientAge, patientPhone, patientGender, panel, idNumber, forceType, wardType, scanLatitude, scanLongitude, scanAccuracyM } =
    parsed.data;

  const doctor = await prisma.doctor.findUnique({ where: { uniqueCode: doctorCode } });
  if (!doctor || !doctor.active) {
    return res.status(404).json({ error: "This referral link is not valid or is no longer active" });
  }

  let scanAddress = null;
  if (scanLatitude != null && scanLongitude != null) {
    scanAddress = await reverseGeocode(scanLatitude, scanLongitude);
  }

  const referral = await prisma.referral.create({
    data: {
      doctorId: doctor.id,
      patientName,
      patientAge,
      patientPhone,
      patientGender,
      panel: panel || null,
      idNumber: idNumber || null,
      forceType: forceType || null,
      wardType: wardType || null,
      scanLatitude,
      scanLongitude,
      scanAccuracyM,
      scanAddress,
    },
  });

  // No staff account is involved in a public QR submission — attribute the log entry to the
  // referring leader themselves rather than leaving "who did it" blank.
  logActivity({
    actor: { hospitalId: doctor.hospitalId, id: null, name: doctor.name, role: "LEADER" },
    action: ACTIONS.REFERRAL_SUBMITTED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: patientName,
    metadata: { doctorId: doctor.id, doctorName: doctor.name, via: "QR link" },
  });

  notify({
    hospitalId: doctor.hospitalId,
    type: NOTIFICATION_TYPES.PENDING_NEW,
    message: `New pending lead — ${patientName} (via ${doctor.name})`,
    referralId: referral.id,
  });

  res.status(201).json({ message: "Referral submitted successfully", referralId: referral.id });
});

const manualReferralSchema = z.object({
  doctorId: z.string().uuid().optional(),
  newLeaderName: z.string().min(1).optional(),
  patientName: z.string().min(1),
  patientAge: z.number().int().positive().max(130),
  patientPhone: z.string().optional(),
  patientGender: z.enum(["MALE", "FEMALE", "OTHER"]),
  panel: z.string().optional(),
  idNumber: z.string().optional(),
  forceType: z.string().optional(),
  wardType: z.string().optional(),
  // Matches the bulk-import template's fields. All optional, but fileNumber and visitType
  // are a pair — if the file number and visit type are already known at add time (the usual
  // case: reception is entering a patient who's already registered), the referral is created
  // straight as CREDITED, same as one row of a bulk import. Leaving both blank keeps the old
  // behavior: a PENDING lead that still goes through the separate "Confirm lead" step.
  fileNumber: z.string().optional(),
  visitType: z.enum(["IPD", "OPD"]).optional(),
  creditAmount: z.number().nonnegative().optional(),
  admissionDate: z.string().optional(),
  dischargedDate: z.string().optional(),
}).refine((data) => Boolean(data.doctorId) !== Boolean(data.newLeaderName), {
  message: "Provide either an existing leader (doctorId) or a new leader's name, not both or neither",
}).refine((data) => Boolean(data.fileNumber) === Boolean(data.visitType), {
  message: "Provide both File No. and Visit Type together, or leave both blank",
  path: ["fileNumber"],
}).refine((data) => !data.dischargedDate || Boolean(data.fileNumber), {
  message: "Discharged date requires File No. and Visit Type to be set",
  path: ["dischargedDate"],
});

// POST /api/referrals/manual  (reception + admin) - a patient walks in directly (e.g. they
// mention a leader referred them, but never scanned the QR themselves). Reception picks the
// referring leader from a dropdown and enters the patient's details on their behalf.
//
// If File No. and Visit Type are provided (the common case — reception already knows these
// at add time), the referral is created straight as CREDITED and a credit transaction is
// recorded immediately, exactly like one row of a bulk import — no separate confirm step
// needed. If both are left blank, this behaves as before: a PENDING lead that goes through
// the usual "Confirm lead" flow once the patient is registered.
//
// If the leader isn't in the system yet, reception can type a new name instead of picking one
// (newLeaderName) — a minimal leader profile (name only, no phone) is created on the fly and
// can be filled in later from the Leaders tab.
router.post("/manual", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const parsed = manualReferralSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const {
    doctorId, newLeaderName, patientName, patientAge, patientPhone, patientGender,
    panel, idNumber, forceType, wardType,
    fileNumber, visitType, creditAmount, admissionDate, dischargedDate,
  } = parsed.data;

  let doctor;
  let newLeaderCreated = false;
  if (doctorId) {
    doctor = await prisma.doctor.findFirst({ where: { id: doctorId, hospitalId: req.user.hospitalId } });
    if (!doctor) return res.status(404).json({ error: "That leader was not found for this hospital" });
  } else {
    doctor = await prisma.doctor.create({
      data: { name: newLeaderName.trim(), hospitalId: req.user.hospitalId },
    });
    newLeaderCreated = true;
  }

  const submitted = admissionDate ? new Date(admissionDate) : null;
  const discharged = dischargedDate ? new Date(dischargedDate) : null;
  const isCredited = Boolean(fileNumber && visitType);

  let resolvedCreditAmount = null;
  if (isCredited) {
    if (creditAmount !== undefined) {
      resolvedCreditAmount = creditAmount;
    } else {
      const hospital = await prisma.hospital.findUnique({
        where: { id: req.user.hospitalId },
        select: { ipdAmount: true, opdAmount: true },
      });
      resolvedCreditAmount = Number(visitType === "IPD" ? hospital.ipdAmount : hospital.opdAmount);
    }
  }

  const referral = await prisma.referral.create({
    data: {
      doctorId: doctor.id, patientName, patientAge, patientPhone, patientGender,
      panel: panel || null, idNumber: idNumber || null,
      forceType: forceType || null, wardType: wardType || null,
      ...(isCredited
        ? {
            status: "CREDITED",
            fileNumber,
            visitType,
            arrivedAt: submitted || new Date(),
            dischargedAt: discharged || null,
            matchedByUserId: req.user.id,
            ...(submitted ? { createdAt: submitted } : {}),
          }
        : {}),
    },
  });

  if (isCredited && resolvedCreditAmount !== null) {
    await prisma.creditTransaction.create({
      data: {
        doctorId: doctor.id,
        referralId: referral.id,
        amount: resolvedCreditAmount,
        note: `Added by ${req.user.name} — File No. ${fileNumber}`,
        ...(submitted ? { createdAt: submitted } : {}),
      },
    });
  }

  if (newLeaderCreated) {
    logActivity({
      actor: req.user,
      action: ACTIONS.DOCTOR_CREATED,
      entityType: "Doctor",
      entityId: doctor.id,
      entityLabel: doctor.name,
      metadata: { via: "Add patient (new leader typed inline)" },
    });
  }
  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_ADDED_MANUALLY,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: patientName,
    metadata: { doctorId: doctor.id, doctorName: doctor.name, credited: isCredited },
  });

  res.status(201).json({ message: "Patient added successfully", referralId: referral.id, newLeaderCreated, doctorName: doctor.name, credited: isCredited });
});

// GET /api/referrals/bulk-import/template  (admin) - downloadable Excel template for
// backfilling referrals that already happened before this system was in use. Only Name and
// File No. are mandatory; everything else is optional and can be left blank per row.
router.get("/bulk-import/template", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Referred Patients");
  sheet.columns = [
    { header: "Name", key: "name", width: 22 },
    { header: "File No.", key: "fileNumber", width: 16 },
    { header: "Age", key: "age", width: 8 },
    { header: "Gender", key: "gender", width: 10 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Referred By", key: "referredBy", width: 22 },
    { header: "Marketing Person", key: "marketingPerson", width: 22 },
    { header: "Visit Type", key: "visitType", width: 12 },
    { header: "Panel", key: "panel", width: 26 },
    { header: "ID Number", key: "idNumber", width: 20 },
    { header: "Force / Category", key: "forceType", width: 18 },
    { header: "Ward Type", key: "wardType", width: 18 },
    { header: "Credit Amount", key: "creditAmount", width: 14 },
    { header: "Admission Date", key: "admissionDate", width: 16 },
    { header: "Discharged Date", key: "dischargedDate", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({ name: "Ramesh Kumar", fileNumber: "IPD-3001", age: 45, gender: "Male", phone: "9876500000", referredBy: "Dr Niraj", marketingPerson: "Munesh Rana", visitType: "IPD", panel: "CGHS", idNumber: "12345678", forceType: "Pensioner", wardType: "Semi-Private Ward", creditAmount: "", admissionDate: "", dischargedDate: "" });
  sheet.addRow({ name: "Sunita Devi", fileNumber: "OPD-3002", age: 30, gender: "Female", phone: "", referredBy: "", marketingPerson: "", visitType: "OPD", panel: "", idNumber: "", forceType: "", wardType: "", creditAmount: "", admissionDate: "", dischargedDate: "" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=referred-patients-bulk-import-template.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

// POST /api/referrals/bulk-import  (admin) - backfill referrals that already happened before
// this system was in use. Only Name and File No. are required per row — everything else is
// optional. Rows are imported as CREDITED (a file number implies the patient was already
// confirmed/admitted in real life). "Referred By" is matched against existing leaders by
// name (case-insensitive); an unrecognized name auto-creates a new leader, same as the
// leader bulk import. A blank "Referred By" falls back to a shared "Self" leader per
// hospital (created once, reused for every such row). "Marketing Person" is matched/created
// the same way and, if the resolved leader doesn't already have one assigned, links the two —
// it never overwrites a marketing person already set for that leader via the Leaders tab.
router.post("/bulk-import", requireAuth, requireRole("ADMIN"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read this file. Make sure it's a valid .xlsx file." });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    return res.status(400).json({ error: "The uploaded sheet has no data rows." });
  }

  const colIndex = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const key = String(cell.value || "").trim().toLowerCase();
    if (key) colIndex[key] = colNumber;
  });
  const findCol = (...names) => names.map((n) => colIndex[n]).find((v) => v !== undefined) ?? null;

  const nameCol = findCol("name", "patient name");
  const fileNoCol = findCol("file no.", "file no", "file number", "filenumber");
  const ageCol = findCol("age", "patient age");
  const genderCol = findCol("gender", "patient gender");
  const phoneCol = findCol("phone", "mobile", "patient phone");
  const referredByCol = findCol("referred by", "leader", "doctor");
  const marketingPersonCol = findCol("marketing person", "marketing", "through");
  const visitTypeCol = findCol("visit type", "visit", "type");
  const panelCol = findCol("panel");
  // Same fields the OCR card scan and the manual "Add patient" form capture — see
  // Referral.idNumber/forceType/wardType in schema.prisma. Free text on import, same as
  // manual entry — always available regardless of card/panel type.
  const idNumberCol = findCol("id number", "idnumber", "card number", "id / card", "id/card");
  const forceTypeCol = findCol("force / category", "force/category", "force type", "forcetype", "force", "category");
  const wardTypeCol = findCol("ward type", "wardtype", "ward");
  const creditCol = findCol("credit amount", "credit", "amount");
  const submittedCol = findCol("admission date", "admission", "submitted date", "submitted", "date");
  const dischargedCol = findCol("discharged date", "discharge date", "discharged");

  if (!nameCol || !fileNoCol) {
    return res.status(400).json({
      error: "The sheet must have at least a 'Name' column and a 'File No.' column in the first row.",
    });
  }

  const hospital = await prisma.hospital.findUnique({
    where: { id: req.user.hospitalId },
    select: { ipdAmount: true, opdAmount: true },
  });

  // Group existing leaders by lowercased name so a row can be matched by name first, then
  // disambiguated by marketing person only when that name is genuinely shared by more than
  // one real person (see below) — a shared first name, e.g. a generic field-agent name like
  // "Pankaj", "Sachin", or "Vishal", is often reused by completely different marketing
  // employees' own staff. Treating every same-named referrer as one shared leader would
  // silently attribute one employee's patients to another's payout the moment the same name
  // showed up twice under different Marketing Person values — exactly the bug reported from a
  // real import where rows correctly listed different Marketing Person values but reused a
  // referrer name, and all of them ended up locked to whichever one appeared first.
  const existingLeaders = await prisma.doctor.findMany({ where: { hospitalId: req.user.hospitalId } });
  const leadersByName = new Map(); // lowercased name -> Doctor[] (usually one, sometimes several once disambiguated)
  for (const d of existingLeaders) {
    const key = d.name.trim().toLowerCase();
    if (!leadersByName.has(key)) leadersByName.set(key, []);
    leadersByName.get(key).push(d);
  }
  // "Self" placeholder leader(s), used when a row has no "Referred By" name — keyed by
  // marketing person rather than one single shared record. Marketing-person attribution lives
  // on the Doctor row (Doctor.marketingPersonId), not on the Referral itself, so collapsing
  // every blank-"Referred By" row onto one shared "Self" leader would lock ALL of them to
  // whichever marketing person happened to appear in the first such row — exactly the bug
  // reported from a real import where every row correctly listed a different Marketing Person
  // but no Referred By, and all 140 referrals still ended up attributed to just one of them.
  const selfLeaderCache = new Map(
    existingLeaders
      .filter((d) => d.name.trim().toLowerCase() === "self")
      .map((d) => [d.marketingPersonId || "none", d])
  );
  let newLeadersCreated = 0;

  // Same caching approach for marketing persons, matched/created by name.
  const existingMarketingPersons = await prisma.marketingPerson.findMany({ where: { hospitalId: req.user.hospitalId } });
  const marketingCache = new Map(existingMarketingPersons.map((m) => [m.name.trim().toLowerCase(), m]));
  let newMarketingPersonsCreated = 0;

  const getCell = (row, col) => (col ? row.getCell(col).value : null);
  const getText = (row, col) => {
    const v = getCell(row, col);
    return v === null || v === undefined ? "" : String(v).trim();
  };
  const MONTH_INDEX = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  // Parses whatever ended up in the "Submitted Date" / "Discharged Date" cell. Deliberately
  // NOT falling back to `new Date(v)` for a plain string — JS's native parser is unreliable
  // for ambiguous day/month order, and for 2-digit years specifically has a documented quirk:
  // it assumes 19xx, not 20xx (so "18/07/25" meant to be 2025 silently becomes 1925). That bug
  // was traced back to real bulk-imported data showing dates like "18/07/55" instead of 2025,
  // and to leaders whose imported referrals all clustered on the import date in the dashboard's
  // period comparisons — both symptoms of this same root cause (a string that failed or
  // mis-parsed, silently falling back to "now").
  const parseDate = (row, col) => {
    const v = getCell(row, col);
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") {
      // Excel's own "serial date" number (days since 1899-12-30) — happens when a cell holds
      // a date but ExcelJS didn't surface it as a JS Date, e.g. some CSV-derived sheets.
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const str = String(v).trim();
    const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // DD/MM/YYYY or DD-MM-YYYY (Indian convention) — the 4-digit-year case is unambiguous.
    const fourDigitYear = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (fourDigitYear) {
      const [, day, month, year] = fourDigitYear;
      const d = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // Same, but a 2-digit year — assume 2000s rather than JS's native 1900s default, since
    // every plausible "Submitted Date" on this system is recent, never turn-of-the-century.
    const twoDigitYear = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
    if (twoDigitYear) {
      const [, day, month, year] = twoDigitYear;
      const d = new Date(2000 + Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const textMonth = str.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
    if (textMonth) {
      const monthIdx = MONTH_INDEX[textMonth[2].toLowerCase().slice(0, 3)];
      if (monthIdx !== undefined) {
        const d = new Date(Number(textMonth[3]), monthIdx, Number(textMonth[1]));
        return Number.isNaN(d.getTime()) ? null : d;
      }
    }
    return null;
  };
  const parseGender = (text) => {
    const t = text.trim().toLowerCase();
    if (t.startsWith("m")) return "MALE";
    if (t.startsWith("f")) return "FEMALE";
    if (t) return "OTHER";
    return null;
  };
  const parseVisitType = (text) => {
    const t = text.trim().toUpperCase();
    return t === "IPD" || t === "OPD" ? t : null;
  };

  // One row tying every referral created by this upload together, so the whole import can
  // be reviewed and undone as a unit later from "Import history" instead of row-by-row.
  const batch = await prisma.importBatch.create({
    data: {
      hospitalId: req.user.hospitalId,
      fileName: req.file.originalname || null,
      importedByUserId: req.user.id,
      importedByName: req.user.name,
    },
  });

  const created = [];
  const skipped = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const name = getText(row, nameCol);
    const fileNumber = getText(row, fileNoCol);

    if (!name && !fileNumber) continue; // silently skip fully blank rows

    if (!name || !fileNumber) {
      skipped.push({ row: rowNumber, reason: !name ? "Missing name" : "Missing file number" });
      continue;
    }

    try {
      // Resolve the marketing person for this row (optional), matched by name or auto-created.
      const marketingPersonText = getText(row, marketingPersonCol);
      let marketingPersonId = null;
      if (marketingPersonText) {
        const mKey = marketingPersonText.toLowerCase();
        let marketingPerson = marketingCache.get(mKey);
        if (!marketingPerson) {
          marketingPerson = await prisma.marketingPerson.create({ data: { name: marketingPersonText, hospitalId: req.user.hospitalId } });
          marketingCache.set(mKey, marketingPerson);
          newMarketingPersonsCreated += 1;
        }
        marketingPersonId = marketingPerson.id;
      }

      // Resolve the referring leader: existing match (by name, disambiguated by marketing
      // person when needed), quick-create, or fall back to "Self".
      const referredByText = getText(row, referredByCol);
      let doctor;
      if (referredByText) {
        const nameKey = referredByText.toLowerCase();
        const candidates = leadersByName.get(nameKey) || [];
        if (!marketingPersonId) {
          // No marketing person given for this row — nothing to disambiguate against, so
          // match ANY existing leader with this name (or create one), same as always.
          doctor = candidates[0];
          if (!doctor) {
            doctor = await prisma.doctor.create({ data: { name: referredByText, hospitalId: req.user.hospitalId, marketingPersonId: null } });
            newLeadersCreated += 1;
            candidates.push(doctor);
            leadersByName.set(nameKey, candidates);
          }
        } else {
          doctor = candidates.find((d) => d.marketingPersonId === marketingPersonId);
          if (!doctor) {
            // No leader by this name already scoped to this exact marketing person. Prefer
            // filling in a candidate that has no marketing person set yet (the common case:
            // one real, persistent leader whose Marketing Person is only sometimes filled in)
            // over creating a new record.
            const blank = candidates.find((d) => !d.marketingPersonId);
            if (blank) {
              doctor = await prisma.doctor.update({ where: { id: blank.id }, data: { marketingPersonId } });
              candidates[candidates.indexOf(blank)] = doctor;
            } else {
              // Either no leader by this name exists yet, or every existing one already
              // belongs to a DIFFERENT marketing person — the generic-field-agent-name
              // collision case. Create a separate leader scoped to this specific marketing
              // person rather than reusing (and silently misattributing under) an unrelated
              // one that just happens to share a name.
              doctor = await prisma.doctor.create({ data: { name: referredByText, hospitalId: req.user.hospitalId, marketingPersonId } });
              newLeadersCreated += 1;
              candidates.push(doctor);
            }
            leadersByName.set(nameKey, candidates);
          }
        }
      } else {
        const selfKey = marketingPersonId || "none";
        let selfLeader = selfLeaderCache.get(selfKey);
        if (!selfLeader) {
          selfLeader = await prisma.doctor.create({ data: { name: "Self", hospitalId: req.user.hospitalId, marketingPersonId } });
          selfLeaderCache.set(selfKey, selfLeader);
          newLeadersCreated += 1;
        }
        doctor = selfLeader;
      }

      const ageText = getText(row, ageCol);
      const patientAge = ageText && !Number.isNaN(Number(ageText)) ? Math.round(Number(ageText)) : 0;
      const patientGender = parseGender(getText(row, genderCol));
      const patientPhone = getText(row, phoneCol) || null;
      const visitType = parseVisitType(getText(row, visitTypeCol));
      const panel = normalizePanel(getText(row, panelCol));
      const idNumber = getText(row, idNumberCol) || null;
      const forceType = getText(row, forceTypeCol) || null;
      const wardType = getText(row, wardTypeCol) || null;
      const submittedDate = parseDate(row, submittedCol);
      const dischargedDate = parseDate(row, dischargedCol);

      const explicitCreditText = getText(row, creditCol);
      const explicitCredit = explicitCreditText && !Number.isNaN(Number(explicitCreditText)) ? Number(explicitCreditText) : null;
      const derivedAmount = visitType === "IPD" ? Number(hospital.ipdAmount) : visitType === "OPD" ? Number(hospital.opdAmount) : null;
      const creditAmount = explicitCredit ?? derivedAmount;

      const referral = await prisma.referral.create({
        data: {
          doctorId: doctor.id,
          patientName: name,
          patientAge,
          patientPhone,
          patientGender,
          status: "CREDITED",
          fileNumber,
          visitType,
          panel,
          idNumber,
          forceType,
          wardType,
          arrivedAt: submittedDate || new Date(),
          dischargedAt: dischargedDate,
          importBatchId: batch.id,
          ...(submittedDate ? { createdAt: submittedDate } : {}),
        },
      });

      if (creditAmount !== null) {
        await prisma.creditTransaction.create({
          data: {
            doctorId: doctor.id,
            referralId: referral.id,
            amount: creditAmount,
            note: `Bulk-imported by ${req.user.name} — File No. ${fileNumber}`,
            // Backdate to match the referral's own createdAt (the Excel row's Submitted
            // Date) — otherwise every bulk-imported credit is dated "whenever the import
            // ran," which bunches them all into the same day and makes the dashboard's
            // 7D/30D/3M/6M/1Y period toggle show identical results regardless of period.
            ...(submittedDate ? { createdAt: submittedDate } : {}),
          },
        });
      }

      created.push({ row: rowNumber, id: referral.id, name });
    } catch {
      skipped.push({ row: rowNumber, reason: "Could not save this row due to an unexpected error" });
    }
  }

  if (created.length === 0) {
    // Nothing actually landed (every row was skipped) — don't leave a phantom empty
    // batch cluttering the import history.
    await prisma.importBatch.delete({ where: { id: batch.id } });
  } else {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { createdCount: created.length, skippedCount: skipped.length },
    });
    // One summary log entry for the whole upload rather than one per row — a bulk import can
    // be hundreds of rows, and the Import History screen already covers row-level detail.
    logActivity({
      actor: req.user,
      action: ACTIONS.REFERRAL_BULK_IMPORTED,
      entityType: "ImportBatch",
      entityId: batch.id,
      entityLabel: batch.fileName || "Bulk import",
      metadata: { createdCount: created.length, skippedCount: skipped.length, newLeadersCreated, newMarketingPersonsCreated },
    });
  }

  res.json({
    createdCount: created.length,
    skippedCount: skipped.length,
    skipped,
    newLeadersCreated,
    newMarketingPersonsCreated,
    batchId: created.length > 0 ? batch.id : null,
  });
});

// GET /api/referrals/bulk-import/batches  (admin) - history of past "Bulk import" uploads on
// the All Referrals tab, so an admin can find one and undo it if it was done in error (wrong
// file, duplicated upload, etc). Most recent first.
router.get("/bulk-import/batches", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const batches = await prisma.importBatch.findMany({
    where: { hospitalId: req.user.hospitalId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: {
      referrals: { select: { transaction: { select: { redeemed: true } } } },
    },
  });

  res.json({
    batches: batches.map((b) => ({
      id: b.id,
      fileName: b.fileName,
      importedByName: b.importedByName,
      createdCount: b.createdCount,
      skippedCount: b.skippedCount,
      // How many of the originally-imported rows are still present & undeletable-as-is.
      // Can be lower than createdCount if some rows were since deleted/edited individually.
      remainingCount: b.referrals.length,
      redeemedCount: b.referrals.filter((r) => r.transaction?.redeemed).length,
      createdAt: b.createdAt,
      revertedAt: b.revertedAt,
    })),
  });
});

// POST /api/referrals/bulk-import/batches/:batchId/revert  (admin) - undoes one bulk import:
// deletes every referral (and any credit it generated) that this upload created. Refuses if
// any of those credits have already been marked "Paid" (redeemed) — that means money may
// already have changed hands, so those rows need a human to look at them individually rather
// than being silently deleted.
router.post("/bulk-import/batches/:batchId/revert", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const batch = await prisma.importBatch.findFirst({
    where: { id: req.params.batchId, hospitalId: req.user.hospitalId },
  });
  if (!batch) return res.status(404).json({ error: "Import batch not found" });
  if (batch.revertedAt) return res.status(400).json({ error: "This import was already reverted" });

  const referrals = await prisma.referral.findMany({
    where: { importBatchId: batch.id },
    select: { id: true, transaction: { select: { redeemed: true } } },
  });

  const redeemedCount = referrals.filter((r) => r.transaction?.redeemed).length;
  if (redeemedCount > 0) {
    return res.status(409).json({
      error:
        `${redeemedCount} patient${redeemedCount === 1 ? "" : "s"} from this import already have a credit ` +
        `payout marked "Paid" — those can't be auto-reverted. Please handle those rows individually first, ` +
        `then try again.`,
      redeemedCount,
    });
  }

  const referralIds = referrals.map((r) => r.id);
  await prisma.$transaction([
    prisma.creditTransaction.deleteMany({ where: { referralId: { in: referralIds } } }),
    prisma.referral.deleteMany({ where: { id: { in: referralIds } } }),
    prisma.importBatch.update({
      where: { id: batch.id },
      data: { revertedAt: new Date(), revertedByUserId: req.user.id },
    }),
  ]);

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_BULK_IMPORT_REVERTED,
    entityType: "ImportBatch",
    entityId: batch.id,
    entityLabel: batch.fileName || "Bulk import",
    metadata: { revertedCount: referralIds.length },
  });

  res.json({ revertedCount: referralIds.length });
});

// PATCH /api/referrals/:id/panel  (reception + admin) - set or clear which insurance
// company / TPA / government scheme / corporate account this patient's treatment is
// billed against. Independent of status, so it can be set any time reception knows it.
router.patch("/:id/panel", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const { panel } = req.body || {};
  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });

  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: { panel: panel ? String(panel).trim() : null },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_PANEL_UPDATED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    changes: diffFields(referral, updated, ["panel"]),
  });

  res.json(updated);
});

// Fields an admin can fix up after the fact from the "All Referrals" table's inline edit —
// deliberately a superset of what the manual-add form captures, since this is also how a
// mistyped bulk-import row or a bad OCR read gets corrected later.
// Fields an admin can fix up after the fact from the "All Referrals" table's inline edit —
// deliberately a superset of what the manual-add form captures, since this is also how a
// mistyped bulk-import row or a bad OCR read gets corrected later. "Referred by" (doctorId)
// and Marketing Person are deliberately NOT editable here — the referring leader is fixed
// once a referral exists, and Marketing Person is always derived from that leader, never
// entered directly (see /referrals/manual).
const referralEditSchema = z.object({
  patientName: z.string().min(1).optional(),
  patientAge: z.number().int().positive().max(130).optional(),
  patientGender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  patientPhone: z.string().nullable().optional(),
  fileNumber: z.string().nullable().optional(),
  panel: z.string().nullable().optional(),
  idNumber: z.string().nullable().optional(),
  forceType: z.string().nullable().optional(),
  wardType: z.string().nullable().optional(),
  visitType: z.enum(["IPD", "OPD"]).nullable().optional(),
  admissionDate: z.string().nullable().optional(),
  dischargedDate: z.string().nullable().optional(),
  creditAmount: z.number().nonnegative().nullable().optional(),
});

// PATCH /api/referrals/:id  (admin + reception with MANAGE_REFERRALS) — full row edit from the
// "All Referrals" table, as opposed to /:id/panel which only ever touched the panel field.
router.patch("/:id", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const parsed = referralEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
    include: { transaction: true },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });

  const body = parsed.data;
  const data = {};

  for (const key of ["patientName", "patientAge", "patientGender"]) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  for (const key of ["patientPhone", "fileNumber", "panel", "idNumber", "forceType", "wardType", "visitType"]) {
    if (body[key] === undefined) continue;
    data[key] = typeof body[key] === "string" ? (body[key].trim() || null) : body[key];
  }
  if (body.admissionDate !== undefined) {
    // "In:" on the All Referrals list is driven by createdAt, not arrivedAt (see the bulk-import
    // and manual-add routes, which set both together for a one-step CREDITED entry) — so both
    // need updating together for the edit to actually change what's shown. createdAt itself
    // can't be nulled out (it's required), so clearing the date only clears arrivedAt.
    if (body.admissionDate) {
      data.createdAt = new Date(body.admissionDate);
      data.arrivedAt = new Date(body.admissionDate);
    } else {
      data.arrivedAt = null;
    }
  }
  if (body.dischargedDate !== undefined) data.dischargedAt = body.dischargedDate ? new Date(body.dischargedDate) : null;

  if (body.creditAmount !== undefined) {
    if (!referral.transaction) {
      return res.status(400).json({ error: "This referral hasn't been credited yet, so there's no credit amount to edit." });
    }
    await prisma.creditTransaction.update({
      where: { referralId: referral.id },
      data: { amount: body.creditAmount },
    });
  }

  if (Object.keys(data).length === 0 && body.creditAmount === undefined) {
    return res.status(400).json({ error: "No changes provided" });
  }

  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data,
    include: {
      doctor: { select: { name: true, clinicName: true, phone: true, creditAmount: true, marketingPerson: { select: { id: true, name: true } } } },
      transaction: { select: { id: true, amount: true, redeemed: true, redeemedAt: true } },
    },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_DETAILS_UPDATED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: updated.patientName,
    changes: {
      ...diffFields(referral, updated, Object.keys(data)),
      ...(body.creditAmount !== undefined && Number(referral.transaction?.amount) !== body.creditAmount
        ? { creditAmount: { from: referral.transaction?.amount ?? null, to: body.creditAmount } }
        : {}),
    },
  });

  res.json(updated);
});

// GET /api/referrals?search=name_or_phone&status=PENDING&page=1&pageSize=50  (reception + admin)
// Scoped to the logged-in staff member's own hospital, via each referral's doctor.
// Paginated server-side — returns { referrals, total, page, pageSize } rather than a raw
// array, so large historical imports (500+ rows) don't get silently truncated.
router.get("/", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["VIEW_REFERRALS", "MANAGE_REFERRALS"]), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
  const where = buildWhere(req);

  const [referrals, total] = await Promise.all([
    prisma.referral.findMany({
      where,
      include: {
        doctor: { select: { name: true, clinicName: true, phone: true, creditAmount: true, marketingPerson: { select: { id: true, name: true } } } },
        transaction: { select: { id: true, amount: true, redeemed: true, redeemedAt: true } },
      },
      // createdAt alone isn't unique — bulk imports routinely give many rows the exact same
      // timestamp (e.g. a batch of patients sharing one admission date). Without a tiebreaker,
      // MySQL doesn't guarantee a stable order for those ties across separate paginated
      // queries, which silently drops some rows between pages (they land on neither page,
      // even though a direct, non-paginated search still finds them fine) and can duplicate
      // others. `id` is always unique, so adding it as a secondary sort key makes the order
      // fully deterministic no matter how many rows share a createdAt.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.referral.count({ where }),
  ]);

  res.json({ referrals, total, page, pageSize });
});

// GET /api/referrals/status-counts  (reception + admin, same access as the list above) —
// small/cheap endpoint just for badge counts (e.g. the "Card Activity" tab), so the UI
// doesn't have to fetch a full paginated page of a tab just to know how many rows are in it.
// Scoped to the caller's hospital, same as the list route.
router.get("/status-counts", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["VIEW_REFERRALS", "MANAGE_REFERRALS"]), async (req, res) => {
  const grouped = await prisma.referral.groupBy({
    by: ["status"],
    where: { doctor: { hospitalId: req.user.hospitalId } },
    _count: { _all: true },
  });
  const counts = { CARD_REVIEW: 0, PENDING: 0, ARRIVED: 0, CREDITED: 0, REJECTED: 0 };
  for (const row of grouped) counts[row.status] = row._count._all;
  res.json(counts);
});

// GET /api/referrals/export/excel  (admin) — respects the same search/status filters as the list view
router.get("/export/excel", requireAuth, requireAccess(["ADMIN"], ["EXPORT_REPORTS"]), async (req, res) => {
  const referrals = await prisma.referral.findMany({
    where: buildWhere(req),
    include: { doctor: true, transaction: true },
    orderBy: [{ doctor: { name: "asc" } }, { createdAt: "asc" }],
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Referrals");
  sheet.columns = [
    { header: "Patient Name", key: "patientName", width: 22 },
    { header: "File No.", key: "fileNumber", width: 16 },
    { header: "Age", key: "patientAge", width: 8 },
    { header: "Gender", key: "patientGender", width: 10 },
    { header: "Phone", key: "patientPhone", width: 16 },
    { header: "Referred By", key: "doctorName", width: 22 },
    { header: "Clinic", key: "clinicName", width: 22 },
    { header: "Status", key: "status", width: 12 },
    { header: "Visit Type", key: "visitType", width: 12 },
    { header: "Credit Amount (pts)", key: "creditAmount", width: 16 },
    { header: "Location", key: "location", width: 40 },
    { header: "Submitted At", key: "createdAt", width: 20 },
    { header: "Resolved At", key: "arrivedAt", width: 20 },
    { header: "Discharged At", key: "dischargedAt", width: 20 },
    { header: "Panel", key: "panel", width: 26 },
    { header: "ID Number", key: "idNumber", width: 20 },
    { header: "Force / Category", key: "forceType", width: 18 },
    { header: "Ward Type", key: "wardType", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const r of referrals) {
    sheet.addRow({
      patientName: r.patientName,
      fileNumber: r.fileNumber || "",
      patientAge: r.patientAge,
      patientGender: r.patientGender || "",
      patientPhone: r.patientPhone || "",
      doctorName: r.doctor.name,
      clinicName: r.doctor.clinicName || "",
      status: r.status,
      visitType: r.visitType || "",
      creditAmount: r.transaction ? Number(r.transaction.amount) : "",
      location: r.scanAddress || (r.scanLatitude != null ? `${r.scanLatitude}, ${r.scanLongitude}` : ""),
      createdAt: formatDateTime(r.createdAt),
      arrivedAt: r.arrivedAt ? formatDateTime(r.arrivedAt) : "",
      dischargedAt: r.dischargedAt ? formatDateTime(r.dischargedAt) : "",
      panel: r.panel || "",
      idNumber: r.idNumber || "",
      forceType: r.forceType || "",
      wardType: r.wardType || "",
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=referrals.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

// GET /api/referrals/export/pdf  (admin) — same filters, proper column-aligned table.
// One flat table sorted by date (most recent admission first) rather than grouped by leader —
// grouping by leader made the date order essentially random within each group and buried
// recent activity under whichever leader happened to sort first alphabetically.
router.get("/export/pdf", requireAuth, requireAccess(["ADMIN"], ["EXPORT_REPORTS"]), async (req, res) => {
  const referrals = await prisma.referral.findMany({
    where: buildWhere(req),
    include: { doctor: true, transaction: true },
    // id as a tiebreaker keeps the order fully deterministic when many rows share the exact
    // same admission date (common after a bulk import) — see the same fix applied to the
    // paginated "All Referrals" list for why an unstable tiebreak-free sort is a real bug,
    // not just a style choice.
    orderBy: [{ arrivedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=referrals.pdf");

  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
  doc.pipe(res);

  const startX = doc.page.margins.left;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  function addLandscapePage() {
    doc.addPage({ margin: 36, size: "A4", layout: "landscape" });
  }

  // Compact widths for landscape A4 — sums to ~680pt, comfortably inside the ~770pt usable
  // width (842pt page minus 36pt margins on each side).
  const columns = [
    { key: "num", label: "#", width: 20 },
    { key: "patient", label: "Patient", width: 90 },
    { key: "fileNumber", label: "File No.", width: 55 },
    { key: "referredBy", label: "Referred By", width: 90 },
    { key: "ageGender", label: "A/G", width: 36 },
    { key: "status", label: "Status", width: 50 },
    { key: "visitType", label: "Visit", width: 32 },
    { key: "credit", label: "Credit", width: 48 },
    { key: "payout", label: "Payout", width: 42 },
    { key: "admission", label: "Admission", width: 58 },
    { key: "discharged", label: "Discharged", width: 58 },
    { key: "idCard", label: "ID / Card", width: 100 },
  ];
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);

  function drawColumnHeader(y) {
    let x = startX;
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#252e69");
    columns.forEach((c) => { doc.text(c.label, x, y, { width: c.width, height: 13, ellipsis: true }); x += c.width; });
    doc.moveTo(startX, y + 13).lineTo(startX + tableWidth, y + 13).strokeColor("#d0d5dd").stroke();
    doc.font("Helvetica").fillColor("#101733");
    return y + 18;
  }

  doc.fontSize(16).font("Helvetica-Bold").text("Referral Report", { align: "center" });
  doc.font("Helvetica").fontSize(9).fillColor("#667085").text(`Generated ${formatDateTime(new Date())} — sorted by admission date, most recent first`, { align: "center" });
  doc.fillColor("#101733");
  let y = doc.y + 14;
  y = drawColumnHeader(y);

  referrals.forEach((r, i) => {
    const ageGender = `${r.patientAge}${r.patientGender ? "/" + r.patientGender.charAt(0) : ""}`;
    const credit = r.transaction ? `${Number(r.transaction.amount).toFixed(2)} pts` : "-";
    const payout = r.transaction ? (r.transaction.redeemed ? "Paid" : "Unpaid") : "-";
    // "Admission" is arrivedAt (set when reception confirms/credits the patient — see the
    // manual-add and bulk-import routes, which set arrivedAt and createdAt together), falling
    // back to createdAt for older rows predating that field.
    const admission = r.arrivedAt || r.createdAt ? formatDate(r.arrivedAt || r.createdAt) : "-";
    const discharged = r.dischargedAt ? formatDate(r.dischargedAt) : "-";

    const rowValues = [i + 1, r.patientName, r.fileNumber || "-", r.doctor.name, ageGender, r.status, r.visitType || "-", credit, payout, admission, discharged, r.idNumber || "-"];
    let x = startX;
    doc.fontSize(9);
    // height + ellipsis forces each cell to stay on a single line and truncate with "…"
    // rather than wrapping — a manually character-sliced string was overflowing the column
    // width and wrapping onto a second line for anything with a wide font (bold headers,
    // long names), which visually overlapped the row underneath it.
    columns.forEach((c, ci) => { doc.text(String(rowValues[ci]), x, y, { width: c.width, height: 13, ellipsis: true }); x += c.width; });
    y += 16;

    if (y > pageBottom - 20) {
      addLandscapePage();
      y = doc.page.margins.top;
      y = drawColumnHeader(y);
    }
  });

  if (referrals.length === 0) {
    doc.text("No referrals match the current filters.", startX, y);
  }

  doc.end();
});

// Strips everything but letters/digits and uppercases, so two entries of "the same" card
// number typed/read with different spacing ("BR 0000 0191 6229" vs "BR0000-0191-6229") still
// compare equal.
function normalizeIdNumber(v) {
  return (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// A masked Aadhaar number ("XXXX XXXX 1234") only carries 4 real digits — two different
// patients whose Aadhaar numbers happen to share the same last 4 digits produce the exact
// same masked string, so this shape is too collision-prone to trust for duplicate-admission
// matching. Ayushman/CGHS/ECHS/CAPF numbers aren't masked and don't have this problem.
function isMaskedAadhaar(idNumber) {
  return /^X{8}\d{4}$/.test(normalizeIdNumber(idNumber));
}

// POST /api/referrals/:id/arrive  (reception + admin) - confirm patient match, credit the doctor.
// Reception must record the patient's IPD/OPD file number and whether this was an IPD or
// OPD visit; the credited amount is derived from the hospital's admin-fixed IPD/OPD
// amounts, not entered manually, so it can no longer be overridden per referral.
router.post("/:id/arrive", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const { fileNumber, visitType, idNumber: bodyIdNumber } = req.body || {};

  if (!fileNumber || !String(fileNumber).trim()) {
    return res.status(400).json({ error: "A file number is required to confirm this lead" });
  }
  if (visitType !== "IPD" && visitType !== "OPD") {
    return res.status(400).json({ error: "Visit type must be either IPD or OPD" });
  }

  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
    include: { doctor: true },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });
  if (referral.status !== "PENDING") {
    return res.status(400).json({ error: `Referral is already ${referral.status.toLowerCase()}` });
  }

  // A card/ID number is mandatory at the point of admission — without one, the
  // already-admitted-elsewhere check just below (the whole reason this is enforced) has
  // nothing to compare against. Whatever was captured earlier at submission (if anything)
  // can still be corrected here; reception must supply one if none exists yet.
  const finalIdNumber = (bodyIdNumber?.trim() || referral.idNumber?.trim() || "");
  if (!finalIdNumber) {
    return res.status(400).json({ error: "A card/ID number is required to confirm this lead" });
  }
  if (normalizeIdNumber(finalIdNumber).length < 4) {
    return res.status(400).json({ error: "Please enter a valid card/ID number" });
  }

  // Same card/ID number already sitting on an active (credited, not-yet-discharged) referral
  // elsewhere in this hospital — almost certainly the same patient submitted twice, whether
  // by accident or via two different leaders/marketing employees. Block the confirm rather
  // than double-crediting a doctor (or two doctors) for one admission; reception discharges
  // the existing visit first if this really is a separate, later visit.
  const normalizedId = normalizeIdNumber(finalIdNumber);
  if (normalizedId.length >= 6 && !isMaskedAadhaar(finalIdNumber)) {
    const activeCandidates = await prisma.referral.findMany({
      where: {
        id: { not: referral.id },
        doctor: { hospitalId: req.user.hospitalId },
        status: "CREDITED",
        dischargedAt: null,
        idNumber: { not: null },
      },
      include: { doctor: true },
    });
    const activeAdmission = activeCandidates.find((c) => normalizeIdNumber(c.idNumber) === normalizedId);
    if (activeAdmission) {
      return res.status(409).json({
        error: `Already admitted, not yet discharged — ${activeAdmission.patientName} (File No. ${activeAdmission.fileNumber}, via ${activeAdmission.doctor.name}). Discharge that visit first if this is genuinely a new one, or this looks like a duplicate lead.`,
      });
    }
  }

  const hospital = await prisma.hospital.findUnique({
    where: { id: req.user.hospitalId },
    select: { ipdAmount: true, opdAmount: true },
  });
  const amount = visitType === "IPD" ? hospital.ipdAmount : hospital.opdAmount;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: "CREDITED",
        arrivedAt: new Date(),
        matchedByUserId: req.user.id,
        fileNumber: String(fileNumber).trim(),
        visitType,
        idNumber: finalIdNumber,
      },
    });

    const transaction = await tx.creditTransaction.create({
      data: {
        doctorId: referral.doctorId,
        referralId: referral.id,
        amount,
        note: `Confirmed by ${req.user.name} — ${visitType} — File No. ${String(fileNumber).trim()}`,
      },
    });

    return { updated, transaction };
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_CREDITED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    metadata: { visitType, fileNumber: String(fileNumber).trim(), amount: Number(amount), doctorName: referral.doctor.name },
  });

  notify({
    hospitalId: req.user.hospitalId,
    type: NOTIFICATION_TYPES.REFERRAL_CREDITED,
    message: `Credited — ${referral.patientName} (${visitType}, ${referral.doctor.name})`,
    referralId: referral.id,
  });

  res.json(result);
});

// POST /api/referrals/:id/convert-to-ipd  (reception + admin) - a lead originally confirmed
// as OPD later gets admitted. Updates the file number to the new IPD file number and bumps
// the doctor's credit from the OPD amount up to the (admin-fixed) IPD amount. Blocked once
// the OPD credit has already been paid out, since silently changing a paid amount would
// break the payout record — accounts should adjust that case manually.
router.post("/:id/convert-to-ipd", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const { fileNumber } = req.body || {};

  if (!fileNumber || !String(fileNumber).trim()) {
    return res.status(400).json({ error: "The new IPD file number is required to convert this lead" });
  }

  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
    include: { doctor: true, transaction: true },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });
  if (referral.status !== "CREDITED") {
    return res.status(400).json({ error: "Only a confirmed (credited) lead can be converted to IPD" });
  }
  if (referral.visitType !== "OPD") {
    return res.status(400).json({ error: "This lead is not currently an OPD visit" });
  }
  if (referral.transaction?.redeemed) {
    return res.status(400).json({
      error: "This lead's OPD credit has already been paid out. Please ask accounts to adjust it manually instead.",
    });
  }

  const hospital = await prisma.hospital.findUnique({
    where: { id: req.user.hospitalId },
    select: { ipdAmount: true },
  });
  const previousAmount = referral.transaction ? Number(referral.transaction.amount) : 0;
  const newAmount = Number(hospital.ipdAmount);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.referral.update({
      where: { id: referral.id },
      data: {
        visitType: "IPD",
        fileNumber: String(fileNumber).trim(),
        convertedAt: new Date(),
      },
    });

    const transaction = referral.transaction
      ? await tx.creditTransaction.update({
          where: { id: referral.transaction.id },
          data: {
            amount: newAmount,
            note: `${referral.transaction.note || ""} | Converted OPD→IPD by ${req.user.name}: ${previousAmount.toFixed(2)} → ${newAmount.toFixed(2)} pts, file no. ${String(fileNumber).trim()}`,
          },
        })
      : await tx.creditTransaction.create({
          data: {
            doctorId: referral.doctorId,
            referralId: referral.id,
            amount: newAmount,
            note: `Converted OPD→IPD by ${req.user.name} — File No. ${String(fileNumber).trim()}`,
          },
        });

    return { updated, transaction };
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_CONVERTED_TO_IPD,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    changes: { amount: { from: previousAmount, to: newAmount }, visitType: { from: "OPD", to: "IPD" } },
    metadata: { fileNumber: String(fileNumber).trim() },
  });

  res.json(result);
});

// POST /api/referrals/:id/discharge  (reception + admin) - marks the patient as discharged,
// recording the exact date/time. Only valid for a CREDITED referral that hasn't already
// been discharged. Shown back to the referring leader on their own dashboard.
router.post("/:id/discharge", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });
  if (referral.status !== "CREDITED") {
    return res.status(400).json({ error: "Only a confirmed (credited) lead can be discharged" });
  }
  if (referral.dischargedAt) {
    return res.status(400).json({ error: "This patient has already been marked as discharged" });
  }

  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: { dischargedAt: new Date() },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_DISCHARGED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
  });

  res.json(updated);
});

// POST /api/referrals/:id/reject  (reception + admin) - not a valid match
router.post("/:id/reject", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const { reason } = req.body;
  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });

  const updated = await prisma.referral.update({
    where: { id: req.params.id },
    data: { status: "REJECTED", rejectedReason: reason || "No reason given" },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_REJECTED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    changes: { status: { from: referral.status, to: "REJECTED" } },
    metadata: { reason: reason || "No reason given" },
  });

  notify({
    hospitalId: req.user.hospitalId,
    type: NOTIFICATION_TYPES.REFERRAL_REJECTED,
    message: `Rejected — ${referral.patientName}`,
    referralId: referral.id,
  });

  res.json(updated);
});

// POST /api/referrals/:id/revert  (admin only) - undo a rejection, putting the referral
// back to PENDING so reception can confirm it after all. Only admins can do this, since
// reception rejecting is meant to be a considered decision that shouldn't be casually
// second-guessed at the reception desk itself.
router.post("/:id/revert", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });
  if (referral.status !== "REJECTED") {
    return res.status(400).json({ error: "Only a rejected referral can be reverted" });
  }

  const updated = await prisma.referral.update({
    where: { id: req.params.id },
    data: { status: "PENDING", rejectedReason: null },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_REVERTED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    changes: { status: { from: "REJECTED", to: "PENDING" } },
  });

  res.json(updated);
});

// POST /api/referrals/:id/redeem  (admin, or STAFF with REDEEM_CREDITS) — mark this
// referral's credit as paid out to the doctor. This is distinct from "confirming
// arrival": confirming creates the credit (owed but unpaid); redeeming marks it paid.
router.post("/:id/redeem", requireAuth, requireAccess(["ADMIN"], ["REDEEM_CREDITS"]), async (req, res) => {
  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
    include: { transaction: true },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });
  if (!referral.transaction) return res.status(400).json({ error: "This referral has no credit to redeem" });
  if (referral.transaction.redeemed) return res.status(400).json({ error: "This credit has already been redeemed" });

  const { paymentMethod, referenceNumber, remarks, amount } = req.body || {};
  const data = { redeemed: true, redeemedAt: new Date(), redeemedByUserId: req.user.id };
  if (paymentMethod) data.paymentMethod = paymentMethod;
  if (referenceNumber) data.referenceNumber = referenceNumber;
  if (remarks) data.remarks = remarks;
  if (amount !== undefined) {
    const parsedAmount = Number(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({ error: "Amount must be a non-negative number" });
    }
    data.amount = parsedAmount;
  }

  const updated = await prisma.creditTransaction.update({
    where: { id: referral.transaction.id },
    data,
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.CREDIT_REDEEMED,
    entityType: "CreditTransaction",
    entityId: updated.id,
    entityLabel: referral.patientName,
    metadata: {
      amount: Number(updated.amount),
      paymentMethod: updated.paymentMethod || null,
      referenceNumber: updated.referenceNumber || null,
      remarks: updated.remarks || null,
    },
  });

  res.json(updated);
});

// POST /api/referrals/bulk-redeem  (admin, or STAFF with REDEEM_CREDITS) — marks every
// CREDITED, still-unpaid referral matching the CURRENT filters (doctor/date range/search —
// the same filters "All Referrals" itself uses, via buildWhere) as redeemed in one action.
// Meant for clearing a backlog of unpaid credits at once rather than clicking "Redeem" on
// each row individually. Always scoped to CREDITED + unpaid regardless of which tab the
// request's filters came from, and doesn't accept per-row payment method/reference/amount
// overrides — the single-row redeem action still exists for that level of detail.
router.post("/bulk-redeem", requireAuth, requireAccess(["ADMIN"], ["REDEEM_CREDITS"]), async (req, res) => {
  const where = {
    ...buildWhere(req),
    status: "CREDITED",
    transaction: { redeemed: false },
  };

  const referrals = await prisma.referral.findMany({
    where,
    select: { id: true, patientName: true, transaction: { select: { id: true } } },
  });

  if (referrals.length === 0) {
    return res.json({ message: "No unpaid credited referrals matched the current filters.", count: 0 });
  }

  const redeemedAt = new Date();
  await prisma.creditTransaction.updateMany({
    where: { id: { in: referrals.map((r) => r.transaction.id) } },
    data: { redeemed: true, redeemedAt, redeemedByUserId: req.user.id },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.CREDIT_REDEEMED,
    entityType: "CreditTransaction",
    entityLabel: `${referrals.length} referral${referrals.length === 1 ? "" : "s"} (bulk redeem)`,
    metadata: { count: referrals.length, referralIds: referrals.map((r) => r.id) },
  });

  res.json({ message: `Marked ${referrals.length} credit${referrals.length === 1 ? "" : "s"} as redeemed.`, count: referrals.length });
});

// DELETE /api/referrals/:id  (admin only) - permanently removes a single referral row and any
// credit it generated. Meant for one-off cleanup (wrong entry, duplicate, mistaken import row)
// rather than routine use — normal workflow is Reject, not delete. Refuses if the credit has
// already been marked "Paid" (redeemed), since money may have already changed hands.
router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
    include: { transaction: true },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });

  if (referral.transaction?.redeemed) {
    return res.status(409).json({
      error: "This patient's credit payout is already marked \"Paid\" and can't be deleted. Contact support if this needs to be undone.",
    });
  }

  await prisma.$transaction([
    prisma.creditTransaction.deleteMany({ where: { referralId: referral.id } }),
    prisma.referral.delete({ where: { id: referral.id } }),
  ]);

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_DELETED,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    metadata: { status: referral.status, hadPendingCredit: Boolean(referral.transaction) },
  });

  res.json({ message: "Patient removed" });
});

// POST /api/referrals/marketing-submit  (marketing person's own portal only) — a marketing
// employee submits a lead directly, on behalf of one of their own leaders. multipart/form-data
// so a supporting photo (a card, a prescription, whatever proof they have) can come along in
// the same request, alongside which type of document it is (cardType — one of the OCR card
// types, or "OTHER" for anything OCR can't read, like a prescription).
//
// Only an AYUSHMAN card sends the lead to CARD_REVIEW — reception has to check that specific
// card and mark it active (-> PENDING) or inactive (-> REJECTED) before it enters the normal
// confirm/credit flow, every single time, regardless of whether an identical card was verified
// active on a past referral (scheme status can lapse, and never trusting a photo of someone
// else's already-approved card closes an easy way to game the check). Every other card type —
// CGHS/ECHS/CAPF/Aadhaar/Other — carries no such requirement; its photo just attaches as-is
// and the lead goes straight to PENDING, same as a leader's own QR submission, so reception can
// still eyeball/cross-check it themselves without it blocking the queue.
const CARD_TYPES_FOR_SUBMIT = ["AADHAAR", "AYUSHMAN", "CGHS", "ECHS", "CAPF", "OTHER"];
router.post("/marketing-submit", requireAuth, requireRole("MARKETING"), uploadAttachment.single("attachment"), async (req, res) => {
  const body = req.body || {};
  const patientName = (body.patientName || "").trim();
  const patientAge = Number(body.patientAge);
  const patientGender = body.patientGender;
  const leaderId = (body.leaderId || "").trim();
  const newLeaderName = (body.newLeaderName || "").trim();
  const cardType = (body.cardType || "").trim().toUpperCase();

  if (!patientName) return res.status(400).json({ error: "Patient name is required" });
  if (!Number.isInteger(patientAge) || patientAge <= 0 || patientAge > 130) {
    return res.status(400).json({ error: "A valid patient age is required" });
  }
  if (!["MALE", "FEMALE", "OTHER"].includes(patientGender)) {
    return res.status(400).json({ error: "Patient gender is required" });
  }
  if (!leaderId && !newLeaderName) {
    return res.status(400).json({ error: "Tell us which leader passed you this lead — pick one from your list or type a new name" });
  }
  if (req.file && !CARD_TYPES_FOR_SUBMIT.includes(cardType)) {
    return res.status(400).json({ error: `Select what kind of card/document this photo is (${CARD_TYPES_FOR_SUBMIT.join(", ")})` });
  }

  let doctor;
  if (leaderId) {
    // Must actually be one of THIS marketing person's own leaders — never trust a raw id from
    // the client to reach into someone else's leader list.
    doctor = await prisma.doctor.findFirst({ where: { id: leaderId, marketingPersonId: req.user.marketingPersonId } });
    if (!doctor) return res.status(404).json({ error: "That leader wasn't found in your list" });
  } else {
    doctor = await prisma.doctor.create({
      data: { name: newLeaderName, hospitalId: req.user.hospitalId, marketingPersonId: req.user.marketingPersonId },
    });
  }

  const isAyushman = req.file && cardType === "AYUSHMAN";

  const referral = await prisma.referral.create({
    data: {
      doctorId: doctor.id,
      patientName,
      patientAge,
      patientGender,
      patientPhone: body.patientPhone?.trim() || null,
      panel: normalizePanel(body.panel),
      idType: req.file ? cardType : null,
      idNumber: body.idNumber?.trim() || null,
      forceType: body.forceType?.trim() || null,
      wardType: body.wardType?.trim() || null,
      attachmentPath: req.file ? path.basename(req.file.path) : null,
      status: isAyushman ? "CARD_REVIEW" : "PENDING",
    },
  });

  logActivity({
    actor: req.user,
    action: ACTIONS.REFERRAL_SUBMITTED_BY_MARKETING,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: patientName,
    metadata: { doctorId: doctor.id, doctorName: doctor.name, newLeaderCreated: !leaderId, cardType: req.file ? cardType : null },
  });

  notify({
    hospitalId: req.user.hospitalId,
    type: isAyushman ? NOTIFICATION_TYPES.CARD_REVIEW_NEW : NOTIFICATION_TYPES.PENDING_NEW,
    message: isAyushman
      ? `New card to verify — ${patientName} (via ${doctor.name})`
      : `New pending lead — ${patientName} (via ${doctor.name})`,
    referralId: referral.id,
  });

  res.status(201).json({
    message: isAyushman
      ? "Lead submitted — reception will verify the Ayushman card before it moves to Pending."
      : "Lead submitted — it'll show up as Pending until reception confirms it.",
    referralId: referral.id,
    doctorName: doctor.name,
  });
});

// POST /api/referrals/:id/verify-card  (reception + admin) — reception has looked at the
// card photo attached to a CARD_REVIEW lead and decides whether it's active. Active moves
// the lead into the normal PENDING queue (same as any other freshly-submitted lead); inactive
// rejects it outright, same shape as the regular reject endpoint, so it never enters PENDING.
router.post("/:id/verify-card", requireAuth, requireAccess(["ADMIN", "RECEPTION"], ["MANAGE_REFERRALS"]), async (req, res) => {
  const { active, reason } = req.body;
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "active (true/false) is required" });
  }

  const referral = await prisma.referral.findFirst({
    where: { id: req.params.id, doctor: { hospitalId: req.user.hospitalId } },
  });
  if (!referral) return res.status(404).json({ error: "Referral not found" });
  if (referral.status !== "CARD_REVIEW") {
    return res.status(400).json({ error: "This referral isn't awaiting card verification" });
  }

  const nextStatus = active ? "PENDING" : "REJECTED";
  const updated = await prisma.referral.update({
    where: { id: req.params.id },
    data: {
      status: nextStatus,
      ...(active ? {} : { rejectedReason: reason || "Card not active" }),
    },
  });

  logActivity({
    actor: req.user,
    action: active ? ACTIONS.REFERRAL_CARD_VERIFIED_ACTIVE : ACTIONS.REFERRAL_CARD_VERIFIED_INACTIVE,
    entityType: "Referral",
    entityId: referral.id,
    entityLabel: referral.patientName,
    changes: { status: { from: referral.status, to: nextStatus } },
    metadata: active ? {} : { reason: reason || "Card not active" },
  });

  notify({
    hospitalId: req.user.hospitalId,
    type: active ? NOTIFICATION_TYPES.PENDING_NEW : NOTIFICATION_TYPES.REFERRAL_REJECTED,
    message: active
      ? `Card verified, moved to Pending — ${referral.patientName}`
      : `Card marked inactive, rejected — ${referral.patientName}`,
    referralId: referral.id,
  });

  res.json(updated);
});

// GET /api/referrals/:id/attachment — streams back the supporting image/PDF uploaded with a
// referral. Reachable by hospital staff who can already see referral lists (ADMIN/RECEPTION,
// or a custom STAFF role with VIEW_REFERRALS/MANAGE_REFERRALS), or by the specific marketing
// employee whose own leader this referral belongs to — never anyone else, since these are
// often photos of ID documents.
router.get("/:id/attachment", requireAuth, async (req, res) => {
  const referral = await prisma.referral.findUnique({
    where: { id: req.params.id },
    include: { doctor: { select: { hospitalId: true, marketingPersonId: true } } },
  });
  if (!referral || !referral.attachmentPath) return res.status(404).json({ error: "No attachment for this referral" });

  const staffPerms = req.user.permissions || [];
  const isStaffWithAccess =
    ["ADMIN", "RECEPTION"].includes(req.user.role) ||
    (req.user.role === "STAFF" && ["VIEW_REFERRALS", "MANAGE_REFERRALS"].some((p) => staffPerms.includes(p)));
  const staffOk = isStaffWithAccess && req.user.hospitalId === referral.doctor.hospitalId;
  const marketingOk = req.user.role === "MARKETING" && req.user.marketingPersonId === referral.doctor.marketingPersonId;

  if (!staffOk && !marketingOk) return res.status(403).json({ error: "Not authorized to view this attachment" });

  const filePath = path.join(ATTACHMENTS_DIR, path.basename(referral.attachmentPath));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Attachment file is missing" });
  res.sendFile(filePath);
});

export default router;
