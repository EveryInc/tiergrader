// Every sign-in, run against a fake every.to OAuth server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";

const PEOPLE = {
  sub: { user_id: 42, email: "kieran@example.com", name: "Kieran", subscriber: true, tier: "all_access" },
  free: { user_id: 7, email: "free@example.com", name: "Free Reader", subscriber: false, tier: "free" },
};

let fake;
let app;
let base;
const seen = [];

before(async () => {
  fake = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      seen.push(Object.fromEntries(form));
      const ok = form.get("client_id") === "cid" && form.get("client_secret") === "secret" && form.get("code_verifier") && PEOPLE[form.get("code")];
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      return res.end(JSON.stringify(ok ? { access_token: `at-${form.get("code")}` } : { error: "invalid_grant" }));
    }
    if (url.pathname === "/oauth/userinfo") {
      const who = PEOPLE[String(req.headers.authorization).replace("Bearer at-", "")];
      res.writeHead(who ? 200 : 401, { "content-type": "application/json" });
      return res.end(JSON.stringify(who || {}));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => fake.listen(0, r));
  app = createApp({
    dataDir: ":memory:",
    publicUrl: "",
    createKey: "",
    every: { clientId: "cid", clientSecret: "secret", baseUrl: `http://localhost:${fake.address().port}`, scope: "basic_profile" },
  });
  await new Promise((r) => app.listen(0, r));
  base = `http://localhost:${app.address().port}`;
});
after(() => {
  app.closeStreams();
  app.close();
  fake.close();
});

const cookiesOf = (res) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("="));

async function signIn(code) {
  const start = await fetch(`${base}/auth/every?return_to=/somewhere`, { redirect: "manual" });
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("location"));
  assert.equal(to.pathname, "/oauth/authorize");
  assert.equal(to.searchParams.get("redirect_uri"), `${base}/auth/every/callback`);
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  const back = await fetch(`${base}/auth/every/callback?code=${code}&state=${to.searchParams.get("state")}`, {
    redirect: "manual",
    headers: { cookie: cookiesOf(start).join("; ") },
  });
  assert.equal(back.status, 302);
  return { location: back.headers.get("location"), cookie: cookiesOf(back).join("; ") };
}

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("subscribers sign in with Every and can create; nobody else can", async () => {
  assert.equal((await post("/api/collections", { title: "Nope" })).status, 401);

  const { location, cookie } = await signIn("sub");
  assert.equal(location, "/somewhere");
  assert.match(cookie, /^tg_session=/);
  assert.equal(seen.at(-1).redirect_uri, `${base}/auth/every/callback`);

  const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.auth, "every");
  assert.equal(me.user.name, "Kieran");
  assert.equal(me.can_create, true);

  const made = await post("/api/collections", { title: "Mine" }, { cookie });
  assert.equal(made.status, 201);
  const mine = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.deepEqual(mine.collections.map((c) => c.title), ["Mine"]);

  const free = await signIn("free");
  assert.equal((await post("/api/collections", { title: "Free" }, { cookie: free.cookie })).status, 403);
  assert.equal((await post("/api/me/agent-keys", { name: "x" }, { cookie: free.cookie })).status, 403);
});

test("rating never needs an account", async () => {
  const { cookie } = await signIn("sub");
  const made = await (await post("/api/collections", { title: "Rank me" }, { cookie })).json();
  const api = new URL(made.api_url).pathname;
  await post(`${api}/items`, { items: [{ title: "A", text: "a" }] });
  const code = new URL(made.join_url).pathname.split("/").pop();
  const joined = await (await post(`/api/j/${code}`, { name: "Dan" })).json();
  const placed = await post(`/api/r/${new URL(joined.url).pathname.split("/").pop()}/place`, { item_id: 1, tier: "S" });
  assert.equal(placed.status, 200);
});

