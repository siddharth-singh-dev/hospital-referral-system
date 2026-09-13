// Targeted diagnostic for a SPECIFIC patient reported as visible via search but missing while
// paging through "All Referrals" normally, even after the pagination-tiebreaker and etag
// fixes were deployed. Read-only — changes nothing.
//
// Usage (from the backend/ directory):
//   node scripts/trace-patient.mjs "Ms. Neha Parween"
//   node scripts/trace-patient.mjs IPD-5921        (file number also works)
import prisma from "../src/utils/prismaClient.js";

const PAGE_SIZE = 50; // must match REFERRALS_PAGE_SIZE in the frontend

const query = process.argv[2];
if (!query) {
  console.error('Usage: node scripts/trace-patient.mjs "<patient name or file number>"');
  process.exit(1);
}

async function main() {
  // Step 1: find every referral matching this name/file number, across ALL hospitals — in
  // case the same name exists more than once, or in a different hospital than expected.
  const matches = await prisma.referral.findMany({
    where: {
      OR: [
        { patientName: { contains: query } },
        { fileNumber: { contains: query } },
      ],
    },
    include: {
      doctor: { select: { id: true, name: true, hospitalId: true } },
      transaction: { select: { amount: true, redeemed: true } },
    },
  });

  console.log(`Found ${matches.length} referral(s) matching "${query}":\n`);
  for (const r of matches) {
    console.log(`- ${r.patientName} (${r.fileNumber || "no file number"})`);
    console.log(`    id: ${r.id}`);
    console.log(`    hospitalId: ${r.doctor.hospitalId}`);
    console.log(`    doctor: ${r.doctor.name} (${r.doctor.id})`);
    console.log(`    status: ${r.status}`);
    console.log(`    createdAt: ${r.createdAt.toISOString()}`);
    console.log(`    transaction: ${r.transaction ? `amount=${r.transaction.amount} redeemed=${r.transaction.redeemed}` : "none"}`);
    console.log("");
  }

  // Step 2: for each match, walk the EXACT same paginated query the "Credited" tab uses for
  // that referral's own hospital, and report the precise page it lands on (or confirm it
  // never appears in any page despite existing).
  for (const r of matches) {
    const hospitalId = r.doctor.hospitalId;
    const where = { doctor: { hospitalId }, status: "CREDITED" };
    const totalCount = await prisma.referral.count({ where });

    let foundOnPage = null;
    let page = 1;
    while (true) {
      const rows = await prisma.referral.findMany({
        where,
        select: { id: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      });
      if (rows.length === 0) break;
      if (rows.some((row) => row.id === r.id)) { foundOnPage = page; break; }
      page += 1;
      if (page > 500) break;
    }

    console.log(`--- ${r.patientName} (hospital ${hospitalId}) ---`);
    console.log(`  status=CREDITED count() for this hospital: ${totalCount}`);
    if (foundOnPage) {
      console.log(`  ✅ Found on page ${foundOnPage} of the exact paginated query the site uses.`);
    } else {
      console.log(`  ⚠️  NEVER appeared in any page, despite existing with status=${r.status}.`);
      if (r.status !== "CREDITED") {
        console.log(`  → This referral's status is "${r.status}", not "CREDITED" — that's why it wouldn't show under the Credited tab specifically.`);
      }
    }
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
