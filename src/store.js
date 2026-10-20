// SQLite storage (node:sqlite, no dependencies). Uploaded files live in the same database file,
// so one volume at DATA_DIR holds everything.
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { TIERS, isTier, normalizeTier, UNSORTED } from "../public/shared.js";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // 32 symbols, no i/l/o/u
export function token(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export const LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  itemsPerCollection: 500,
  ratersPerCollection: 500,
  textChars: 2_000_000,
  titleChars: 200,
  nameChars: 80,
};

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".mdx", ".json", ".csv", ".tsv", ".yaml", ".yml", ".xml", ".log",
  ".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp",
  ".swift", ".kt", ".sh", ".sql", ".css", ".toml", ".ini", ".rst", ".tex",
]);
const MIME_BY_EXT = {
  ".md": "text/markdown", ".markdown": "text/markdown", ".mdx": "text/markdown", ".txt": "text/plain",
  ".html": "text/html", ".htm": "text/html", ".json": "application/json", ".csv": "text/csv",
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".m4a": "audio/mp4",
};

export function detectKind(filename = "", mime = "") {
  const ext = extname(filename).toLowerCase();
  mime = String(mime || "").toLowerCase().split(";")[0].trim();
  // Anything that isn't a plain type/subtype is ignored, so odd spellings can't slip past the sandbox rules.
  if (!/^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(mime) || mime === "application/octet-stream") {
    mime = MIME_BY_EXT[ext] || (TEXT_EXT.has(ext) ? "text/plain" : "application/octet-stream");
  }
  let kind = "file";
  if (mime.startsWith("image/")) kind = "image";
  else if (mime === "application/pdf") kind = "pdf";
  else if (mime === "text/html") kind = "html";
  else if (mime === "text/markdown" || [".md", ".markdown", ".mdx"].includes(ext)) kind = "markdown";
  else if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.has(ext)) kind = "text";
  else if (mime.startsWith("video/")) kind = "video";
  else if (mime.startsWith("audio/")) kind = "audio";
  return { kind, mime };
}

function deriveTitle({ title, filename, kind, text }) {
  if (title?.trim()) return title.trim().slice(0, LIMITS.titleChars);
  if (text && kind === "markdown") {
    const h1 = text.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
    if (h1) return h1[1].slice(0, LIMITS.titleChars);
  }
  if (text && kind === "html") {
    const t = text.match(/<title[^>]*>([^<]+)<\/title>/i) || text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (t) return t[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, LIMITS.titleChars);
  }
  const base = (filename || "Untitled").replace(/\.[^./]+$/, "");
  return base.slice(0, LIMITS.titleChars) || "Untitled";
}