test("agent keys create collections over REST and MCP, until deleted", async () => {
  const { cookie } = await signIn("sub");
  const made = await (await post("/api/me/agent-keys", { name: "Claude" }, { cookie })).json();
  assert.match(made.key, /^tg_[0-9a-z]{32}$/);
  const auth = { authorization: `Bearer ${made.key}` };
  assert.equal((await post("/api/collections", { title: "From agent" }, auth)).status, 201);

  const rpc = (url, headers = {}) =>
    post(url, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_collection", arguments: { title: "Via MCP" } } }, headers).then((r) => r.json());
  assert.equal((await rpc(`/mcp?key=${made.key}`)).result.isError, undefined);
  assert.equal((await rpc("/mcp", auth)).result.isError, undefined);
  assert.equal((await rpc("/mcp")).result.isError, true);

  const listed = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(listed.agent_keys[0].hint, made.key.slice(-4));
  assert.ok(!JSON.stringify(listed).includes(made.key), "the key itself is never shown again");
  await fetch(`${base}/api/me/agent-keys/${made.id}`, { method: "DELETE", headers: { cookie } });
  assert.equal((await post("/api/collections", { title: "Revoked" }, auth)).status, 401);
});

test("a forged or stale callback doesn't sign anyone in; logout ends the session", async () => {
  const start = await fetch(`${base}/auth/every`, { redirect: "manual" });
  const forged = await fetch(`${base}/auth/every/callback?code=sub&state=wrong`, { redirect: "manual", headers: { cookie: cookiesOf(start).join("; ") } });
  assert.match(forged.headers.get("location"), /^\/\?signin_error=/);
  assert.equal(cookiesOf(forged).length, 0);

  const bounce = await fetch(`${base}/auth/every?return_to=//evil.example`, { redirect: "manual" });
  const state = new URL(bounce.headers.get("location")).searchParams.get("state");
  const back = await fetch(`${base}/auth/every/callback?code=sub&state=${state}`, { redirect: "manual", headers: { cookie: cookiesOf(bounce).join("; ") } });
  assert.equal(back.headers.get("location"), "/", "only same-site return paths");

  const { cookie } = await signIn("sub");
  await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie }, redirect: "manual" });
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()).user, null);
});

test("hardening: stale agent keys, cross-site writes, staff-by-email, error codes", async () => {
  // Every staff addresses get no special pass: only subscriber status counts.
  PEOPLE.staff = { user_id: 9, email: "someone@every.to", name: "Staffer", subscriber: false, tier: "free" };
  const staff = await signIn("staff");
  assert.equal((await post("/api/collections", { title: "x" }, { cookie: staff.cookie })).status, 403);

  // A cookie-authenticated write from another site is refused.
  const { cookie } = await signIn("sub");
  assert.equal((await post("/api/collections", { title: "x" }, { cookie, origin: "https://evil.example" })).status, 403);
  assert.equal((await post("/api/collections", { title: "x" }, { cookie, "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post("/api/me/agent-keys", { name: "x" }, { cookie, origin: "https://evil.example" })).status, 403);

  // Agent keys stop working when their owner hasn't signed in (re-confirming the subscription) for 30 days.
  const made = await (await post("/api/me/agent-keys", { name: "old" }, { cookie })).json();
  app.store.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", "42");
  const stale = await post("/api/collections", { title: "x" }, { authorization: `Bearer ${made.key}` });
  assert.equal(stale.status, 401);
  assert.match((await stale.json()).error, /sign in/i);

  // Only fixed error codes travel in the URL; odd return paths fall back to "/".
  const start = await fetch(`${base}/auth/every?return_to=/caf%C3%A9`, { redirect: "manual" });
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const back = await fetch(`${base}/auth/every/callback?code=sub&state=${state}`, { redirect: "manual", headers: { cookie: cookiesOf(start).join("; ") } });
  assert.equal(back.headers.get("location"), "/");
  const cancelled = await fetch(`${base}/auth/every/callback?error=access_denied&error_description=Click%20evil.example`, { redirect: "manual" });
  assert.equal(cancelled.headers.get("location"), "/?signin_error=cancelled");
});

test("a public deploy won't start without deciding who can create", () => {
  assert.throws(() => createApp({ dataDir: ":memory:", hosted: true, createKey: "", every: { clientId: "" } }), /ALLOW_OPEN_CREATE/);
  assert.throws(() => createApp({ dataDir: ":memory:", hosted: true, publicUrl: "", every: { clientId: "c", clientSecret: "s", baseUrl: "https://every.to" } }), /PUBLIC_URL/);
  assert.throws(() => createApp({ dataDir: ":memory:", every: { clientId: "c", clientSecret: "s", baseUrl: "http://every.example" } }), /https/);
  const ok = createApp({ dataDir: ":memory:", hosted: true, createKey: "k", every: { clientId: "" } });
  assert.equal(ok.authMode, "key");
});

test("failed create attempts are rate-limited", async () => {
  let last;
  for (let i = 0; i < 22; i++) last = await post("/api/collections", { title: "x" }, { authorization: "Bearer tg_wrongwrongwrongwrongwrongwrongwr", "x-forwarded-for": "203.0.113.9" });
  assert.equal(last.status, 429);
});
