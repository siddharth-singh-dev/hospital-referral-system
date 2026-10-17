// What a merge will do, worked out from the marketing list the admin screen already has — shown in the
// merge dialog before anything is changed. Mirrors what POST /marketing-persons/merge actually does.

const aliasesOf = (p) => (Array.isArray(p.aliases) ? p.aliases.filter((a) => typeof a === "string") : []);

// The sensible default to keep: the record with the most leads, then the most leaders, then one that
// already has a portal login, then the oldest. The admin can pick any of them.
export function pickDefaultSurvivor(people) {
  return [...people].sort(
    (a, b) =>
      b.totalReferrals - a.totalReferrals ||
      b.leaderCount - a.leaderCount ||
      Number(b.hasPassword) - Number(a.hasPassword) ||
      new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  )[0].id;
}

// Every name the merged person should answer to: all the merged names plus their own aliases, minus
// the final name, de-duplicated ignoring case. (Same rule as the server.)
export function mergedAliases(keep, others, finalName) {
  const seen = new Set([finalName.trim().toLowerCase()]);
  const out = [];
  for (const raw of [keep.name, ...aliasesOf(keep), ...others.flatMap((o) => [o.name, ...aliasesOf(o)])]) {
    const alias = String(raw ?? "").trim();
    if (!alias || seen.has(alias.toLowerCase())) continue;
    seen.add(alias.toLowerCase());
    out.push(alias);
  }
  return out;
}

export function describeMerge(people, keepId, finalName) {
  const keep = people.find((p) => p.id === keepId);
  const others = people.filter((p) => p.id !== keepId);
  const firstWith = (test) => others.find(test);

  // Details the kept person is missing are filled from the others — the first one that has it.
  const fills = [];
  if (!keep.phone && firstWith((o) => o.phone)) fills.push(`phone number from ${firstWith((o) => o.phone).name}`);
  if (!keep.email && firstWith((o) => o.email)) fills.push(`email from ${firstWith((o) => o.email).name}`);
  if (!keep.hasPassword && firstWith((o) => o.hasPassword)) fills.push(`portal password from ${firstWith((o) => o.hasPassword).name}`);
  const headSource = !keep.headId ? firstWith((o) => o.headId) : null;
  if (headSource) fills.push(`team head (${headSource.headName}) from ${headSource.name}`);

  // Team heads that won't carry over because the merged person can only have one.
  const finalHeadId = keep.headId || headSource?.headId || null;
  const droppedHeads = [...new Set(others.filter((o) => o.headId && o.headId !== finalHeadId).map((o) => o.headName))];

  return {
    keep,
    others,
    leadersMoving: others.reduce((n, o) => n + o.leaderCount, 0),
    leadsMoving: others.reduce((n, o) => n + o.totalReferrals, 0),
    leadersAfter: people.reduce((n, p) => n + p.leaderCount, 0),
    leadsAfter: people.reduce((n, p) => n + p.totalReferrals, 0),
    creditedAfter: people.reduce((n, p) => n + p.totalCredited, 0),
    pendingAfter: people.reduce((n, p) => n + p.totalPending, 0),
    fills,
    droppedHeads,
    // Their own portal links stop working once they're merged away; the kept person's link carries on.
    loginsEnding: others.filter((o) => o.hasPassword).map((o) => o.name),
    activeAfter: keep.active || others.some((o) => o.active),
    aliasesAfter: mergedAliases(keep, others, finalName),
    renamed: finalName.trim() !== keep.name,
  };
}
