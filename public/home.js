// Home: sign in (when the server uses Every sign-in), create a collection, your collections, agent keys.
import { LOCKUP_HTML, agentPrompt } from "./shared.js";
import { startDemo } from "./demo.js";
import { EXAMPLES } from "./examples.js";

const REPO = "https://github.com/EveryInc/tiergrader";
const boot = JSON.parse(document.getElementById("boot")?.textContent || "{}");
const EVERY = boot.auth === "every";
const user = boot.user;
const canCreate = !EVERY || user?.subscriber;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
};
const ago = (t) => {
  const ms = typeof t === "number" ? t : Date.parse(t);
  const d = (Date.now() - ms) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const rated = read("tg.rated");
const AGENT_PROMPT = agentPrompt({ origin: location.origin, needsKey: boot.auth !== "open" });
let agentKeys = [];
const staged = [];
const main = document.getElementById("home");
const SIGNIN_ERRORS = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long. Try again.",
  failed: "Couldn't sign in with Every. Try again.",
};
const signinError = SIGNIN_ERRORS[new URLSearchParams(location.search).get("signin_error")];

const account = !EVERY
  ? ""
  : user
    ? `<form method="post" action="/auth/logout" class="account"><span>${esc(user.name)}</span><button class="btn small ghost">Sign out</button></form>`
    : `<a class="btn small" href="/auth/every?return_to=/">Sign in with Every</a>`;

const createForm = `
  <form class="create-form" novalidate>
    <div class="dropzone" tabindex="0" role="button" aria-label="Choose files">
      <strong>Drop files to make a tier grade</strong>
      <span>or <u>choose files</u>: posts, images, PDFs, HTML pages, anything</span>
      <div class="staged"></div>
    </div>
    <div class="create-row">
      <input class="input" name="title" placeholder="Name it (optional)" autocomplete="off" aria-label="Name (optional)">
      <button class="btn primary" type="submit">Create tier grade</button>
    </div>
  </form>`;

const gate = !user
  ? `<div class="panel gate">
      <h2>Sign in with Every to make a collection</h2>
      <p>Making collections here is for Every subscribers. Ranking doesn't need an account: if someone sent you a link, just open it.</p>
      <a class="btn primary" href="/auth/every?return_to=/">Sign in with Every</a>
      <p class="fine">Not a subscriber? tiergrader is open source (MIT), so you can <a href="${REPO}">run your own</a>.</p>
    </div>`
  : `<div class="panel gate">
      <h2>Making collections here is for Every subscribers</h2>
      <p>You're signed in as ${esc(user.email)}, which doesn't have a subscription. You can still rank anything you're sent a link to.</p>
      <a class="btn primary" href="https://every.to/subscribe">Subscribe to Every</a>
      <p class="fine">Or <a href="${REPO}">run your own tiergrader</a>: it's open source under the MIT license.</p>
    </div>`;

main.innerHTML = `
  <header class="home-top">
    ${LOCKUP_HTML}
    <div class="home-actions">
      <button class="btn" type="button" data-act="agent">Agent</button>
      ${account}
    </div>
  </header>
  ${signinError ? `<div class="notice error">${esc(signinError)}</div>` : ""}
  <section class="hero">
    <div class="hero-copy">
      <h1><span>Drop in files.</span> <span>Get everyone's tier grades.</span></h1>
      <p>Upload blog posts, designs, screenshots, anything. Share a link. Each person drags every card into S, A, B, C, D or F, and you see how each of them ranked it, and the average.</p>
    </div>
    <div class="demo" aria-hidden="true"></div>
    <div class="hero-form">${canCreate ? createForm : gate}</div>
  </section>

  ${examplesHtml()}
  <div data-owned></div>
  ${rated.length ? `<div class="section-title">Rankings you're part of</div><div class="link-list">${rated.map((x) => `<a href="${esc(x.url)}"><span>${esc(x.title)}</span><small>as ${esc(x.name)} · ${ago(x.at)}</small></a>`).join("")}</div>` : ""}

  <footer class="home-foot">tiergrader is <a href="${REPO}">open source</a> (MIT)${EVERY ? ` · An <a href="https://every.to">Every</a> experiment` : ""}</footer>`;

// ---------- examples anyone can try before making their own ----------

function examplesHtml() {
  const live = new Set((boot.examples || []).map((ex) => ex.slug));
  const list = EXAMPLES.filter((ex) => live.has(ex.slug));
  if (!list.length) return "";
  const thumb = (it) =>
    it.svg
      ? `<i class="ex-thumb logo"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(it.svg)}" alt=""></i>`
      : it.accent
        ? `<i class="ex-thumb page" style="background:${it.accent}"><b class="bars${["#5b3be8", "#121212", "#1a2ee1"].includes(it.accent) ? " light" : ""}"></b></i>`
        : `<i class="ex-thumb">${esc(it.title)}</i>`;
  return `<div class="section-title">Try one first</div>
    <div class="example-grid">${list
      .map((ex) => `<a class="example" href="/try/${ex.slug}">
        <span class="ex-thumbs">${ex.items.slice(0, 4).map(thumb).join("")}</span>
        <strong>${esc(ex.title)}</strong>
        <small>${ex.items.length} ${esc(ex.name.toLowerCase())} · already graded by Dan and Kate</small>
        <span class="ex-go">Grade it →</span>
      </a>`)
      .join("")}</div>`;
}

