// Who may create collections. Ranking never needs an account: a personal link is the only key to a ranking.
//
// Three modes, picked from the environment:
//   every - EVERY_OAUTH_CLIENT_ID is set: sign in with Every (OAuth2 against every.to); Every subscribers
//           can create collections, in the browser or through agent keys they make on the home page.
//   key   - only CREATE_KEY is set: whoever has that one key can create.
//   open  - neither: anyone can create (local use, or a private self-hosted server).
// CREATE_KEY also works in "every" mode, as an operator override.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { token } from "./store.js";

const SESSION_DAYS = 30;
// Agent keys keep working while their owner has signed in (and so re-confirmed the subscription) this recently.
const KEY_FRESH_DAYS = 30;

const digest = (s) => createHash("sha256").update(String(s)).digest("hex");
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// The first cookie of a name wins (browsers send the most specific one first).
export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* malformed cookie value */
    }
  }
  return out;
}

function cookie(name, value, { maxAge, secure, path = "/" }) {
  return [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, "HttpOnly", "SameSite=Lax", secure && "Secure", maxAge !== undefined && `Max-Age=${maxAge}`]
    .filter(Boolean)
    .join("; ");
}

// Only same-site paths in plain ASCII, so the sign-in can't bounce people elsewhere or break on odd bytes.
const safeReturn = (p) => (typeof p === "string" && /^\/(?![/\\])[\x21-\x7e]*$/.test(p) ? p : "/");

// Every's userinfo says `subscriber` and `tier` (all_access, standard, free).
export const isSubscriber = (u) => !!u && (u.subscriber === 1 || u.subscriber === true || ["all_access", "standard"].includes(u.tier));

const SIGNIN_ERRORS = ["cancelled", "expired", "failed"];