function makeSnippet(kind, text) {
  if (!text) return "";
  let s = text;
  if (kind === "html") s = s.replace(/<(script|style|title)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  if (kind === "markdown") {
    s = s
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/^\s*#\s+.+$/m, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#>*_`~|-]+/g, " ");
  }
  return s.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function openStore(dataDir) {
  let path = ":memory:";
  if (dataDir !== ":memory:") {
    mkdirSync(dataDir, { recursive: true });
    path = join(dataDir, "tiergrader.db");
  }
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_token TEXT NOT NULL UNIQUE,
      invite_code TEXT NOT NULL UNIQUE,
      show_others INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      text TEXT,
      url TEXT,
      blob BLOB,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS items_by_collection ON items(collection_id, position);
    CREATE TABLE IF NOT EXISTS raters (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS raters_by_collection ON raters(collection_id, created_at);
    CREATE TABLE IF NOT EXISTS placements (
      rater_id TEXT NOT NULL REFERENCES raters(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tier TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (rater_id, item_id)
    );
    -- Signed-in creators (Every accounts). Raters never need one.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT '',
      subscriber INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      digest TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    -- Keys a signed-in creator makes for their agents; only a SHA-256 digest is kept.
    CREATE TABLE IF NOT EXISTS agent_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      digest TEXT NOT NULL UNIQUE,
      hint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
  `);
  // Added after the first release: which signed-in creator made a collection.
  if (!db.prepare("PRAGMA table_info(collections)").all().some((c) => c.name === "owner_user_id")) {
    db.exec("ALTER TABLE collections ADD COLUMN owner_user_id TEXT; CREATE INDEX IF NOT EXISTS collections_by_owner ON collections(owner_user_id, created_at);");
  }

  const now = () => new Date().toISOString();
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec("BEGIN");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
  const touch = (collectionId) => q("UPDATE collections SET updated_at = ? WHERE id = ?").run(now(), collectionId);

  const ITEM_COLUMNS = "id, collection_id, position, title, filename, mime, kind, size, text, url, created_at";

  const store = {
    createCollection({ title, description = "" }, ownerUserId = null) {
      const row = {
        id: token(10),
        title: String(title || "Untitled collection").trim().slice(0, LIMITS.titleChars) || "Untitled collection",
        description: String(description || "").slice(0, 4000),
        owner_token: token(24),
        invite_code: token(12),
        created_at: now(),
      };
      q(`INSERT INTO collections (id, title, description, owner_token, invite_code, created_at, updated_at, owner_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, row.title, row.description, row.owner_token, row.invite_code, row.created_at, row.created_at, ownerUserId);
      return store.getCollection(row.id);
    },

    collectionsOfUser(userId) {
      return q(`SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.collection_id = c.id) AS item_count,
                (SELECT COUNT(*) FROM raters r WHERE r.collection_id = c.id) AS rater_count
                FROM collections c WHERE c.owner_user_id = ? ORDER BY c.created_at DESC`).all(userId);
    },

    // ----- signed-in creators -----

    upsertUser({ id, email, name, tier, subscriber }) {
      const t = now();
      q(`INSERT INTO users (id, email, name, tier, subscriber, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, tier = excluded.tier,
         subscriber = excluded.subscriber, last_login_at = excluded.last_login_at`)
        .run(id, email, name, tier, subscriber ? 1 : 0, t, t);
      return q("SELECT * FROM users WHERE id = ?").get(id);
    },
    createSession(userId, digest, days) {
      const t = new Date();
      q("DELETE FROM sessions WHERE expires_at < ?").run(t.toISOString());
      q("INSERT INTO sessions (digest, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .run(digest, userId, t.toISOString(), new Date(t.getTime() + days * 86400_000).toISOString());
    },
    userBySession(digest) {
      return q(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ? AND s.expires_at > ?`).get(digest, now());
    },
    deleteSession(digest) {
      q("DELETE FROM sessions WHERE digest = ?").run(digest);
    },
    createAgentKey(userId, name, digest, hint) {
      const id = token(10);
      q("INSERT INTO agent_keys (id, user_id, name, digest, hint, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, userId, String(name || "Agent").trim().slice(0, LIMITS.nameChars) || "Agent", digest, hint, now());
      return q("SELECT id, name, hint, created_at, last_used_at FROM agent_keys WHERE id = ?").get(id);
    },
    listAgentKeys(userId) {
      return q("SELECT id, name, hint, created_at, last_used_at FROM agent_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId);
    },
    deleteAgentKey(userId, id) {
      return q("DELETE FROM agent_keys WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
    },
    userByAgentKey(digest) {
      const u = q(`SELECT u.*, k.id AS key_id FROM agent_keys k JOIN users u ON u.id = k.user_id WHERE k.digest = ?`).get(digest);
      if (u) q("UPDATE agent_keys SET last_used_at = ? WHERE id = ?").run(now(), u.key_id);
      return u;
    },

    getCollection(id) {
      return q("SELECT * FROM collections WHERE id = ?").get(id);
    },
    collectionByOwnerToken(t) {
      return q("SELECT * FROM collections WHERE owner_token = ?").get(t);
    },
    collectionByInvite(code) {
      return q("SELECT * FROM collections WHERE invite_code = ?").get(code);
    },
    raterByToken(t) {
      return q("SELECT * FROM raters WHERE token = ?").get(t);
    },

    updateCollection(id, { title, description, show_others }) {
      const c = store.getCollection(id);
      if (title !== undefined) c.title = String(title).trim().slice(0, LIMITS.titleChars) || c.title;
      if (description !== undefined) c.description = String(description).slice(0, 4000);
      if (show_others !== undefined) c.show_others = show_others ? 1 : 0;
      q("UPDATE collections SET title = ?, description = ?, show_others = ?, updated_at = ? WHERE id = ?")
        .run(c.title, c.description, c.show_others, now(), id);
      return store.getCollection(id);
    },

    deleteCollection(id) {
      q("DELETE FROM collections WHERE id = ?").run(id);
    },

    // input: { title?, filename?, mime?, data?: Buffer, text?: string, url?: string }
    addItem(collectionId, input) {
      const count = q("SELECT COUNT(*) AS n FROM items WHERE collection_id = ?").get(collectionId).n;
      if (count >= LIMITS.itemsPerCollection) throw httpError(400, `A collection holds at most ${LIMITS.itemsPerCollection} items.`);
      let { title, filename = "", mime = "", data, text, url } = input;
      filename = String(filename || "").split(/[\\/]/).pop().slice(0, 255);
      if (!filename && text !== undefined && !data) filename = title ? `${title}.md` : "text.md";
      const detected = url && !data && text === undefined ? { kind: "link", mime: "text/uri-list" } : detectKind(filename, mime);
      if (data && data.length > LIMITS.fileBytes) throw httpError(413, `${filename || "File"} is over ${LIMITS.fileBytes / 1024 / 1024} MB.`);
      if (text === undefined && data && ["markdown", "text", "html"].includes(detected.kind)) text = data.toString("utf8");
      if (text !== undefined && !data) data = Buffer.from(String(text), "utf8");
      if (text !== undefined) text = String(text).slice(0, LIMITS.textChars);
      const position = (q("SELECT MAX(position) AS p FROM items WHERE collection_id = ?").get(collectionId).p ?? 0) + 1;
      const item = {
        id: token(12),
        title: deriveTitle({ title, filename: filename || url, kind: detected.kind, text }),
        filename,
        mime: detected.mime,
        kind: detected.kind,
        size: data ? data.length : 0,
        text: text ?? null,
        url: url ? String(url).slice(0, 2000) : null,
      };
      q(`INSERT INTO items (id, collection_id, position, title, filename, mime, kind, size, text, url, blob, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(item.id, collectionId, position, item.title, item.filename, item.mime, item.kind, item.size, item.text, item.url, data ?? null, now());
      touch(collectionId);
      return store.getItem(item.id);
    },

    getItem(id) {
      return q(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).get(id);
    },
    getItemBlob(id) {
      return q("SELECT id, collection_id, title, filename, mime, kind, url, blob FROM items WHERE id = ?").get(id);
    },
    listItems(collectionId) {
      return q(`SELECT ${ITEM_COLUMNS} FROM items WHERE collection_id = ? ORDER BY position`).all(collectionId)
        .map((it, i) => ({ ...it, n: i + 1, snippet: makeSnippet(it.kind, it.text) }));
    },
    updateItem(collectionId, itemId, { title }) {
      const it = store.getItem(itemId);
      if (!it || it.collection_id !== collectionId) throw httpError(404, "No such item in this collection.");
      if (title !== undefined && String(title).trim()) {
        q("UPDATE items SET title = ? WHERE id = ?").run(String(title).trim().slice(0, LIMITS.titleChars), itemId);
      }
      touch(collectionId);
      return store.getItem(itemId);
    },
    deleteItem(collectionId, itemId) {
      const it = store.getItem(itemId);
      if (!it || it.collection_id !== collectionId) throw httpError(404, "No such item in this collection.");
      q("DELETE FROM items WHERE id = ?").run(itemId);
      touch(collectionId);
    },

    addRater(collectionId, name) {
      name = String(name || "").trim().replace(/\s+/g, " ").slice(0, LIMITS.nameChars);
      if (!name) throw httpError(400, "A name is required.");
      const count = q("SELECT COUNT(*) AS n FROM raters WHERE collection_id = ?").get(collectionId).n;
      if (count >= LIMITS.ratersPerCollection) throw httpError(400, "This collection has too many people.");
      const r = { id: token(10), token: token(16), created_at: now() };
      q("INSERT INTO raters (id, collection_id, name, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(r.id, collectionId, name, r.token, r.created_at, r.created_at);
      touch(collectionId);
      return q("SELECT * FROM raters WHERE id = ?").get(r.id);
    },
    listRaters(collectionId) {
      return q("SELECT * FROM raters WHERE collection_id = ? ORDER BY created_at").all(collectionId);
    },
    getRater(collectionId, raterId) {
      const r = q("SELECT * FROM raters WHERE id = ?").get(raterId);
      if (!r || r.collection_id !== collectionId) throw httpError(404, "No such person in this collection.");
      return r;
    },
    renameRater(collectionId, raterId, name) {
      store.getRater(collectionId, raterId);
      name = String(name || "").trim().replace(/\s+/g, " ").slice(0, LIMITS.nameChars);
      if (!name) throw httpError(400, "A name is required.");
      q("UPDATE raters SET name = ?, updated_at = ? WHERE id = ?").run(name, now(), raterId);
      touch(collectionId);
      return store.getRater(collectionId, raterId);
    },
    deleteRater(collectionId, raterId) {
      store.getRater(collectionId, raterId);
      q("DELETE FROM raters WHERE id = ?").run(raterId);
      touch(collectionId);
    },

    listPlacements(collectionId) {
      return q(`SELECT p.rater_id, p.item_id, p.tier, p.position FROM placements p
                JOIN raters r ON r.id = p.rater_id WHERE r.collection_id = ?
                ORDER BY p.rater_id, p.tier, p.position`).all(collectionId);
    },

    // moves: [{ item_id, tier, position? }] applied in order. tier "unsorted" removes the placement.
    // position is the 0-based index inside the target tier; omitted means the end.
    place(rater, moves) {
      const items = new Set(q("SELECT id FROM items WHERE collection_id = ?").all(rater.collection_id).map((r) => r.id));
      const lists = Object.fromEntries(TIERS.map((t) => [t.id, []]));
      for (const p of q("SELECT item_id, tier FROM placements WHERE rater_id = ? ORDER BY position").all(rater.id)) {
        if (isTier(p.tier) && items.has(p.item_id)) lists[p.tier].push(p.item_id);
      }
      for (const move of moves) {
        const tier = normalizeTier(move.tier);
        if (!tier) throw httpError(400, `Unknown tier "${move.tier}". Use S, A, B, C, D, F or unsorted.`);
        if (!items.has(move.item_id)) throw httpError(400, `No item ${move.item_id} in this collection.`);
        for (const list of Object.values(lists)) {
          const i = list.indexOf(move.item_id);
          if (i !== -1) list.splice(i, 1);
        }
        if (tier === UNSORTED) continue;
        const list = lists[tier];
        const at = Number.isInteger(move.position) ? Math.max(0, Math.min(move.position, list.length)) : list.length;
        list.splice(at, 0, move.item_id);
      }
      tx(() => {
        q("DELETE FROM placements WHERE rater_id = ?").run(rater.id);
        const ins = q("INSERT INTO placements (rater_id, item_id, tier, position) VALUES (?, ?, ?, ?)");
        for (const [tier, list] of Object.entries(lists)) list.forEach((id, i) => ins.run(rater.id, id, tier, i));
        q("UPDATE raters SET updated_at = ? WHERE id = ?").run(now(), rater.id);
        touch(rater.collection_id);
      });
    },
  };
  // For tests and one-off maintenance.
  store.db = db;
  return store;
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
