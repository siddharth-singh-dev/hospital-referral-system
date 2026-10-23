// File numbers follow one fixed format — OPD-13531/26-27 or IPD-13531/26-27: the visit type,
// the running number, and the financial year (1 April – 31 March; "26-27" = Apr 2026 → Mar 2027).
// Staff type only the number; the prefix and financial year are filled in around it.
// Mirrored on the server in backend/src/utils/fileNumber.js, which is what actually enforces it.

const CANONICAL_RE = /^(IPD|OPD)-(\d{1,9})\/(\d{2})-(\d{2})$/;

// "26-27" for any date from 1 Apr 2026 to 31 Mar 2027 (calendar as read in India).
export function financialYearLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric" }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year").value);
  const month = Number(parts.find((p) => p.type === "month").value);
  const startYear = month >= 4 ? year : year - 1;
  const yy = (n) => String(n % 100).padStart(2, "0");
  return `${yy(startYear)}-${yy(startYear + 1)}`;
}

export function buildFileNumber(visitType, digits, fy) {
  return `${visitType}-${digits}/${fy}`;
}

// { visitType, number, fy } for a number already in the fixed format, otherwise null (blank, or
// one of the older free-text numbers like "IPD-9182").
export function splitFileNumber(value) {
  const match = CANONICAL_RE.exec(String(value ?? "").trim().toUpperCase());
  return match ? { visitType: match[1], number: match[2], fy: `${match[3]}-${match[4]}` } : null;
}

// Whatever was typed or pasted → just the digits. A full "IPD-13531/26-27" pasted in keeps only
// 13531 (rather than also swallowing the 26 and 27).
export function digitsFromInput(raw) {
  const text = String(raw ?? "");
  const full = /(\d+)\s*\/\s*\d{2}\s*-\s*\d{2}\s*$/.exec(text);
  return (full ? full[1] : text).replace(/\D/g, "").slice(0, 9);
}
