// What a board page shows, as query params on its own link, so a shared or bookmarked link opens
// exactly that view. Old links have none of these and open your own ranking, as before.
//   ?view=lauren         one person's ranking: their name, or their id when two names would match
//   ?view=everyone       everyone's average; add &table=1 for the table
//   &card=<item id>      with the reader open on that card (a card number like 3 works when typed)
// Anything that doesn't match falls back to your own ranking with the reader closed.

export const slugify = (name) =>
  String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ctx: { people: [{ id, name }], meId, items: [{ id, n }] }
function viewParam(viewing, { people, meId }) {
  if (!viewing || viewing === meId) return null;
  if (viewing === "everyone") return "everyone";
  const person = people.find((p) => p.id === viewing);
  if (!person) return null;
  const slug = slugify(person.name);
  const clash = !slug || slug === "everyone" || people.some((p) => p.id !== viewing && slugify(p.name) === slug);
  return clash ? person.id : slug;
}

function viewingOf(param, { people, meId }) {
  const p = String(param ?? "").trim();
  if (!p) return meId;
  if (p.toLowerCase() === "everyone") return "everyone";
  const byId = people.find((x) => x.id === p);
  if (byId) return byId.id;
  const matches = people.filter((x) => slugify(x.name) === slugify(p));
  return matches.length === 1 ? matches[0].id : meId;
}

function cardOf(param, { items }) {
  const p = String(param ?? "").trim().replace(/^#/, "");
  if (!p) return null;
  return (items.find((it) => it.id === p) || items.find((it) => String(it.n) === p))?.id ?? null;
}

// The view a query string asks for: { viewing, table, card }.
export function readView(search, ctx) {
  const q = new URLSearchParams(search);
  const viewing = viewingOf(q.get("view"), ctx);
  const table = viewing === "everyone" && ["1", "true", ""].includes(q.get("table"));
  return { viewing, table, card: cardOf(q.get("card"), ctx) };
}

// The query string for a view, keeping any other params already there. "" when there's nothing to say.
export function writeView(search, { viewing, table, card }, ctx) {
  const q = new URLSearchParams(search);
  for (const key of ["view", "table", "card"]) q.delete(key);
  const view = viewParam(viewing, ctx);
  if (view) q.set("view", view);
  if (view === "everyone" && table) q.set("table", "1");
  if (card && ctx.items.some((it) => it.id === card)) q.set("card", card);
  const out = q.toString();
  return out ? `?${out}` : "";
}
