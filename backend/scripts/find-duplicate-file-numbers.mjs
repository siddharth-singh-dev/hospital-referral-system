// Read-only report of file numbers that are ALREADY used by more than one referral in the same
// hospital (and of numbers not in the fixed OPD-/IPD-12345/26-27 format). The system now refuses new
// duplicates, but anything saved before that is still in the data — run this to find and fix it
// (edit one of the referrals from All Referrals), and before ever adding a database-level unique
// index. Changes nothing.
//
// Usage (from the backend/ directory):
//   node scripts/find-duplicate-file-numbers.mjs
import prisma from "../src/utils/prismaClient.js";
import { isCanonicalFileNumber } from "../src/utils/fileNumber.js";

async function main() {
  const referrals = await prisma.referral.findMany({
    where: { fileNumber: { not: null } },
    select: {
      id: true, patientName: true, fileNumber: true, visitType: true, status: true, createdAt: true,
      doctor: { select: { name: true, hospitalId: true, hospital: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  // group by hospital + file number (compared case-insensitively, like the database does)
  const groups = new Map();
  let oldFormat = 0;
  for (const r of referrals) {
    if (!isCanonicalFileNumber(r.fileNumber)) oldFormat++;
    const key = `${r.doctor.hospitalId}|${r.fileNumber.trim().toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const duplicates = [...groups.values()].filter((g) => g.length > 1);
  console.log(`${referrals.length} referrals have a file number; ${oldFormat} of them are not in the OPD-/IPD-12345/26-27 format.`);
  if (duplicates.length === 0) {
    console.log("No file number is used by more than one referral.");
  } else {
    console.log(`\n${duplicates.length} file number(s) are used more than once:\n`);
    for (const group of duplicates) {
      console.log(`${group[0].fileNumber}  (${group[0].doctor.hospital?.name || "?"})`);
      for (const r of group) {
        console.log(`    ${r.patientName} — ${r.status}, ${r.visitType || "-"}, via ${r.doctor.name}, added ${r.createdAt.toISOString().slice(0, 10)}  [${r.id}]`);
      }
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