// ---------- your collections ----------

async function renderOwned() {
  const el = main.querySelector("[data-owned]");
  let list;
  if (EVERY && user) {
    const me = await fetch("/api/me").then((r) => r.json()).catch(() => null);
    list = (me?.collections || []).map((c) => ({ url: new URL(c.owner_url).pathname, title: c.title, meta: `${c.items} items · ${c.people} people · ${ago(c.created_at)}` }));
    agentKeys = me?.agent_keys || [];
  } else {
    list = read("tg.owned").map((x) => ({ url: x.url, title: x.title, meta: `owner · ${ago(x.at)}` }));
  }
  el.innerHTML = list.length
    ? `<div class="section-title">Your collections</div><div class="link-list">${list.map((x) => `<a href="${esc(x.url)}"><span>${esc(x.title)}</span><small>${esc(x.meta)}</small></a>`).join("")}</div>`
    : "";
}

// ---------- agent keys (Every sign-in only) ----------

function renderKeys(keys, fresh = null) {
  if (!(EVERY && user?.subscriber)) return;
  const box = document.querySelector("dialog [data-agents]");
  if (!box) return;
  const origin = location.origin;
  box.innerHTML = `
    <h3>Agent keys</h3>
    <p>On this server, agents need a key to make tier grades. Make one for each agent you use, and give it the key when it asks.</p>
    ${fresh ? `<div class="fresh-key">
      <strong>Copy this key now. It won't be shown again.</strong>
      <div class="copy-row"><input class="input" readonly data-select value="${esc(fresh.key)}"><button class="btn" type="button" data-copy="${esc(fresh.key)}">Copy</button></div>
      <pre>curl -s -X POST ${esc(origin)}/api/collections \\
  -H 'authorization: Bearer ${esc(fresh.key)}' \\
  -H 'content-type: application/json' -d '{"title": "Which intro is best?"}'

# Claude Code, as an MCP server:
claude mcp add --transport http tiergrader ${esc(origin)}/mcp --header "Authorization: Bearer ${esc(fresh.key)}"</pre>
    </div>` : ""}
    <form class="copy-row" data-new-key style="margin-top:10px">
      <input class="input" name="name" placeholder="Name this key, e.g. Claude Code" autocomplete="off" style="font-family:var(--sans)">
      <button class="btn primary">Make an agent key</button>
    </form>
    ${keys.length ? `<div class="people-list" style="margin-top:10px">${keys.map((k) => `<div class="person-row" style="grid-template-columns:1fr auto auto">
      <span class="name">${esc(k.name)}<small>…${esc(k.hint)} · made ${ago(k.created_at)}${k.last_used_at ? ` · used ${ago(k.last_used_at)}` : " · never used"}</small></span>
      <span></span>
      <button class="icon-btn" type="button" data-delete-key="${esc(k.id)}" title="Delete this key" aria-label="Delete key">✕</button>
    </div>`).join("")}</div>` : ""}`;
  box.querySelector("[data-new-key]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch("/api/me/agent-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: e.target.name.value || "Agent" }) });
    const out = await res.json();
    if (!res.ok) return alert(out.error);
    const me = await fetch("/api/me").then((r) => r.json());
    agentKeys = me.agent_keys;
    renderKeys(agentKeys, out);
  });
}

// ---------- the Agent dialog: one prompt to paste into any agent (plus agent keys, when signed in) ----------

