import prisma from "./prismaClient.js";
import { istDateString } from "./istDate.js";

// File numbers follow one fixed format:
//
//   OPD-13531/26-27      IPD-13531/26-27
//   └┬┘ └─┬─┘ └──┬──┘
//    │    │      └─ financial year (1 April – 31 March), "26-27" = Apr 2026 → Mar 2027
//    │    └─ the running number
//    └─ the visit type — always matches the referral's visit type
//
// The prefix comes from the visit type and the suffix from the financial year, so staff only ever
// type the number itself. Mirrored (for the form inputs) in frontend/src/utils/fileNumber.js.
//
// A file number can be used by one referral only, hospital-wide.

const FILE_NUMBER_RE = /^(IPD|OPD)-(\d{1,9})\/(\d{2})-(\d{2})$/;

// "26-27" for any date from 1 Apr 2026 to 31 Mar 2027, judged by the calendar in India (the
// server may run in UTC, which would get 31 March late evening wrong).
export function financialYearLabel(date = new Date()) {
  const [year, month] = istDateString(date).split("-").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  const yy = (n) => String(n % 100).padStart(2, "0");
  return `${yy(startYear)}-${yy(startYear + 1)}`;
}

// True for a number already in the fixed format (used to tell new-format numbers from the older
// free-text ones that were entered before the format was enforced).
export function isCanonicalFileNumber(value) {
  return FILE_NUMBER_RE.test(String(value ?? "").trim().toUpperCase());
}

/**
 * Turns whatever was supplied into the canonical file number, or explains what's wrong.
 *
 * Accepts either just the digits ("13531" — the prefix and financial year are filled in) or the
 * full "IPD-13531/26-27". Returns { value, visitType } on success, { error } otherwise.
 *
 * @param {string} raw
 * @param {object} [options]
 * @param {"IPD"|"OPD"} [options.visitType]  the visit type the number must belong to
 * @param {Date} [options.date]              which date's financial year applies to a digits-only number
 * @param {boolean} [options.requireCurrentFy] live confirmations must carry the current financial year
 */
export function normalizeFileNumber(raw, { visitType, date = new Date(), requireCurrentFy = false } = {}) {
  const text = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const fy = financialYearLabel(date);
  const example = `${visitType || "IPD"}-13531/${fy}`;

  if (!text) return { error: "A file number is required" };

  if (/^\d+$/.test(text)) {
    if (!visitType) return { error: "Choose the visit type (IPD or OPD) before entering the file number" };
    if (text.length > 9 || /^0+$/.test(text)) return { error: `That doesn't look like a valid file number — it should read like ${example}` };
    return { value: `${visitType}-${text}/${fy}`, visitType };
  }

  const match = FILE_NUMBER_RE.exec(text);
  if (!match || /^0+$/.test(match[2])) {
    return { error: `File number must be in the format ${example}` };
  }
  const [, prefix, , fyStart, fyEnd] = match;

  if (visitType && prefix !== visitType) {
    return { error: `An ${visitType} visit needs a file number starting with "${visitType}-" (e.g. ${example})` };
  }
  if ((Number(fyStart) + 1) % 100 !== Number(fyEnd)) {
    return { error: `The financial year at the end must be two consecutive years, like ${fy}` };
  }
  if (requireCurrentFy && `${fyStart}-${fyEnd}` !== fy) {
    return { error: `The file number must end with /${fy}, the current financial year` };
  }
  return { value: text, visitType: prefix };
}

export class FileNumberConflictError extends Error {
  constructor(fileNumber, existing) {
    const who = existing.doctor?.name ? ` (referred by ${existing.doctor.name})` : "";
    super(`File number ${fileNumber} is already used by ${existing.patientName}${who}. A file number can only be used once.`);
    this.name = "FileNumberConflictError";
    this.fileNumber = fileNumber;
    this.existingReferralId = existing.id;
  }
}

// The referral already holding this file number in this hospital, or null. `db` is either the
// prisma client or a transaction client. (Text columns are case-insensitive in this database, so
// "ipd-1/26-27" and "IPD-1/26-27" count as the same number.)
export async function findFileNumberHolder(db, hospitalId, fileNumber, excludeReferralId) {
  return db.referral.findFirst({
    where: {
      fileNumber,
      doctor: { hospitalId },
      ...(excludeReferralId ? { id: { not: excludeReferralId } } : {}),
    },
    select: { id: true, patientName: true, doctor: { select: { name: true } } },
  });
}

export async function assertFileNumberAvailable(db, hospitalId, fileNumber, excludeReferralId) {
  const holder = await findFileNumberHolder(db, hospitalId, fileNumber, excludeReferralId);
  if (holder) throw new FileNumberConflictError(fileNumber, holder);
}

// Runs `fn(tx)` inside a transaction that first takes a row lock on this hospital, so two people
// saving file numbers at the same moment are handled one after the other — the second then sees
// the first's number and is refused. Without this, both could pass the "is it taken?" check
// before either had saved. The lock is released when the transaction commits.
export async function withFileNumberLock(hospitalId, fn) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM Hospital WHERE id = ${hospitalId} FOR UPDATE`;
      return fn(tx);
    },
    { maxWait: 10000, timeout: 20000 }
  );
}

// For route handlers: answers a duplicate-file-number failure with a 409 and returns true;
// returns false for any other error so the caller can rethrow it.
export function respondIfFileNumberConflict(err, res) {
  if (err instanceof FileNumberConflictError) {
    res.status(409).json({ error: err.message, fileNumberConflict: true });
    return true;
  }
  return false;
}