export function createAuth({ store, every = {}, createKey = "", publicUrl = "" }) {
  const { clientId = "", clientSecret = "", baseUrl = "https://every.to", scope = "basic_profile" } = every;
  const mode = clientId ? "every" : createKey ? "key" : "open";
  const everyBase = baseUrl.replace(/\/+$/, "");
  const origin = (base) => (publicUrl || base).replace(/\/+$/, "");
  // every.to matches the redirect URI exactly, so it must be the registered one: PUBLIC_URL + this path.
  const redirectUri = (base) => `${origin(base)}/auth/every/callback`;
  const secure = (base) => origin(base).startsWith("https://");
  // Over https the cookies carry the __Host- prefix: host-only, Secure and Path=/, so no sibling subdomain can plant one.
  const names = (base) => (secure(base) ? { session: "__Host-tg_session", state: "__Host-tg_oauth" } : { session: "tg_session", state: "tg_oauth" });
  const sessionFrom = (req) => {
    const c = parseCookies(req.headers.cookie);
    return c["__Host-tg_session"] || c.tg_session;
  };
  // Cookie-authenticated writes must come from tiergrader's own pages.
  const sameOrigin = (req, base) => {
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin" && site !== "none") return false;
    const from = req.headers.origin;
    return !from || from === new URL(origin(base)).origin;
  };
  const keyIsFresh = (user) => Date.now() - Date.parse(user.last_login_at) < KEY_FRESH_DAYS * 86400_000;

  const keyFrom = (req, url) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""))?.[1];
    return String(bearer || req.headers["x-create-key"] || url?.searchParams.get("key") || "").trim();
  };

  function currentUser(req) {
    const sid = sessionFrom(req);
    return (sid && store.userBySession(digest(sid))) || null;
  }

  return {
    mode,

    currentUser,
    sameOrigin,

    // { ok: true, user } or { ok: false, status, reason }
    creator(req, url, base, bodyKey = "") {
      if (mode === "open") return { ok: true, user: null };
      const key = keyFrom(req, url) || String(bodyKey || "");
      if (createKey && key && safeEqual(key, createKey)) return { ok: true, user: null };
      if (mode === "key") return { ok: false, status: 403, reason: "Creating collections on this server needs the create key (x-create-key header)." };
      let user = null;
      if (key.startsWith("tg_")) {
        user = store.userByAgentKey(digest(key));
        if (user && !keyIsFresh(user)) {
          return { ok: false, status: 401, reason: `This agent key's owner needs to sign in at ${origin(base)} again (every ${KEY_FRESH_DAYS} days) to keep it working.` };
        }
      } else if (sessionFrom(req)) {
        if (!sameOrigin(req, base)) return { ok: false, status: 403, reason: "Cross-site request refused." };
        user = currentUser(req);
      }
      if (!user) {
        return {
          ok: false,
          status: 401,
          reason: "Sign in with Every to create collections. Agents: make an agent key on the home page and send it as \"Authorization: Bearer tg_...\".",
        };
      }
      if (!isSubscriber(user)) {
        return { ok: false, status: 403, reason: "Creating collections here is for Every subscribers. tiergrader is open source, so you can also run your own." };
      }
      return { ok: true, user };
    },

    start(req, res, url, base) {
      const state = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(32));
      const authorize = new URL("/oauth/authorize", everyBase);
      authorize.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(base),
        response_type: "code",
        scope,
        state,
        code_challenge: b64url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
      });
      const returnTo = b64url(safeReturn(url.searchParams.get("return_to")));
      res.writeHead(302, {
        location: authorize.href,
        "set-cookie": cookie(names(base).state, `${state}.${verifier}.${returnTo}`, { maxAge: 600, secure: secure(base) }),
        "cache-control": "no-store",
      });
      res.end();
    },

    async callback(req, res, url, base) {
      const { state: stateName, session: sessionName } = names(base);
      const [state, verifier, returnTo] = String(parseCookies(req.headers.cookie)[stateName] || "").split(".");
      const clearState = cookie(stateName, "", { maxAge: 0, secure: secure(base) });
      // Only fixed codes go in the URL; the home page has the wording.
      const fail = (code) => {
        res.writeHead(302, { location: `/?signin_error=${SIGNIN_ERRORS.includes(code) ? code : "failed"}`, "set-cookie": clearState, "cache-control": "no-store" });
        res.end();
      };
      if (url.searchParams.get("error")) return fail("cancelled");
      const code = url.searchParams.get("code");
      if (!state || !code || !safeEqual(state, url.searchParams.get("state") || "")) return fail("expired");

      let me;
      try {
        const tokenRes = await fetch(new URL("/oauth/token", everyBase), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(base), client_id: clientId, client_secret: clientSecret, code_verifier: verifier }),
          signal: AbortSignal.timeout(10_000),
        });
        const tok = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tok.access_token) throw new Error(`token exchange: ${tok.error || tokenRes.status}`);
        const infoRes = await fetch(new URL("/oauth/userinfo", everyBase), {
          headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        me = await infoRes.json().catch(() => ({}));
        if (!infoRes.ok || !me.user_id || !me.email) throw new Error(`userinfo: ${infoRes.status}`);
        if (me.email_verified === false) throw new Error("email not verified");
      } catch (err) {
        console.error("Every sign-in failed:", err.message);
        return fail("failed");
      }

      // Every's access token isn't kept: tiergrader only needs to know who this is, once.
      const user = store.upsertUser({
        id: String(me.user_id),
        email: String(me.email),
        name: String(me.name || [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email),
        tier: String(me.tier || ""),
        subscriber: me.subscriber === true,
      });
      const sid = b64url(randomBytes(32));
      store.createSession(user.id, digest(sid), SESSION_DAYS);
      res.writeHead(302, {
        location: safeReturn(Buffer.from(returnTo || "", "base64url").toString()),
        "set-cookie": [clearState, cookie(sessionName, sid, { maxAge: SESSION_DAYS * 86400, secure: secure(base) })],
        "cache-control": "no-store",
      });
      res.end();
    },

    logout(req, res, base) {
      const sid = sessionFrom(req);
      if (!sameOrigin(req, base)) return res.writeHead(303, { location: "/" }).end();
      if (sid) store.deleteSession(digest(sid));
      res.writeHead(303, { location: "/", "set-cookie": cookie(names(base).session, "", { maxAge: 0, secure: secure(base) }), "cache-control": "no-store" });
      res.end();
    },

    // The key itself is returned once; only its digest is stored.
    newAgentKey(user, name) {
      const key = `tg_${token(32)}`;
      return { ...store.createAgentKey(user.id, name, digest(key), key.slice(-4)), key };
    },
  };
}
