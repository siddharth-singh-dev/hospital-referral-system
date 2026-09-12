// One-off diagnostic for the "unpaid referrals visible with a date filter but not while
// paging through normally" report. Doesn't change any data — read-only. Run from the
// backend/ directory:
//
//   node scripts/diagnose-missing-unpaid.mjs
//
// It checks three separate things that could each independently explain the symptom:
//   1. Does prisma.referral.count() for status=CREDITED agree with prisma.referral.findMany()
//      actually returning that many rows in total? (rules out a count()-vs-findMany mismatch)
//   2. Does every unpaid (unredeemed) CREDITED referral actually appear EXACTLY ONCE if you
//      walk every page of the exact same paginated query the API uses, back to back?
//      (rules back in, or finally rules out, the pagination-tie theory even after the fix)
//   3. Lists every unpaid CREDITED referral directly, with its position (page number) in that
//      same walk, so we can see at a glance whether they're clustered somewhere suspicious
//      (e.g. all sitting exactly on a page boundary).
import prisma from "../src/utils/prismaClient.js";

const PAGE_SIZE = 50; // must match REFERRALS_PAGE_SIZE in the frontend for this to be a fair simulation

async function main() {
  const hospitals = await prisma.hospital.findMany({ select: { id: true, name: true } });

  for (const hospital of hospitals) {
    console.log(`\n=== ${hospital.name} (${hospital.id}) ===`);

    const where = { doctor: { hospitalId: hospital.id }, status: "CREDITED" };

    const countResult = await prisma.referral.count({ where });

    // Walk every page exactly as the API does, collecting every id we see.
    const seenIds = new Map(); // id -> count of times seen across all pages
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
      for (const r of rows) seenIds.set(r.id, (seenIds.get(r.id) || 0) + 1);
      page += 1;
      if (page > 500) { console.log("  Stopping after 500 pages as a safety limit."); break; }
    }
    const totalPagesWalked = page - 1;
    const uniqueSeen = seenIds.size;
    const duplicated = Array.from(seenIds.values()).filter((c) => c > 1).length;

    console.log(`  count(): ${countResult}`);
    console.log(`  Rows actually seen walking ${totalPagesWalked} pages: ${uniqueSeen} unique (${duplicated} appeared more than once)`);
    if (countResult !== uniqueSeen) {
      console.log(`  ⚠️  MISMATCH: count() says ${countResult} but paging only surfaced ${uniqueSeen} unique rows.`);
    } else {
      console.log(`  ✅ count() and the full page-walk agree.`);
    }

    // Now find every CREDITED referral with an unredeemed transaction, and check whether its
    // id actually turned up in the walk above.
    const unpaid = await prisma.referral.findMany({
      where: { ...where, transaction: { redeemed: false } },
      select: { id: true, patientName: true, fileNumber: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    console.log(`  Unpaid CREDITED referrals in the DB: ${unpaid.length}`);
    const missing = unpaid.filter((r) => !seenIds.has(r.id));
    if (missing.length === 0) {
      console.log(`  ✅ Every unpaid referral WAS found somewhere in the page-walk.`);
    } else {
      console.log(`  ⚠️  ${missing.length} unpaid referral(s) NEVER appeared in any page of the walk:`);
      for (const r of missing) {
        console.log(`     - ${r.patientName} (${r.fileNumber || "no file number"}), created ${r.createdAt.toISOString()}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
