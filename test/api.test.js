import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { computeResults, normalizeTier, tierForScore } from "../public/shared.js";

let server;
let base;

before(async () => {
  server = createApp({ dataDir: ":memory:", publicUrl: "", createKey: "" });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.closeStreams();
  server.close();
});

async function call(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const res = await fetch(base + path, init);
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.text(), headers: res.headers };
}

const pathOf = (url) => new URL(url).pathname;

async function setup() {
  const made = (await call("POST", "/api/collections", { title: "Intros", description: "Judge the hook" })).body;
  const api = pathOf(made.api_url);
  const fd = new FormData();
  fd.append("file", new Blob(["# Hook one\n\nBody one"], { type: "text/markdown" }), "one.md");
  fd.append("file", new Blob(["plain two"], { type: "text/plain" }), "two.txt");
  await call("POST", `${api}/items`, fd);
  await call("POST", `${api}/items`, { items: [{ title: "Three", text: "three" }] });
  const { raters } = (await call("POST", `${api}/raters`, { names: "Kieran, Dan" })).body;
  return { made, api, raters, kieran: pathOf(raters[0].url).split("/").pop(), dan: pathOf(raters[1].url).split("/").pop() };
}

test("tier scale and averaging", () => {
  assert.equal(normalizeTier("4"), "S");
  assert.equal(normalizeTier("-"), "F");
  assert.equal(normalizeTier("-1"), "F");
  assert.equal(normalizeTier("b"), "B");
  assert.equal(normalizeTier(null), "unsorted");
  assert.equal(normalizeTier("Z"), undefined);
  assert.equal(tierForScore(0.5), "C"); // ties round up
  assert.equal(tierForScore(3.6), "S");
  const res = computeResults(
    [{ id: "a", n: 1, title: "A" }, { id: "b", n: 2, title: "B" }, { id: "c", n: 3, title: "C" }],
    [{ id: "r1", name: "One" }, { id: "r2", name: "Two" }],
    [
      { rater_id: "r1", item_id: "a", tier: "S" },
      { rater_id: "r2", item_id: "a", tier: "B" },
      { rater_id: "r1", item_id: "b", tier: "F" },
    ],
  );
  assert.deepEqual(res.items.map((r) => [r.id, r.avg, r.tier, r.rank]), [["a", 3, "A", 1], ["b", -1, "F", 2], ["c", null, "unsorted", null]]);
  assert.deepEqual(res.raters.map((r) => r.ranked), [2, 1]);
});

test("create, upload, invite, rank, results", async () => {
  const { made, api, kieran, dan } = await setup();
  assert.match(made.owner_url, /\/o\/[0-9a-z]{24}$/);
  assert.match(made.join_url, /\/j\/[0-9a-z]{12}$/);

  const view = (await call("GET", api)).body;
  assert.deepEqual(view.items.map((i) => [i.n, i.title, i.kind]), [[1, "Hook one", "markdown"], [2, "two", "text"], [3, "Three", "markdown"]]);

  let r = await call("POST", `/api/r/${kieran}/place`, { moves: [{ item_id: 1, tier: "S" }, { item_id: 2, tier: "4" }, { item_id: 3, tier: "-" }] });
  assert.equal(r.status, 200);
  r = await call("POST", `/api/r/${kieran}/place`, { item_id: 2, tier: "S", position: 0 });
  const board = (await call("GET", `/api/r/${kieran}/board`)).body.board;
  assert.deepEqual(board.S.map((x) => x.title), ["two", "Hook one"]);
  assert.deepEqual(board.F.map((x) => x.title), ["Three"]);
  assert.deepEqual(board.unsorted, []);

  await call("POST", `/api/r/${dan}/place`, { moves: [{ item_id: 1, tier: "B" }] });
  const results = (await call("GET", `${api}/results`)).body;
  assert.equal(results.items[0].title, "two");
  assert.equal(results.items[0].average, 4);
  const hook = results.items.find((i) => i.title === "Hook one");
  assert.equal(hook.average, 3);
  assert.equal(hook.consensus_tier, "A");
  assert.deepEqual(hook.ratings.map((x) => [x.name, x.tier]).sort(), [["Dan", "B"], ["Kieran", "S"]]);

  const csv = (await call("GET", `${api}/results.csv`)).body;
  assert.match(csv.split("\n")[0], /^rank,n,title,average,ratings,consensus,Kieran,Dan$/);
  assert.match(csv, /\n1,2,two,4,1,S,S,\n/);
});

