// Shared by the server and the browser: the tier scale and how rankings are combined.

export const TIERS = [
  { id: "S", points: 4, color: "#ff7f7f" },
  { id: "A", points: 3, color: "#ffbf7f" },
  { id: "B", points: 2, color: "#ffdf7f" },
  { id: "C", points: 1, color: "#ffff7f" },
  { id: "D", points: 0, color: "#bfff7f" },
  { id: "F", points: -1, color: "#7fbfff" },
];

export const UNSORTED = "unsorted";

// The "EVERY / tiergrader" lockup in every page header: the wordmark goes to every.to, the name goes home.
export const LOCKUP_HTML = `<span class="lockup"><a class="every-logo" href="https://every.to" aria-label="Every"><img src="/static/every-wordmark.svg" alt="Every" width="72" height="20"></a><span class="lockup-sep" aria-hidden="true">/</span><a class="product" href="/">tiergrader</a></span>`;

const POINTS = Object.fromEntries(TIERS.map((t) => [t.id, t.points]));

export function isTier(id) {
  return Object.hasOwn(POINTS, id);
}

// Accepts "S", "s", "4", 4, "-1", "unsorted", "none", null... and returns a tier id or UNSORTED.
// Returns undefined when the value means nothing.
export function normalizeTier(value) {
  if (value === null || value === undefined) return UNSORTED;
  const v = String(value).trim().toUpperCase();
  if (isTier(v)) return v;
  if (["", "UNSORTED", "NONE", "U", "UNRANKED", "CLEAR"].includes(v)) return UNSORTED;
  const byPoints = TIERS.find((t) => String(t.points) === v || (v === "-" && t.points === -1));
  return byPoints?.id;
}

// The tier whose points are nearest an average score (ties round up).
export function tierForScore(avg) {
  let best = TIERS[0];
  for (const t of TIERS) {
    if (Math.abs(t.points - avg) < Math.abs(best.points - avg) - 1e-9) best = t;
  }
  return best.id;
}

// items: [{id, n, title}], raters: [{id, name}], placements: [{rater_id, item_id, tier, position}]
// Returns per-item averages (ranked best first) and per-rater progress.
export function computeResults(items, raters, placements) {
  const byItem = new Map(items.map((it) => [it.id, {}]));
  const rankedCount = new Map(raters.map((r) => [r.id, 0]));
  for (const p of placements) {
    if (!byItem.has(p.item_id) || !rankedCount.has(p.rater_id) || !isTier(p.tier)) continue;
    byItem.get(p.item_id)[p.rater_id] = p.tier;
    rankedCount.set(p.rater_id, rankedCount.get(p.rater_id) + 1);
  }
  const rows = items.map((it) => {
    const ratings = byItem.get(it.id);
    const tiers = Object.values(ratings);
    const count = tiers.length;
    const avg = count ? tiers.reduce((s, t) => s + POINTS[t], 0) / count : null;
    return {
      id: it.id,
      n: it.n,
      title: it.title,
      avg: avg === null ? null : Math.round(avg * 100) / 100,
      count,
      tier: avg === null ? UNSORTED : tierForScore(avg),
      ratings,
    };
  });
  rows.sort((a, b) => (b.avg ?? -99) - (a.avg ?? -99) || b.count - a.count || a.n - b.n);
  let rank = 0;
  for (const row of rows) row.rank = row.avg === null ? null : ++rank;
  return {
    items: rows,
    raters: raters.map((r) => ({ id: r.id, name: r.name, ranked: rankedCount.get(r.id), total: items.length })),
  };
}
