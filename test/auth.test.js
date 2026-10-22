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

test("an agent gets a key on its person's behalf: it works only once they approve it", async () => {
  // No password, no sign-in: the agent asks, and gets a key that does nothing yet plus a link for its person.
  const asked = await post("/api/agent-keys", { name: "Claude in Slack" });
  assert.equal(asked.status, 201);
  const { key, approve_url, status } = await asked.json();
  assert.match(key, /^tg_[0-9a-z]{32}$/);
  assert.equal(status, "waiting");
  const approve = new URL(approve_url).pathname;
  assert.match(approve, /^\/approve\/[0-9a-z]{24}$/);

  const auth = { authorization: `Bearer ${key}` };
  const early = await post("/api/collections", { title: "Too soon" }, auth);
  assert.equal(early.status, 401);
  assert.ok((await early.json()).error.includes(approve_url), "the refusal hands the agent its link again");
  assert.equal((await (await fetch(`${base}/api/agent-keys/status`, { headers: auth })).json()).status, "waiting");

  // Signed out, the link sends the person through Every sign-in and back to it.
  const page = await (await fetch(base + approve)).text();
  assert.match(page, /Claude in Slack/);
  assert.ok(page.includes(`/auth/every?return_to=${approve}`));
  const start = await fetch(`${base}/auth/every?return_to=${approve}`, { redirect: "manual" });
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const returned = await fetch(`${base}/auth/every/callback?code=sub&state=${state}`, { redirect: "manual", headers: { cookie: cookiesOf(start).join("; ") } });
  assert.equal(returned.headers.get("location"), approve);
  const cookie = cookiesOf(returned).join("; ");

  const signedIn = await (await fetch(base + approve, { headers: { cookie } })).text();
  assert.match(signedIn, /value="approve"/);
  assert.match(signedIn, /Kieran/);

  const form = (decision, headers = {}) =>
    fetch(base + approve, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, ...headers }, body: `decision=${decision}` });
  assert.equal((await form("approve", { origin: "https://evil.example" })).status, 403, "approving must happen on tiergrader's own page");
  assert.equal((await fetch(base + approve, { method: "POST", body: "decision=approve" })).status, 401, "and by someone signed in");

  const approved = await form("approve");
  assert.equal(approved.status, 200);
  assert.match(await approved.text(), /Approved/);

  assert.equal((await post("/api/collections", { title: "From Slack" }, auth)).status, 201);
  assert.deepEqual(await (await fetch(`${base}/api/agent-keys/status`, { headers: auth })).json(), { status: "active", owner: "Kieran" });
  const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  const listed = me.agent_keys.find((k) => k.name === "Claude in Slack");
  assert.equal(listed.hint, key.slice(-4), "it's an ordinary agent key of theirs, deletable on the home page");
  assert.ok(me.collections.some((c) => c.title === "From Slack"));

  // The link is used up.
  assert.equal((await fetch(base + approve, { headers: { cookie } })).status, 404);
  assert.equal((await form("approve")).status, 404);
});

test("a key request can be turned down, expires, and needs a subscriber", async () => {
  const { cookie } = await signIn("sub");
  const ask = async () => {
    const r = await (await post("/api/agent-keys", { name: "Some agent" })).json();
    return { ...r, path: new URL(r.approve_url).pathname, auth: { authorization: `Bearer ${r.key}` } };
  };
  const decide = (path, decision, c = cookie) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: c }, body: `decision=${decision}` });

  const denied = await ask();
  assert.match(await (await decide(denied.path, "deny")).text(), /didn.t get a key/);
  assert.equal((await post("/api/collections", { title: "x" }, denied.auth)).status, 401);
  assert.equal((await (await fetch(`${base}/api/agent-keys/status`, { headers: denied.auth })).json()).status, "unknown");

  const free = await signIn("free");
  const blocked = await ask();
  assert.match(await (await fetch(base + blocked.path, { headers: { cookie: free.cookie } })).text(), /Every subscription/);
  assert.equal((await decide(blocked.path, "approve", free.cookie)).status, 403);
  assert.equal((await post("/api/collections", { title: "x" }, blocked.auth)).status, 401);

  const old = await ask();
  app.store.db.prepare("UPDATE key_requests SET expires_at = ? WHERE digest IS NOT NULL").run("2020-01-01T00:00:00.000Z");
  assert.equal((await fetch(base + old.path, { headers: { cookie } })).status, 404);
  assert.equal((await decide(old.path, "approve")).status, 404);
  assert.equal((await post("/api/collections", { title: "x" }, old.auth)).status, 401);
});

test("over MCP, an agent without a key is told how to get one, and can", async () => {
  const rpc = (name, args, headers = {}) =>
    post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, headers).then((r) => r.json());
  const refused = await rpc("create_collection", { title: "No key" });
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /request_agent_key/);

  const got = (await rpc("request_agent_key", { name: "MCP agent" })).result.structuredContent;
  assert.equal(got.status, "waiting");
  const { cookie } = await signIn("sub");
  await fetch(new URL(got.approve_url).pathname.replace(/^/, base), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: "decision=approve" });
  assert.equal((await rpc("create_collection", { title: "With key" }, { authorization: `Bearer ${got.key}` })).result.isError, undefined);
});