test("bad moves are rejected without partial writes", async () => {
  const { kieran } = await setup();
  let r = await call("POST", `/api/r/${kieran}/place`, { moves: [{ item_id: 1, tier: "S" }, { item_id: 1, tier: "Z" }] });
  assert.equal(r.status, 400);
  r = await call("POST", `/api/r/${kieran}/place`, { moves: [{ item_id: 99, tier: "S" }] });
  assert.equal(r.status, 400);
  const board = (await call("GET", `/api/r/${kieran}/board`)).body.board;
  assert.equal(board.unsorted.length, 3);
});

test("personal links only see others when the owner allows it", async () => {
  const { api, kieran, dan } = await setup();
  await call("POST", `/api/r/${dan}/place`, { item_id: 1, tier: "A" });
  let view = (await call("GET", `/api/r/${kieran}`)).body;
  assert.equal(view.raters.length, 2);
  assert.equal(view.items[0].filename, undefined, "raters never see file names");
  assert.equal(view.raters[0].url, undefined, "raters never see other people's links");
  await call("PATCH", api, { show_others: false });
  view = (await call("GET", `/api/r/${kieran}`)).body;
  assert.deepEqual(view.raters.map((r) => r.name), ["Kieran"]);
  assert.equal(view.placements.length, 0);
});

test("open link joins with a name", async () => {
  const { made } = await setup();
  const code = pathOf(made.join_url).split("/").pop();
  const info = (await call("GET", `/api/j/${code}`)).body;
  assert.equal(info.items, 3);
  const joined = await call("POST", `/api/j/${code}`, { name: "Austin" });
  assert.equal(joined.status, 201);
  assert.match(joined.body.url, /\/r\/[0-9a-z]{16}$/);
  assert.equal((await call("POST", `/api/j/${code}`, { name: "  " })).status, 400);
});

test("removing items and people", async () => {
  const { api, kieran, raters } = await setup();
  const view = (await call("GET", api)).body;
  await call("POST", `/api/r/${kieran}/place`, { item_id: view.items[0].id, tier: "S" });
  await call("DELETE", `${api}/items/${view.items[0].id}`);
  const board = (await call("GET", `/api/r/${kieran}/board`)).body.board;
  assert.equal(board.S.length, 0);
  await call("DELETE", `${api}/raters/${raters[0].id}`);
  assert.equal((await call("GET", `/api/r/${kieran}`)).status, 404);
});

