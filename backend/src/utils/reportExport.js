import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { formatCell } from "./reports.js";

// Turns the generic report shape from utils/reports.js into an Excel workbook or a PDF.

const dmy = (ymd) => ymd.split("-").reverse().join("/"); // 2026-10-27 -> 27/10/2026

// The PDF's built-in font has no arrow glyph ("Pending → admission" would print as garbage), so
// the PDF says "to" instead. Excel handles the arrow fine.
const safe = (s) => String(s ?? "").replace(/\s*→\s*/g, " to ");

export function reportHeading(report) {
  const parts = [`Period: ${dmy(report.period.from)} to ${dmy(report.period.to)}`];
  if (report.filters.marketingPerson) parts.push(`Marketing person: ${report.filters.marketingPerson}`);
  if (report.usesCohort && report.filters.includeDirect) parts.push("Includes imported & manually added patients");
  return parts.join("  ·  ");
}

export function reportFileName(report, ext) {
  return `report-${report.key}-${report.period.from}-to-${report.period.to}.${ext}`;
}

export async function writeExcel(res, report) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title.slice(0, 30));
  const widest = Math.max(2, ...report.sections.map((s) => s.columns.length));
  sheet.columns = Array.from({ length: widest }, (_, i) => ({ width: i === 0 ? 38 : 18 }));

  sheet.addRow([report.title]).font = { bold: true, size: 15 };
  sheet.addRow([reportHeading(report)]).font = { color: { argb: "FF667085" } };
  sheet.addRow([`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`]).font = { color: { argb: "FF667085" } };
  sheet.addRow([]);

  sheet.addRow(["Summary"]).font = { bold: true, size: 12 };
  for (const s of report.summary) {
    const row = sheet.addRow([s.label, s.display, s.sub || ""]);
    row.getCell(1).font = { bold: true };
  }

  for (const section of report.sections) {
    sheet.addRow([]);
    sheet.addRow([section.title]).font = { bold: true, size: 12 };
    if (section.note) sheet.addRow([section.note]).font = { italic: true, color: { argb: "FF667085" } };

    // durations are written as a plain number of hours so the column can still be sorted and totalled
    const header = sheet.addRow(section.columns.map((c) => (c.type === "duration" ? `${c.label} (hours)` : c.label)));
    header.font = { bold: true, color: { argb: "FF252E69" } };
    header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F5FB" } }; });

    if (section.rows.length === 0) { sheet.addRow(["No data in this period"]); continue; }
    for (const r of section.rows) {
      const row = sheet.addRow(section.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === "") return "";
        if (c.type === "pct") return v / 100;
        if (c.type === "duration") return Math.round(v * 10) / 10;
        return v;
      }));
      section.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (c.type === "int") cell.numFmt = "#,##0";
        if (c.type === "pct") cell.numFmt = "0.0%";
        if (c.type === "pts") cell.numFmt = "#,##0.00";
        if (c.type === "duration") cell.numFmt = "0.0";
        if (c.type !== "text") cell.alignment = { horizontal: "right" };
      });
    }
  }

  if (report.notes.length) {
    sheet.addRow([]);
    sheet.addRow(["Notes"]).font = { bold: true, size: 12 };
    report.notes.forEach((n) => { sheet.addRow([n]).font = { color: { argb: "FF667085" } }; });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${reportFileName(report, "xlsx")}`);
  await workbook.xlsx.write(res);
  res.end();
}

export function writePdf(res, report) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${reportFileName(report, "pdf")}`);

  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
  doc.pipe(res);
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;
  let y = doc.page.margins.top;

  const ensure = (needed) => {
    if (y + needed > bottom) { doc.addPage({ margin: 36, size: "A4", layout: "landscape" }); y = doc.page.margins.top; return true; }
    return false;
  };

  doc.font("Helvetica-Bold").fontSize(17).fillColor("#101733").text(safe(report.title), left, y);
  y += 24;
  doc.font("Helvetica").fontSize(9).fillColor("#667085").text(safe(reportHeading(report)), left, y, { width: usable });
  y += 12;
  doc.text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, left, y);
  y += 22;

  // headline numbers, four across
  const perRow = 4;
  const cardW = usable / perRow;
  report.summary.forEach((s, i) => {
    const col = i % perRow;
    if (col === 0 && i > 0) y += 42;
    ensure(42);
    const x = left + col * cardW;
    doc.font("Helvetica").fontSize(8.5).fillColor("#667085").text(safe(s.label), x, y, { width: cardW - 10, height: 11, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#101733").text(safe(s.display), x, y + 11, { width: cardW - 10, height: 18, ellipsis: true });
    if (s.sub) doc.font("Helvetica").fontSize(8).fillColor("#667085").text(safe(s.sub), x, y + 29, { width: cardW - 10, height: 10, ellipsis: true });
  });
  y += 52;

  for (const section of report.sections) {
    ensure(70);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#252e69").text(safe(section.title), left, y);
    y += 16;
    if (section.note) {
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#667085").text(safe(section.note), left, y, { width: usable });
      y += 13;
    }

    const n = section.columns.length;
    const firstW = n <= 2 ? usable * 0.6 : Math.min(230, usable * 0.32);
    const otherW = n > 1 ? (usable - firstW) / (n - 1) : 0;
    const widths = section.columns.map((_, i) => (i === 0 ? firstW : otherW));

    const drawHeader = () => {
      let x = left;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#252e69");
      section.columns.forEach((c, i) => {
        doc.text(safe(c.label), x, y, { width: widths[i] - 6, height: 12, ellipsis: true, align: i === 0 ? "left" : "right" });
        x += widths[i];
      });
      doc.moveTo(left, y + 13).lineTo(left + usable, y + 13).strokeColor("#d0d5dd").stroke();
      y += 17;
    };
    drawHeader();

    if (section.rows.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#667085").text("No data in this period", left, y);
      y += 20;
      continue;
    }
    for (const r of section.rows) {
      if (ensure(16)) drawHeader();
      let x = left;
      doc.font("Helvetica").fontSize(9).fillColor("#101733");
      section.columns.forEach((c, i) => {
        doc.text(safe(formatCell(c.type, r[c.key])), x, y, { width: widths[i] - 6, height: 12, ellipsis: true, align: i === 0 ? "left" : "right" });
        x += widths[i];
      });
      y += 15;
    }
    y += 14;
  }

  if (report.notes.length) {
    ensure(40);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#252e69").text("Notes", left, y);
    y += 14;
    for (const raw of report.notes) {
      const note = safe(raw);
      doc.font("Helvetica").fontSize(8.5);
      const h = doc.heightOfString(note, { width: usable });
      ensure(h + 4);
      doc.fillColor("#667085").text(note, left, y, { width: usable });
      y += h + 4;
    }
  }
  doc.end();
}
