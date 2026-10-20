// The HTTP app: pages, the REST API, file serving, live updates (server-sent events) and /mcp.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore, httpError, LIMITS } from "./store.js";
import { createAuth, isSubscriber, parseCookies } from "./auth.js";
import { ensureExamples, exampleBySlug } from "./examples.js";
import { EXAMPLES } from "../public/examples.js";
import { createService } from "./service.js";
import { createMcpHandler } from "./mcp.js";
import { llmsTxt, ownerBrief, raterBrief } from "./agent-docs.js";
import { homePage, boardPage, joinPage, notFoundPage, CDN } from "./pages.js";

const VERSION = "0.1.0";
const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 1_000_000;

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Our own pages only load our scripts plus the three pinned libraries from jsdelivr.
const PAGE_CSP = [
  "default-src 'self'",
  `script-src 'self' ${Object.values(CDN).map((c) => c.src).join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com",
  "font-src https://fonts.gstatic.com https://cdn.fontshare.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "frame-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|webm|aac|flac)|application\/pdf)$/;

const publicUser = (u) => ({ name: u.name, email: u.email, tier: u.tier, subscriber: isSubscriber(u) });

// Refuse to start with settings that would quietly expose a public server.
function checkConfig({ every, createKey, publicUrl, allowOpen, hosted }) {
  const publicDeploy = hosted || publicUrl.startsWith("https://");
  if (!every.clientId && !createKey && publicDeploy && !allowOpen) {
    throw new Error("No EVERY_OAUTH_CLIENT_ID or PASSWORD is set, so anyone could create tier grades. Set one, or ALLOW_OPEN_CREATE=1 if that's intended.");
  }
  if (every.clientId) {
    if (!every.clientSecret) throw new Error("EVERY_OAUTH_CLIENT_ID is set without EVERY_OAUTH_CLIENT_SECRET.");
    if (publicDeploy && !publicUrl) throw new Error("Every sign-in needs PUBLIC_URL: the callback URL registered with Every is built from it.");
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(every.baseUrl.replace(/\/+$/, ""));
    if (!every.baseUrl.startsWith("https://") && !local) throw new Error("EVERY_OAUTH_BASE_URL must be https.");
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-tiergrader-client, x-create-key, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id",
};

export function createApp({
  dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "./data",
  // Render sets RENDER_EXTERNAL_URL for every web service.
  publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "",
  // The shared password for creating tier grades (CREATE_KEY is the older name for it).
  createKey = process.env.PASSWORD || process.env.CREATE_KEY || "",
  originTrialToken = process.env.WEBMCP_ORIGIN_TRIAL_TOKEN || "",
  every = {
    clientId: process.env.EVERY_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.EVERY_OAUTH_CLIENT_SECRET || "",
    baseUrl: process.env.EVERY_OAUTH_BASE_URL || "https://every.to",
    scope: process.env.EVERY_OAUTH_SCOPE || "basic_profile",
  },
  allowOpen = process.env.ALLOW_OPEN_CREATE === "1",
  seedExamples = true,
  hosted = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RENDER),
} = {}) {
  checkConfig({ every, createKey, publicUrl, allowOpen, hosted });
  const store = openStore(dataDir);
  const auth = createAuth({ store, every, createKey, publicUrl });
  if (seedExamples) ensureExamples(store, (line) => console.log(line));

  // collection id -> open event streams
  const streams = new Map();
  const broadcast = (collectionId, source = "") => {
    const set = streams.get(collectionId);
    if (!set) return;
    const msg = `data: ${JSON.stringify({ type: "change", source })}\n\n`;
    for (const res of set) res.write(msg);
  };

  const service = createService(store, { broadcast });
  const handleMcp = createMcpHandler({ store, service, version: VERSION });

  // A per-address limit on the two things anyone can do without an owner link: create a collection, and
  // join one through its open link. The last X-Forwarded-For entry is the one the hosting proxy added.
  const hits = new Map();
  const tooMany = (req, bucket, perMinute) => {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",").pop().trim() || req.socket.remoteAddress || "";
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    let h = hits.get(`${bucket}:${ip}`);
    if (!h || h.reset < now) hits.set(`${bucket}:${ip}`, (h = { n: 0, reset: now + 60_000 }));
    return ++h.n > perMinute;
  };

  const baseUrl = (req) => {
    if (publicUrl) return publicUrl.replace(/\/+$/, "");
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (req.socket.encrypted ? "https" : "http");
    return `${proto}://${req.headers.host}`;
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, headers);
    res.end(body);
  };
  const json = (res, status, value, headers = {}) =>
    send(res, status, JSON.stringify(value, null, 2), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...headers });
  const html = (res, status, body) =>
    send(res, status, body, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PAGE_CSP,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      // Chrome's WebMCP origin trial: turns document.modelContext on for every visitor, no flags needed.
      ...(originTrialToken ? { "origin-trial": originTrialToken } : {}),
    });
  const markdown = (res, body) => send(res, 200, body, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store", ...CORS });

  async function readBody(req, limit) {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > limit) throw httpError(413, `Request is over ${Math.round(limit / 1024 / 1024)} MB.`);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw httpError(413, `Request is over ${Math.round(limit / 1024 / 1024)} MB.`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function readJson(req, limit = MAX_JSON_BYTES) {
    const buf = await readBody(req, limit);
    if (!buf.length) return {};
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      throw httpError(400, "Body must be JSON.");
    }
  }

  // Files arrive as multipart (curl -F file=@a.md), as JSON {items: [...]}, or as one raw body.
  async function readItemInputs(req, url) {
    const type = String(req.headers["content-type"] || "");
    if (type.startsWith("multipart/form-data")) {
      const buf = await readBody(req, MAX_UPLOAD_BYTES);
      let form;
      try {
        form = await new Request("http://local/", { method: "POST", headers: { "content-type": type }, body: buf }).formData();
      } catch {
        throw httpError(400, "Couldn't read the multipart upload.");
      }
      const files = [...form.values()].filter((v) => typeof v !== "string");
      const title = form.get("title");
      return Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          mime: f.type,
          data: Buffer.from(await f.arrayBuffer()),
          title: files.length === 1 && typeof title === "string" ? title : undefined,
        })),
      );
    }
    if (type.includes("application/json")) {
      const body = await readJson(req, MAX_UPLOAD_BYTES);
      return Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : [body];
    }
    const data = await readBody(req, LIMITS.fileBytes + 1);
    return [{ data, mime: type, filename: url.searchParams.get("filename") || "upload", title: url.searchParams.get("title") || undefined }];
  }

  const ownerOr404 = (t) => {
    const c = store.collectionByOwnerToken(t);
    if (!c) throw httpError(404, "That owner link doesn't match a collection.");
    return c;
  };
  const raterOr404 = (t) => {
    const r = store.raterByToken(t);
    if (!r) throw httpError(404, "That personal link doesn't match anyone.");
    return r;
  };

  function openStream(req, res, collectionId) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 3000\n\n");
    if (!streams.has(collectionId)) streams.set(collectionId, new Set());
    streams.get(collectionId).add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      const set = streams.get(collectionId);
      set?.delete(res);
      if (set && !set.size) streams.delete(collectionId);
    });
  }

  function serveItemFile(req, res, url, itemId) {
    const row = store.getItemBlob(itemId);
    if (!row) return html(res, 404, notFoundPage("That file isn't here any more."));
    // Links aren't redirected, so /f/ can't be used to bounce people to arbitrary sites.
    if (row.kind === "link") return send(res, 200, `This item is a link: ${row.url}\n`, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    const data = row.blob ?? Buffer.alloc(0);
    const mime = /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(row.mime) ? row.mime : "application/octet-stream";
    const textual = mime.startsWith("text/") || mime === "application/json";
    const headers = {
      "content-type": textual ? `${mime}; charset=utf-8` : mime,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
    };
    // Only types that can't run script are served as-is. Everything else (HTML, SVG, XML, text...) runs
    // sandboxed in an opaque origin, so it can't touch tiergrader's pages or storage.
    if (!SAFE_INLINE.test(mime)) headers["content-security-policy"] = "sandbox allow-scripts allow-popups allow-forms allow-modals";
    // Named after the card's title, not the uploaded file name, which raters aren't meant to see.
    const ext = extname(row.filename || "").replace(/[^\w.]/g, "").slice(0, 12);
    const asName = encodeURIComponent(`${(row.title || "download").replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 100) || "download"}${ext}`);
    if (url.searchParams.has("download") || row.kind === "file" || mime === "application/octet-stream") {
      headers["content-disposition"] = `attachment; filename*=UTF-8''${asName}`;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && data.length) {
      let start = range[1] === "" ? data.length - Number(range[2]) : Number(range[1]);
      let end = range[1] === "" || range[2] === "" ? data.length - 1 : Number(range[2]);
      start = Math.max(0, start);
      end = Math.min(end, data.length - 1);
      if (start > end) return send(res, 416, "", { "content-range": `bytes */${data.length}` });
      return send(res, 206, data.subarray(start, end + 1), { ...headers, "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": end - start + 1 });
    }
    send(res, 200, req.method === "HEAD" ? undefined : data, { ...headers, "content-length": data.length });
  }

  async function serveStatic(res, rel) {
    const path = normalize(join(PUBLIC_DIR, rel));
    if (!path.startsWith(PUBLIC_DIR) || !STATIC_TYPES[extname(path)]) return html(res, 404, notFoundPage());
    try {
      const body = await readFile(path);
      send(res, 200, body, { "content-type": STATIC_TYPES[extname(path)], "cache-control": "no-cache" });
    } catch {
      html(res, 404, notFoundPage());
    }
  }

  const wants = (req, url) => {
    const format = url.searchParams.get("format");
    const accept = String(req.headers.accept || "");
    if (format === "json" || (accept.includes("application/json") && !accept.includes("text/html"))) return "json";
    if (format === "md" || /^text\/(markdown|plain)/.test(accept)) return "md";
    return "html";
  };

  async function route(req, res) {
    const url = new URL(req.url, "http://local");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method;
    const base = baseUrl(req);
    const source = String(req.headers["x-tiergrader-client"] || "api");
    let m;

    if (method === "OPTIONS") return send(res, 204, "", CORS);

    // Every sign-in (only when it's configured)
    if (path.startsWith("/auth/")) {
      if (path === "/auth/logout" && method === "POST") return auth.logout(req, res, base);
      if (auth.mode !== "every") return html(res, 404, notFoundPage("Every sign-in isn't set up on this server."));
      if (path === "/auth/every" && method === "GET") return auth.start(req, res, url, base);
      if (path === "/auth/every/callback" && method === "GET") return auth.callback(req, res, url, base);
    }

    // Pages
    if (method === "GET" || method === "HEAD") {
      if (path === "/") {
        const user = auth.currentUser(req);
        const examples = EXAMPLES.filter((ex) => store.exampleCollection(`${ex.slug}@${ex.version}`)).map((ex) => ({ slug: ex.slug, name: ex.name, title: ex.title, count: ex.items.length }));
        return html(res, 200, homePage(base, { auth: auth.mode, user: user && publicUser(user), examples }));
      }
      // Try an example: each visitor gets their own guest ranking, kept for them in a cookie.
      if ((m = path.match(/^\/try\/([a-z0-9-]+)$/))) {
        const ex = exampleBySlug(m[1]);
        const c = ex && store.exampleCollection(`${ex.slug}@${ex.version}`);
        if (!c) return html(res, 404, notFoundPage("There's no example by that name."));
        const cookieName = `tg_try_${ex.slug.replace(/-/g, "_")}`;
        const mine = store.raterByToken(parseCookies(req.headers.cookie)[cookieName] || "");
        if (mine && mine.collection_id === c.id) return send(res, 303, "", { location: `/r/${mine.token}`, "cache-control": "no-store" });
        if (tooMany(req, "join", 30)) throw httpError(429, "Too many from here. Try again in a minute.");
        store.pruneGuests(c.id);
        const r = store.addRater(c.id, "You", { guest: true });
        const secure = base.startsWith("https://") ? "; Secure" : "";
        return send(res, 303, "", {
          location: `/r/${r.token}`,
          "set-cookie": `${cookieName}=${r.token}; Path=/try; Max-Age=${14 * 86400}; HttpOnly; SameSite=Lax${secure}`,
          "cache-control": "no-store",
        });
      }
      if (path === "/healthz") return json(res, 200, { ok: true });
      if (path === "/llms.txt" || path === "/agents.md") return markdown(res, llmsTxt(base, auth.mode));
      if ((m = path.match(/^\/static\/([\w.-]+)$/))) return serveStatic(res, m[1]);
      if ((m = path.match(/^\/f\/([0-9a-z]+)(?:\/[^/]*)?$/))) return serveItemFile(req, res, url, m[1]);

      if ((m = path.match(/^\/o\/([0-9a-z]+)$/))) {
        const c = store.collectionByOwnerToken(m[1]);
        if (!c) return html(res, 404, notFoundPage());
        const view = service.ownerView(c, base);
        const as = wants(req, url);
        if (as === "json") return json(res, 200, view);
        if (as === "md") return markdown(res, ownerBrief(base, view));
        return html(res, 200, boardPage({ title: c.title, boot: { role: "owner", token: m[1] }, brief: ownerBrief(base, view) }));
      }
      if ((m = path.match(/^\/r\/([0-9a-z]+)$/))) {
        const r = store.raterByToken(m[1]);
        if (!r) return html(res, 404, notFoundPage());
        const view = service.raterView(r, base);
        const as = wants(req, url);
        if (as === "json") return json(res, 200, view);
        const brief = raterBrief(base, view, service.raterBoard(r, base));
        if (as === "md") return markdown(res, brief);
        return html(res, 200, boardPage({ title: view.collection.title, boot: { role: "rater", token: m[1] }, brief }));
      }
      if ((m = path.match(/^\/j\/([0-9a-z]+)$/))) {
        const c = store.collectionByInvite(m[1]);
        if (!c) return html(res, 404, notFoundPage());
        return html(res, 200, joinPage({ collection: c, code: m[1], count: store.listItems(c.id).length }));
      }
    }

    // MCP
    if (path === "/mcp") {
      if (method !== "POST") return send(res, 405, "", { allow: "POST", ...CORS });
      let body;
      try {
        body = JSON.parse((await readBody(req, MAX_UPLOAD_BYTES)).toString("utf8"));
      } catch (err) {
        if (err.status) throw err;
        return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      const [status, payload] = handleMcp(body, base, {
        // Agents send their key as "Authorization: Bearer ..." or, for clients that can't set headers, /mcp?key=...
        canCreate: () => {
          if (tooMany(req, "create", 20)) return { ok: false, reason: "Too many new collections from here. Try again in a minute." };
          const who = auth.creator(req, url, base);
          return who.ok ? { ok: true, userId: who.user?.id ?? null } : { ok: false, reason: who.reason };
        },
      });
      if (!payload) return send(res, status, "", CORS);
      return json(res, status, payload);
    }

    if (!path.startsWith("/api/")) return html(res, 404, notFoundPage());

    // Live updates
    if ((m = path.match(/^\/api\/events\/(o|r)\/([0-9a-z]+)$/)) && method === "GET") {
      const collectionId = m[1] === "o" ? ownerOr404(m[2]).id : raterOr404(m[2]).collection_id;
      return openStream(req, res, collectionId);
    }

    if (path === "/api/collections" && method === "POST") {
      // Counted before the check, so guessing keys is rate-limited too.
      if (tooMany(req, "create", 20)) throw httpError(429, "Too many new collections from here. Try again in a minute.");
      const body = await readJson(req);
      const who = auth.creator(req, url, base, body.create_key);
      if (!who.ok) throw httpError(who.status, who.reason);
      return json(res, 201, service.createCollection(body, base, who.user?.id ?? null));
    }

    // The signed-in creator: who they are, their collections, their agent keys.
    if (path === "/api/me" && method === "GET") {
      const user = auth.currentUser(req);
      return json(res, 200, {
        auth: auth.mode,
        user: user && publicUser(user),
        can_create: auth.mode === "open" || (auth.mode === "every" && isSubscriber(user)),
        collections: user
          ? store.collectionsOfUser(user.id).map((c) => ({
              title: c.title,
              owner_url: `${base}/o/${c.owner_token}`,
              items: c.item_count,
              people: c.rater_count,
              created_at: c.created_at,
            }))
          : [],
        agent_keys: user ? store.listAgentKeys(user.id) : [],
      });
    }
    if (path.startsWith("/api/me/") && !auth.sameOrigin(req, base)) throw httpError(403, "Cross-site request refused.");
    if (path === "/api/me/agent-keys" && method === "POST") {
      const user = auth.currentUser(req);
      if (!user) throw httpError(401, "Sign in first.");
      if (!isSubscriber(user)) throw httpError(403, "Agent keys are for Every subscribers.");
      if (store.listAgentKeys(user.id).length >= 20) throw httpError(400, "You have 20 agent keys already. Delete one first.");
      return json(res, 201, auth.newAgentKey(user, (await readJson(req)).name));
    }
    if ((m = path.match(/^\/api\/me\/agent-keys\/([0-9a-z]+)$/)) && method === "DELETE") {
      const user = auth.currentUser(req);
      if (!user || !store.deleteAgentKey(user.id, m[1])) throw httpError(404, "No such key.");
      return json(res, 200, { deleted: m[1] });
    }

    // Join by open link
    if ((m = path.match(/^\/api\/j\/([0-9a-z]+)$/))) {
      const c = store.collectionByInvite(m[1]);
      if (!c) throw httpError(404, "That open link doesn't match a collection.");
      if (method === "GET") return json(res, 200, { title: c.title, description: c.description, items: store.listItems(c.id).length });
      if (method === "POST") {
        if (tooMany(req, "join", 30)) throw httpError(429, "Too many people joined from here. Try again in a minute.");
        const body = await readJson(req);
        // One person per join, whatever the name contains (addRater collapses line breaks into spaces).
        const r = store.addRater(c.id, body.name);
        broadcast(c.id, source);
        return json(res, 201, { id: r.id, name: r.name, url: `${base}/r/${r.token}` });
      }
    }

    // Owner API
    if ((m = path.match(/^\/api\/o\/([0-9a-z]+)(\/.*)?$/))) {
      const c = ownerOr404(m[1]);
      const sub = m[2] || "";
      let s;
      if (sub === "") {
        if (method === "GET") return json(res, 200, service.ownerView(c, base));
        if (method === "PATCH") return json(res, 200, { collection: service.updateCollection(c, await readJson(req), source) });
        if (method === "DELETE") {
          store.deleteCollection(c.id);
          broadcast(c.id, source);
          return json(res, 200, { deleted: c.id });
        }
      }
      if (sub === "/place" && method === "POST") {
        // The owner's own ranking.
        const body = await readJson(req);
        service.place(store.ownerRater(c), Array.isArray(body) ? body : body.moves ?? [body], source);
        return json(res, 200, service.ownerView(store.getCollection(c.id), base));
      }
      if (sub === "/items" && method === "POST") {
        const inputs = await readItemInputs(req, url);
        return json(res, 201, { added: service.addItems(c, inputs, base, source) });
      }
      if ((s = sub.match(/^\/items\/([0-9a-z]+)$/))) {
        if (method === "GET") return json(res, 200, service.readItem(c.id, s[1], base));
        if (method === "PATCH") {
          service.updateItem(c, s[1], await readJson(req), source);
          return json(res, 200, service.readItem(c.id, s[1], base));
        }
        if (method === "DELETE") {
          service.deleteItem(c, s[1], source);
          return json(res, 200, { deleted: s[1] });
        }
      }
      if (sub === "/raters" && method === "POST") {
        const body = await readJson(req);
        return json(res, 201, { raters: service.createRaters(c, body.names ?? body.name, base, source) });
      }
      if ((s = sub.match(/^\/raters\/([0-9a-z]+)$/))) {
        if (method === "PATCH") return json(res, 200, service.renameRater(c, s[1], (await readJson(req)).name, source));
        if (method === "DELETE") {
          service.deleteRater(c, s[1], source);
          return json(res, 200, { deleted: s[1] });
        }
      }
      if (sub === "/results" && method === "GET") return json(res, 200, service.resultsView(c, base));
      if (sub === "/results.csv" && method === "GET") {
        const name = c.title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "results";
        return send(res, 200, service.resultsCsv(c), {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.csv"`,
          ...CORS,
        });
      }
    }

    // Personal (rater) API
    if ((m = path.match(/^\/api\/r\/([0-9a-z]+)(\/.*)?$/))) {
      const r = raterOr404(m[1]);
      const sub = m[2] || "";
      let s;
      if (sub === "" && method === "GET") return json(res, 200, service.raterView(r, base));
      if (sub === "/board" && method === "GET") return json(res, 200, service.raterBoard(r, base));
      if ((s = sub.match(/^\/items\/([0-9a-z]+)$/)) && method === "GET") return json(res, 200, service.readItem(r.collection_id, s[1], base));
      if (sub === "/place" && method === "POST") {
        const body = await readJson(req);
        const moves = Array.isArray(body) ? body : body.moves ?? [body];
        service.place(r, moves, source);
        return json(res, 200, service.raterView(r, base));
      }
    }

    throw httpError(404, "No such endpoint. See /llms.txt for the API.");
  }

  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      json(res, status, { error: status === 500 ? "Something went wrong on the server." : err.message }, status === 413 ? { connection: "close" } : {});
    }
  });
  server.store = store;
  server.authMode = auth.mode;
  server.closeStreams = () => {
    for (const set of streams.values()) for (const res of set) res.end();
    streams.clear();
  };
  return server;
}