test("pages: links, agent brief, content negotiation, bad tokens", async () => {
  const { made, kieran } = await setup();
  const owner = pathOf(made.owner_url);
  const page = await call("GET", owner, undefined, { accept: "text/html" });
  assert.equal(page.status, 200);
  assert.match(page.body, /id="agent-brief"/);
  assert.match(page.body, /owner link/);
  assert.ok(page.headers.get("content-security-policy"));
  const md = await call("GET", `/r/${kieran}?format=md`);
  assert.match(md.body, /Kieran's personal link/);
  const asJson = await call("GET", owner, undefined, { accept: "application/json" });
  assert.equal(asJson.body.role, "owner");
  assert.equal((await call("GET", "/o/notarealtoken")).status, 404);
  assert.equal((await call("GET", "/api/o/notarealtoken")).status, 404);
  const llms = await call("GET", "/llms.txt");
  assert.match(llms.body, /# tiergrader/);
});

test("uploaded HTML is served sandboxed", async () => {
  const { api } = await setup();
  const { added } = (await call("POST", `${api}/items`, { items: [{ filename: "page.html", text: "<title>Hi</title><script>alert(1)</script>" }] })).body;
  assert.equal(added[0].title, "Hi");
  const res = await fetch(`${base}/f/${added[0].id}`);
  assert.match(res.headers.get("content-security-policy"), /^sandbox/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("MCP: initialize, list, full workflow", async () => {
  const rpc = async (id, method, params) => (await call("POST", "/mcp", { jsonrpc: "2.0", id, method, params })).body;
  const init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal((await call("POST", "/mcp", { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const tools = (await rpc(2, "tools/list")).result.tools.map((t) => t.name);
  assert.ok(tools.includes("create_rater_links") && tools.includes("place_items"));

  const tool = async (name, args) => {
    const out = (await rpc(3, "tools/call", { name, arguments: args })).result;
    assert.ok(!out.isError, out.content?.[0]?.text);
    return out.structuredContent;
  };
  const made = await tool("create_collection", { title: "Via MCP" });
  await tool("add_items", { owner: made.owner_url, items: [{ title: "X", text: "x" }, { title: "Y", text: "y" }] });
  const { links } = await tool("create_rater_links", { owner: made.owner_token, names: ["Kate"] });
  const placed = await tool("place_items", { person: links[0].url, moves: [{ item_id: "2", tier: "S" }, { item_id: "1", tier: "D" }] });
  assert.deepEqual(placed.board.S.map((x) => x.title), ["Y"]);
  const results = await tool("get_results", { owner: made.owner_url });
  assert.deepEqual(results.items.map((i) => [i.title, i.average]), [["Y", 4], ["X", 0]]);
  const read = await tool("read_item", { link: links[0].url, item_id: "1" });
  assert.equal(read.text, "x");

  const bad = (await rpc(4, "tools/call", { name: "get_results", arguments: { owner: "nope" } })).result;
  assert.equal(bad.isError, true);
});

test("odd content types can't dodge the sandbox; downloads don't reveal file names", async () => {
  const { api } = await setup();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
  const { added } = (await call("POST", `${api}/items`, {
    items: [
      { filename: "x.svg", mime: "image/svg+xml ", text: svg },
      { filename: "y.svg", mime: "image/x+xml", text: svg },
      { filename: "gpt5-secret.png", mime: "image/png", content_base64: Buffer.from("png").toString("base64"), title: "Option A" },
      { title: "Site", url: "https://example.com" },
    ],
  })).body;
  for (const it of added.slice(0, 2)) {
    const res = await fetch(`${base}/f/${it.id}`);
    assert.match(res.headers.get("content-security-policy") || "", /^sandbox/, `${it.mime} must be sandboxed`);
  }
  const png = await fetch(`${base}/f/${added[2].id}?download`);
  assert.equal(png.headers.get("content-security-policy"), null);
  assert.match(png.headers.get("content-disposition"), /Option%20A\.png/);
  assert.doesNotMatch(png.headers.get("content-disposition"), /secret/);
  const link = await fetch(`${base}/f/${added[3].id}`, { redirect: "manual" });
  assert.equal(link.status, 200, "link items are not redirects");
});

test("CSV export defuses formulas but keeps negative numbers", async () => {
  const { made, api, kieran } = await setup();
  const code = pathOf(made.join_url).split("/").pop();
  await call("POST", `/api/j/${code}`, { name: '=HYPERLINK("http://evil")' });
  await call("POST", `${api}/items`, { items: [{ title: "+cmd", text: "x" }] });
  await call("POST", `/api/r/${kieran}/place`, { item_id: 1, tier: "F" });
  const csv = (await call("GET", `${api}/results.csv`)).body;
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
  assert.match(csv, /,'\+cmd,/);
  assert.match(csv, /,-1,1,F,F,/);
});

test("a join name with line breaks makes one person", async () => {
  const { made, api } = await setup();
  const code = pathOf(made.join_url).split("/").pop();
  const joined = (await call("POST", `/api/j/${code}`, { name: "Alice\nBob\nCarol" })).body;
  assert.equal(joined.name, "Alice Bob Carol");
  assert.equal((await call("GET", api)).body.raters.length, 3); // Kieran, Dan and this one
});

test("MCP protocol errors", async () => {
  const raw = (body) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body });
  let res = await raw("{nope");
  assert.equal((await res.json()).error.code, -32700);
  res = await raw("[]");
  assert.equal((await res.json()).error.code, -32600);
  res = await raw(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: null }));
  assert.equal(res.status, 200);
  assert.ok((await res.json()).result.tools.length);
});

test("create key, when set, is required to make collections", async () => {
  const locked = createApp({ dataDir: ":memory:", createKey: "letmein" });
  await new Promise((resolve) => locked.listen(0, resolve));
  const url = `http://localhost:${locked.address().port}`;
  const post = (headers) => fetch(`${url}/api/collections`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ "x-create-key": "letmein" })).status, 201);
  locked.close();
});
