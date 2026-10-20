// What the REST API, the MCP endpoint and the pages share: views of a collection for each kind of
// link, and the write operations that broadcast changes to open pages.
import { TIERS, UNSORTED, computeResults, isTier } from "../public/shared.js";
import { httpError } from "./store.js";

export const SCORING = Object.fromEntries(TIERS.map((t) => [t.id, t.points]));

export function createService(store, { broadcast = () => {} } = {}) {
  const links = (base, c) => ({
    owner_url: `${base}/o/${c.owner_token}`,
    join_url: `${base}/j/${c.invite_code}`,
    api_url: `${base}/api/o/${c.owner_token}`,
  });

  const publicItem = (it, base, owner) => ({
    id: it.id,
    n: it.n,
    title: it.title,
    kind: it.kind,
    mime: it.mime,
    size: it.size,
    snippet: it.snippet,
    file_url: it.kind === "link" ? null : `${base}/f/${it.id}`,
    link_url: it.url || null,
    ...(owner ? { filename: it.filename } : {}),
  });

  const collectionInfo = (c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    show_others: !!c.show_others,
    created_at: c.created_at,
    updated_at: c.updated_at,
  });

  // Each person's board as tier -> [item ids], in order. Unranked items are under "unsorted".
  function boards(items, raters, placements) {
    const out = {};
    for (const r of raters) {
      out[r.id] = Object.fromEntries([...TIERS.map((t) => [t.id, []]), [UNSORTED, []]]);
    }
    const placed = new Map(raters.map((r) => [r.id, new Set()]));
    for (const p of placements) {
      if (!out[p.rater_id] || !isTier(p.tier)) continue;
      out[p.rater_id][p.tier].push(p.item_id);
      placed.get(p.rater_id).add(p.item_id);
    }
    for (const r of raters) {
      for (const it of items) if (!placed.get(r.id).has(it.id)) out[r.id][UNSORTED].push(it.id);
    }
    return out;
  }

  // The owner's own ranking only counts (in averages, results, people lists) once they've placed something.
  function snapshot(c) {
    const items = store.listItems(c.id);
    const placements = store.listPlacements(c.id);
    const placed = new Set(placements.map((p) => p.rater_id));
    const raters = store.listRaters(c.id).filter((r) => r.id !== c.owner_rater_id || placed.has(r.id));
    return { items, raters, placements };
  }

  const service = {
    links,

    ownerView(c, base) {
      const me = store.ownerRater(c);
      const { items, raters, placements } = snapshot(c);
      const results = computeResults(items, raters, placements);
      const progress = new Map(results.raters.map((r) => [r.id, r.ranked]));
      return {
        role: "owner",
        collection: collectionInfo(c),
        links: links(base, c),
        tiers: TIERS,
        // The owner's own ranking; `raters` is everyone else.
        me: { id: me.id, name: me.name },
        items: items.map((it) => publicItem(it, base, true)),
        raters: raters.filter((r) => r.id !== me.id).map((r) => ({
          id: r.id,
          name: r.name,
          url: `${base}/r/${r.token}`,
          ranked: progress.get(r.id),
          total: items.length,
          updated_at: r.updated_at,
        })),
        placements,
        results,
      };
    },

    raterView(rater, base) {
      const c = store.getCollection(rater.collection_id);
      const { items, raters, placements } = snapshot(c);
      const visible = c.show_others ? raters : [rater];
      const ids = new Set(visible.map((r) => r.id));
      const results = computeResults(items, visible, placements.filter((p) => ids.has(p.rater_id)));
      const progress = new Map(results.raters.map((r) => [r.id, r.ranked]));
      return {
        role: "rater",
        collection: collectionInfo(c),
        me: { id: rater.id, name: rater.name, url: `${base}/r/${rater.token}`, api_url: `${base}/api/r/${rater.token}` },
        tiers: TIERS,
        items: items.map((it) => publicItem(it, base, false)),
        raters: visible.map((r) => ({ id: r.id, name: r.name, ranked: progress.get(r.id), total: items.length, updated_at: r.updated_at })),
        placements: placements.filter((p) => ids.has(p.rater_id)),
        results,
      };
    },

    // A readable summary for agents: every item's average and each person's board by title.
    resultsView(c, base) {
      const { items, raters, placements } = snapshot(c);
      const results = computeResults(items, raters, placements);
      const names = new Map(raters.map((r) => [r.id, r.name]));
      const itemById = new Map(items.map((it) => [it.id, it]));
      const perBoard = boards(items, raters, placements);
      return {
        collection: collectionInfo(c),
        owner_url: links(base, c).owner_url,
        scoring: SCORING,
        items: results.items.map((row) => ({
          rank: row.rank,
          n: row.n,
          id: row.id,
          title: row.title,
          average: row.avg,
          ratings_count: row.count,
          consensus_tier: row.tier,
          ratings: Object.entries(row.ratings).map(([rid, tier]) => ({ name: names.get(rid), rater_id: rid, tier })),
        })),
        people: raters.map((r) => ({
          rater_id: r.id,
          name: r.name,
          url: `${base}/r/${r.token}`,
          ranked: results.raters.find((x) => x.id === r.id).ranked,
          total: items.length,
          board: Object.fromEntries(
            Object.entries(perBoard[r.id]).map(([tier, ids]) => [tier, ids.map((id) => ({ id, n: itemById.get(id).n, title: itemById.get(id).title }))]),
          ),
        })),
      };
    },

    resultsCsv(c) {
      const { items, raters, placements } = snapshot(c);
      const results = computeResults(items, raters, placements);
      const esc = (v) => {
        let s = v === null || v === undefined ? "" : String(v);
        // Titles and names are typed by others: stop spreadsheets reading them as formulas.
        if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      // One row per file, best first: its name, title and average, then each person's grade in points.
      const files = new Map(items.map((it) => [it.id, it.filename || it.url || ""]));
      const header = ["rank", "file", "title", "average", ...raters.map((r) => r.name)];
      const lines = [header.map(esc).join(",")];
      for (const row of results.items) {
        const grades = raters.map((r) => (row.ratings[r.id] ? SCORING[row.ratings[r.id]] : ""));
        lines.push([row.rank, files.get(row.id), row.title, row.avg, ...grades].map(esc).join(","));
      }
      return lines.join("\n") + "\n";
    },

    // The board of one person, by title, for agents acting on that person's link.
    raterBoard(rater, base) {
      const c = store.getCollection(rater.collection_id);
      const items = store.listItems(c.id);
      const placements = store.listPlacements(c.id).filter((p) => p.rater_id === rater.id);
      const itemById = new Map(items.map((it) => [it.id, it]));
      const board = boards(items, [rater], placements)[rater.id];
      return {
        collection: collectionInfo(c),
        person: rater.name,
        url: `${base}/r/${rater.token}`,
        scoring: SCORING,
        board: Object.fromEntries(
          Object.entries(board).map(([tier, ids]) => [tier, ids.map((id) => ({ id, n: itemById.get(id).n, title: itemById.get(id).title }))]),
        ),
      };
    },

    createCollection({ title, description }, base, ownerUserId = null) {
      const c = store.createCollection({ title, description }, ownerUserId);
      return { collection: collectionInfo(c), owner_token: c.owner_token, ...links(base, c) };
    },

    updateCollection(c, patch, source) {
      const next = store.updateCollection(c.id, patch);
      broadcast(c.id, source);
      return collectionInfo(next);
    },

    // inputs: [{ title?, text?, url?, filename?, mime?, content_base64?, data?: Buffer }]
    addItems(c, inputs, base, source) {
      if (!Array.isArray(inputs) || inputs.length === 0) throw httpError(400, "No items given.");
      const added = [];
      try {
        for (const input of inputs) {
          if (!input || typeof input !== "object") throw httpError(400, "Each item must be an object.");
          let data = input.data;
          if (!data && input.content_base64) data = Buffer.from(String(input.content_base64), "base64");
          const text = input.text === undefined || input.text === null ? undefined : String(input.text);
          if (!data && text === undefined && !input.url) throw httpError(400, "Each item needs text, url, content_base64 or a file.");
          if (input.url && !/^https?:\/\//i.test(String(input.url))) throw httpError(400, "url must start with http:// or https://");
          const it = store.addItem(c.id, { title: input.title, filename: input.filename, mime: input.mime, data, text, url: input.url });
          added.push(it);
        }
      } finally {
        if (added.length) broadcast(c.id, source);
      }
      const numbered = new Map(store.listItems(c.id).map((it) => [it.id, it]));
      return added.map((it) => publicItem(numbered.get(it.id), base, true));
    },

    updateItem(c, itemId, patch, source) {
      store.updateItem(c.id, itemId, patch);
      broadcast(c.id, source);
    },

    deleteItem(c, itemId, source) {
      store.deleteItem(c.id, itemId);
      broadcast(c.id, source);
    },

    readItem(collectionId, itemId, base) {
      const it = store.listItems(collectionId).find((x) => x.id === itemId || String(x.n) === String(itemId));
      if (!it) throw httpError(404, "No such item in this collection.");
      return { ...publicItem(it, base, false), text: it.text };
    },

    createRaters(c, names, base, source) {
      const list = (Array.isArray(names) ? names : [names]).flatMap((n) => String(n ?? "").split(/[\n,]/)).map((n) => n.trim()).filter(Boolean);
      if (!list.length) throw httpError(400, "Give at least one name.");
      const made = list.map((name) => store.addRater(c.id, name));
      broadcast(c.id, source);
      return made.map((r) => ({ id: r.id, name: r.name, url: `${base}/r/${r.token}` }));
    },

    renameRater(c, raterId, name, source) {
      const r = store.renameRater(c.id, raterId, name);
      broadcast(c.id, source);
      return { id: r.id, name: r.name };
    },

    deleteRater(c, raterId, source) {
      store.deleteRater(c.id, raterId);
      broadcast(c.id, source);
    },

    place(rater, moves, source) {
      if (!Array.isArray(moves) || !moves.length) throw httpError(400, "Give at least one move: { item_id, tier }.");
      const items = store.listItems(rater.collection_id);
      const resolved = moves.map((m) => {
        const key = m?.item_id ?? m?.id ?? m?.item ?? m?.n;
        const it = items.find((x) => x.id === key || String(x.n) === String(key));
        if (!it) throw httpError(400, `No item "${key}" in this collection.`);
        return { item_id: it.id, tier: m.tier, position: m.position };
      });
      store.place(rater, resolved);
      broadcast(rater.collection_id, source);
    },
  };
  return service;
}
