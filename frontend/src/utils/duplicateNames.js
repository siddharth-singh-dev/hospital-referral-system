// Spotting marketing people who are probably the same person imported under different spellings.
// This only ever SUGGESTS — the admin reviews every suggestion before anything is merged.

const TITLES = new Set([
  "dr", "doctor", "prof", "professor", "sir", "madam", "mam", "maam", "mr", "mrs", "ms", "miss",
  "shri", "shree", "sri", "smt", "ji",
]);

// A key that comes out the same for different spellings of one name: lower-case, letters only, titles
// dropped ("Dr", "Sir", "Ji"…), doubled letters collapsed, e/i, o/u and w/v treated as one, and the
// words in any order. So "Dr. Niraj Sir" and "Dr Neeraj Sir" both become "niraj"; "Munesh" and
// "Munesh Sir" both become "munish". Deliberately strict — "Rajesh" and "Rakesh" stay different.
export function nameKey(name) {
  const tokens = String(name || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !TITLES.has(t));
  return (meaningful.length ? meaningful : tokens)
    .map((t) => t.replace(/(.)\1+/g, "$1").replace(/e/g, "i").replace(/o/g, "u").replace(/w/g, "v"))
    .sort()
    .join(" ");
}

// Groups of two or more people whose names look like the same person. Biggest groups first.
export function findDuplicateGroups(people) {
  const byKey = new Map();
  for (const p of people) {
    const key = nameKey(p.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  return [...byKey.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([key, members]) => ({ key, people: members }))
    .sort((a, b) => b.people.length - a.people.length || a.people[0].name.localeCompare(b.people[0].name));
}
