// One-off repair for referrals mis-attributed by the bulk-import bug fixed in referrals.js:
// a shared field-agent first name ("Pankaj", "Sachin", "Vishal", "Anuj") was reused by
// several different marketing employees' own staff, and the old logic locked that name to
// whichever marketing employee's row it saw FIRST in the sheet — so some patients who should
// have credited Munesh Rana, Narsingh Bhati, Sudesh Singh, or Hemraj instead silently
// credited whichever one of them "won" that name first.
//
// This script does NOT touch the referrals themselves except their doctorId, and does not
// change any patient details, credit amounts, or dates — it only re-points each affected
// referral (and its credit transaction, which carries its own separate doctorId) at the
// correct leader, creating that leader if this specific (name, marketing person) pairing
// doesn't exist yet.
//
// Usage (from the backend/ directory, with DATABASE_URL set as usual):
//   node scripts/fix-july-mismatched-referrals.mjs
//   node scripts/fix-july-mismatched-referrals.mjs --dry-run   (preview only, no writes)

import prisma from "../src/utils/prismaClient.js";

const DRY_RUN = process.argv.includes("--dry-run");

// One row per patient identified in the July bulk-import mismatch: the file number identifies
// the referral, referredByName is the (shared) field-agent name that was on the sheet, and
// correctMarketingPerson is what the sheet actually said for that specific patient.
const FIXES = [
  { fileNumber: "IPD-12796", referredByName: "Anuj", correctMarketingPerson: "Sudesh Singh" },
  { fileNumber: "IPD-12832", referredByName: "Sachin", correctMarketingPerson: "Narsingh Bhati" },
  { fileNumber: "IPD-12808", referredByName: "Sachin", correctMarketingPerson: "Narsingh Bhati" },
  { fileNumber: "IPD-12791", referredByName: "Sachin", correctMarketingPerson: "Narsingh Bhati" },
  { fileNumber: "IPD-12837", referredByName: "Pankaj", correctMarketingPerson: "Munesh Rana" },
  { fileNumber: "IPD-12836", referredByName: "Pankaj", correctMarketingPerson: "Munesh Rana" },
  { fileNumber: "IPD-12876", referredByName: "Pankaj", correctMarketingPerson: "Munesh Rana" },
  { fileNumber: "IPD-12705", referredByName: "Vishal", correctMarketingPerson: "Hemraj" },
];

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no changes will be written\n" : "LIVE RUN — changes will be written\n");

  for (const fix of FIXES) {
    const referral = await prisma.referral.findFirst({
      where: { fileNumber: fix.fileNumber },
      include: { doctor: true, transaction: true },
    });
    if (!referral) {
      console.log(`SKIP ${fix.fileNumber}: no referral found with this file number`);
      continue;
    }

    const hospitalId = referral.doctor.hospitalId;
    const marketingPerson = await prisma.marketingPerson.findFirst({
      where: { hospitalId, name: { equals: fix.correctMarketingPerson, mode: "insensitive" } },
    });
    if (!marketingPerson) {
      console.log(`SKIP ${fix.fileNumber}: marketing employee "${fix.correctMarketingPerson}" not found`);
      continue;
    }

    let correctDoctor = await prisma.doctor.findFirst({
      where: { hospitalId, name: { equals: fix.referredByName, mode: "insensitive" }, marketingPersonId: marketingPerson.id },
    });

    if (referral.doctorId === correctDoctor?.id) {
      console.log(`OK   ${fix.fileNumber} (${referral.patientName}): already correct`);
      continue;
    }

    if (!correctDoctor) {
      console.log(`${DRY_RUN ? "WOULD CREATE" : "CREATING"} leader "${fix.referredByName}" under ${fix.correctMarketingPerson}`);
      if (!DRY_RUN) {
        correctDoctor = await prisma.doctor.create({
          data: { name: fix.referredByName, hospitalId, marketingPersonId: marketingPerson.id },
        });
      }
    }

    console.log(
      `${DRY_RUN ? "WOULD FIX" : "FIXING"} ${fix.fileNumber} (${referral.patientName}): ` +
      `"${referral.doctor.name}" (currently crediting ${referral.doctor.marketingPersonId ? "some other employee" : "no one"}) ` +
      `→ "${fix.referredByName}" under ${fix.correctMarketingPerson}`
    );

    if (!DRY_RUN) {
      await prisma.$transaction([
        prisma.referral.update({ where: { id: referral.id }, data: { doctorId: correctDoctor.id } }),
        ...(referral.transaction
          ? [prisma.creditTransaction.update({ where: { id: referral.transaction.id }, data: { doctorId: correctDoctor.id } })]
          : []),
      ]);
    }
  }

  console.log(DRY_RUN ? "\nDry run complete — re-run without --dry-run to apply." : "\nDone.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