function openAgent() {
  document.querySelector("dialog")?.remove();
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Use it with your agent</h2><button class="icon-btn" type="button" data-close aria-label="Close">✕</button></div>
    <div class="dlg-body">
      <section class="dlg-section agent-box">
        <p>Copy this into your agent (Claude, ChatGPT, Codex…). It explains tiergrader, asks you what to grade and who should grade it, then makes the tier grade and gives you the links.</p>
        <div class="prompt-box"><pre>${esc(AGENT_PROMPT)}</pre><button class="btn small" type="button" data-copy="${esc(AGENT_PROMPT)}">Copy prompt</button></div>
      </section>
      ${EVERY && user?.subscriber ? `<section class="dlg-section" data-agents></section>` : ""}
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
  renderKeys(agentKeys);
}

document.addEventListener("click", async (e) => {
  if (e.target.closest('[data-act="agent"]')) return openAgent();
  const copyBtn = e.target.closest("[data-copy]");
  if (copyBtn) {
    await navigator.clipboard.writeText(copyBtn.dataset.copy).catch(() => {});
    const label = copyBtn.textContent;
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = label), 1500);
  }
  const del = e.target.closest("[data-delete-key]");
  if (del && confirm("Delete this key? Agents using it stop working.")) {
    await fetch(`/api/me/agent-keys/${del.dataset.deleteKey}`, { method: "DELETE" });
    const me = await fetch("/api/me").then((r) => r.json());
    agentKeys = me.agent_keys;
    renderKeys(agentKeys);
  }
});

renderOwned();
startDemo(main.querySelector(".demo"));

// "+ New" on a grading page lands here: bring the file drop into view.
if (location.hash === "#create") {
  const target = main.querySelector(".hero-form");
  target?.scrollIntoView({ block: "center" });
  target?.querySelector(".dropzone, .btn")?.focus({ preventScroll: true });
}

// Read-only fields (keys, links) select themselves on focus; inline handlers are blocked by the page's CSP.
document.addEventListener("focusin", (e) => e.target.matches?.("[data-select]") && e.target.select());

// ---------- create a collection ----------

const form = main.querySelector("form.create-form");
if (form) {
  const zone = form.querySelector(".dropzone");
  const stagedEl = form.querySelector(".staged");
  const submit = form.querySelector("button[type=submit]");

  const renderStaged = () => {
    stagedEl.innerHTML = staged.map((f, i) => `<span>${esc(f.name)}<button type="button" data-i="${i}" aria-label="Remove ${esc(f.name)}">✕</button></span>`).join("");
  };
  const stage = (files) => {
    staged.push(...files);
    renderStaged();
  };
  stagedEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    e.stopPropagation();
    staged.splice(Number(b.dataset.i), 1);
    renderStaged();
  });
  const choose = () => {
    const input = Object.assign(document.createElement("input"), { type: "file", multiple: true });
    input.onchange = () => stage(input.files);
    input.click();
  };
  zone.addEventListener("click", choose);
  zone.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), choose()));
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    stage(e.dataTransfer.files);
  });

  const post = async (url, body, headers = {}) => {
    const res = await fetch(url, { method: "POST", headers, body });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error || `Request failed (${res.status})`), { status: res.status });
    return out;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // The name is optional; the owner can rename it later on the collection page.
    const title = form.title.value.trim() || `Tier grade · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    submit.disabled = true;
    submit.textContent = "Creating…";
    try {
      const payload = JSON.stringify({ title });
      let made;
      try {
        made = await post("/api/collections", payload, { "content-type": "application/json" });
      } catch (err) {
        if (err.status !== 403 || EVERY) throw err;
        const key = prompt("Password to make tier grades on this server:");
        if (!key) throw new Error("Making tier grades here needs the password.");
        made = await post("/api/collections", payload, { "content-type": "application/json", "x-create-key": key });
      }
      let done = 0;
      const queue = staged.slice();
      const worker = async () => {
        while (queue.length) {
          const f = queue.shift();
          const fd = new FormData();
          fd.append("file", f, f.name);
          await post(`/api/o/${made.owner_token}/items`, fd).catch(() => {});
          submit.textContent = `Uploading ${++done} of ${staged.length}…`;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      location.href = new URL(made.owner_url).pathname;
    } catch (err) {
      alert(err.message);
      submit.disabled = false;
      submit.textContent = "Create tier grade";
    }
  });
}
