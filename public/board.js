// The tier board: owner pages (/o/...) show everyone's rankings and manage the collection;
// personal pages (/r/...) are one person's editable ranking.
import { TIERS, UNSORTED, LOCKUP_HTML, computeResults, normalizeTier } from "./shared.js";
import { registerAgentTools } from "./agent.js";

const boot = JSON.parse(document.getElementById("boot").textContent);
const OWNER = boot.role === "owner";
const API = `/api/${OWNER ? "o" : "r"}/${boot.token}`;
const CLIENT = crypto.randomUUID();
const TIER_IDS = TIERS.map((t) => t.id);
const COLOR = Object.fromEntries(TIERS.map((t) => [t.id, t.color]));
const POINTS = Object.fromEntries(TIERS.map((t) => [t.id, t.points]));
const KIND_LABEL = { markdown: "MD", text: "TXT", html: "HTML", image: "IMG", pdf: "PDF", video: "VIDEO", audio: "AUDIO", link: "LINK", file: "FILE" };
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  data: null,
  viewing: null, // a rater id, or "everyone"
  table: false,
  selected: null,
  preview: false,
  undo: [],
  dragging: false,
  pendingWrites: 0,
  refreshQueued: false,
  localVersion: 0, // bumped by every local move, so in-flight refreshes can tell they're stale
};
let byId = new Map();
let sortables = [];
let previewBodyFor = null;
let writes = Promise.resolve();

// ---------- helpers ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const fmtAvg = (v) => (v === null || v === undefined ? "–" : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ""));
const fileUrl = (it) => `/f/${it.id}`;

function remember(key, entry) {
  try {
    const list = JSON.parse(localStorage.getItem(key) || "[]").filter((x) => x.url !== entry.url);
    localStorage.setItem(key, JSON.stringify([entry, ...list].slice(0, 40)));
  } catch {
    /* storage unavailable */
  }
}

async function api(path = "", { method = "GET", json, body } = {}) {
  const headers = { "x-tiergrader-client": CLIENT };
  if (json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(API + path, { method, headers, body: json !== undefined ? JSON.stringify(json) : body });
  const isJson = res.headers.get("content-type")?.includes("json");
  const out = isJson ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(out?.error || `Request failed (${res.status})`), { status: res.status });
  return out;
}

async function copy(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(label);
}

let toastTimer;
function toast(message, { action, onAction, sticky = false } = {}) {
  let el = document.querySelector(".toast");
  if (!el) el = Object.assign(document.createElement("div"), { className: "toast", role: "status" });
  // Inside an open modal dialog, or it would sit under the backdrop.
  (document.querySelector("dialog[open]") || document.body).append(el);
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
  if (action) el.querySelector("button").onclick = () => { el.remove(); onAction(); };
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => el.remove(), action ? 5000 : 2600);
}

// ---------- derived state ----------

const me = () => state.data.me;
const items = () => state.data.items;
const editable = () => !OWNER && state.viewing === me().id;
const raterName = (id) => state.data.raters.find((r) => r.id === id)?.name ?? "Someone";

function boardOf(raterId) {
  const lists = Object.fromEntries([...TIER_IDS.map((t) => [t, []]), [UNSORTED, []]]);
  const mine = state.data.placements.filter((p) => p.rater_id === raterId && byId.has(p.item_id));
  mine.sort((a, b) => a.position - b.position);
  const placed = new Set();
  for (const p of mine) {
    lists[p.tier]?.push(p.item_id);
    placed.add(p.item_id);
  }
  for (const it of items()) if (!placed.has(it.id)) lists[UNSORTED].push(it.id);
  return lists;
}

function results() {
  return computeResults(items(), state.data.raters, state.data.placements);
}

// The board on screen: one person's, or everyone's average (each card in the tier nearest its average).
function currentView() {
  if (state.viewing !== "everyone") return { lists: boardOf(state.viewing), extra: null };
  const res = results();
  const lists = Object.fromEntries([...TIER_IDS.map((t) => [t, []]), [UNSORTED, []]]);
  const extra = new Map();
  for (const row of res.items) {
    lists[row.tier].push(row.id);
    extra.set(row.id, row);
  }
  lists[UNSORTED].sort((a, b) => byId.get(a).n - byId.get(b).n);
  return { lists, extra, res };
}

function locate(raterId, itemId) {
  const lists = boardOf(raterId);
  for (const [tier, ids] of Object.entries(lists)) {
    const i = ids.indexOf(itemId);
    if (i !== -1) return { tier, position: i };
  }
  return { tier: UNSORTED, position: 0 };
}

function rankedCount(raterId) {
  return state.data.placements.filter((p) => p.rater_id === raterId && byId.has(p.item_id)).length;
}

// Same rules as the server: each move pulls the item out and inserts it at `position` (default: end).
function applyLocal(raterId, moves) {
  const lists = boardOf(raterId);
  for (const { item_id, tier, position } of moves) {
    for (const ids of Object.values(lists)) {
      const i = ids.indexOf(item_id);
      if (i !== -1) ids.splice(i, 1);
    }
    if (tier === UNSORTED) continue;
    const list = lists[tier];
    const at = Number.isInteger(position) ? Math.max(0, Math.min(position, list.length)) : list.length;
    list.splice(at, 0, item_id);
  }
  state.data.placements = state.data.placements.filter((p) => p.rater_id !== raterId);
  for (const t of TIER_IDS) lists[t].forEach((id, i) => state.data.placements.push({ rater_id: raterId, item_id: id, tier: t, position: i }));
}

// Moves that rebuild a saved board exactly (used for undo).
function restoreMoves(lists) {
  const moves = [];
  for (const t of TIER_IDS) lists[t].forEach((id, i) => moves.push({ item_id: id, tier: t, position: i }));
  for (const id of lists[UNSORTED]) moves.push({ item_id: id, tier: UNSORTED });
  return moves;
}

// ---------- writing ----------

function save(moves) {
  state.pendingWrites++;
  writes = writes.then(async () => {
    try {
      const fresh = await api("/place", { method: "POST", json: { moves } });
      if (state.pendingWrites === 1 && !state.dragging) applyData(fresh);
    } catch (err) {
      toast(`Couldn't save that move: ${err.message}`);
      state.refreshQueued = true;
    } finally {
      state.pendingWrites--;
      if (!state.pendingWrites && state.refreshQueued) refresh();
    }
  });
  return writes;
}

// Place items on your own board. moves: [{ item_id, tier, position? }]
function place(moves, { animate = true, record = true, advanceFrom = null } = {}) {
  if (!editable()) return false;
  const rid = me().id;
  const snapshot = boardOf(rid);
  const rects = animate ? captureRects() : null;
  state.localVersion++;
  applyLocal(rid, moves);
  if (record) state.undo.push(snapshot);
  if (state.undo.length > 100) state.undo.shift();
  const next = advanceFrom && nextUnsorted(advanceFrom);
  if (next) state.selected = next;
  render();
  if (rects) playFlip(rects);
  for (const m of moves) flashTier(m.tier);
  // The reader covers the board, so say where the card went.
  if (state.preview && moves.length === 1) {
    const it = byId.get(moves[0].item_id);
    const where = moves[0].tier === UNSORTED ? "Unsorted" : `${moves[0].tier} tier`;
    toast(advanceFrom && !next ? `#${it.n} → ${where}. That's everything ranked.` : `#${it.n} ${it.title} → ${where}`);
  }
  save(moves);
  return true;
}

function undo() {
  if (!editable()) return;
  const snapshot = state.undo.pop();
  if (!snapshot) return toast("Nothing to undo");
  place(restoreMoves(snapshot), { record: false });
  toast("Undone");
}

function nextUnsorted(fromId) {
  const unsorted = boardOf(me().id)[UNSORTED].map((id) => byId.get(id)).sort((a, b) => a.n - b.n);
  if (!unsorted.length) return null;
  const fromN = byId.get(fromId)?.n ?? 0;
  return (unsorted.find((it) => it.n > fromN) ?? unsorted[0]).id;
}

// ---------- loading & live updates ----------

function applyData(data) {
  state.data = data;
  byId = new Map(data.items.map((it) => [it.id, it]));
  const valid = (v) => v === "everyone" || data.raters.some((r) => r.id === v);
  if (!state.viewing || !valid(state.viewing)) state.viewing = OWNER ? "everyone" : data.me.id;
  if (!OWNER && state.viewing === "everyone" && !data.raters.some((r) => r.id !== data.me.id)) state.viewing = data.me.id;
  if (state.selected && !byId.has(state.selected)) {
    state.selected = null;
    state.preview = false;
  }
  render();
}

// Refetch the page's data (debounced). Every caller in the same window shares one promise. A fetch that
// overlaps a drag or a local move is thrown away and tried again, so it can't paint an older board.
let refreshTimer;
let refreshWaiters = [];
function refresh() {
  clearTimeout(refreshTimer);
  return new Promise((resolve) => {
    refreshWaiters.push(resolve);
    refreshTimer = setTimeout(runRefresh, 150);
  });
}

async function runRefresh() {
  const waiters = refreshWaiters;
  refreshWaiters = [];
  const busy = () => state.dragging || state.pendingWrites > 0;
  try {
    if (busy()) {
      state.refreshQueued = true;
      return;
    }
    state.refreshQueued = false;
    const version = state.localVersion;
    const data = await api("");
    if (busy() || version !== state.localVersion) {
      state.refreshQueued = true;
      if (!busy()) refresh();
      return;
    }
    applyData(data);
  } catch (err) {
    if (err.status === 404) gone();
  } finally {
    for (const resolve of waiters) resolve();
  }
}

function connectEvents() {
  const es = new EventSource(`/api/events/${OWNER ? "o" : "r"}/${boot.token}`);
  let opened = false;
  // After a dropped connection (a redeploy, a sleeping laptop), catch up on whatever was missed.
  es.onopen = () => {
    if (opened) refresh();
    opened = true;
  };
  es.onmessage = (e) => {
    try {
      if (JSON.parse(e.data).source === CLIENT) return;
    } catch {
      /* refresh anyway */
    }
    refresh();
  };
}

function gone() {
  document.getElementById("app").innerHTML = `<main class="notfound">${LOCKUP_HTML}<h1>This link no longer works</h1><p>The collection or this person's ranking was deleted.</p></main>`;
}

// ---------- rendering ----------

const app = document.getElementById("app");
app.innerHTML = `
  <header class="topbar"></header>
  <nav class="peoplebar" aria-label="Whose ranking to show"></nav>
  <main class="workspace">
    <div class="board-scroll"></div>
  </main>
  <div class="reader" hidden>
    <div class="reader-scrim" data-act="close"></div>
    <section class="preview" role="dialog" aria-modal="true" aria-label="Reader">
      <div class="preview-head"></div>
      <div class="preview-body"></div>
      <div class="preview-bar"></div>
    </section>
  </div>`;
const topbar = app.querySelector(".topbar");
const peoplebar = app.querySelector(".peoplebar");
const boardScroll = app.querySelector(".board-scroll");
const reader = app.querySelector(".reader");
const preview = app.querySelector(".preview");
const [pHead, pBody, pBar] = preview.children;
const TRASH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>`;

function render() {
  renderTopbar();
  renderPeople();
  renderBoard();
  renderPreview();
}

function renderTopbar() {
  if (topbar.contains(document.activeElement) && document.activeElement.isContentEditable) return;
  const c = state.data.collection;
  document.title = `${c.title} · tiergrader`;
  const total = items().length;
  let progress = "";
  if (!OWNER) {
    const done = rankedCount(me().id);
    progress = `<div class="progress" title="${done} of ${total} ranked"><span>${done} of ${total} ranked</span><span class="progress-bar"><i style="transform:scaleX(${total ? done / total : 0})"></i></span></div>`;
  }
  topbar.innerHTML = `
    ${LOCKUP_HTML}
    <div class="title-wrap">
      <h1 ${OWNER ? `contenteditable="plaintext-only" spellcheck="false" data-edit="title" title="Rename"` : ""}>${esc(c.title)}</h1>
      ${OWNER ? `<p contenteditable="plaintext-only" data-edit="description" data-placeholder="Add a note for raters: what should they judge on?">${esc(c.description)}</p>` : c.description ? `<p title="${esc(c.description)}">${esc(c.description)}</p>` : ""}
    </div>
    <div class="topbar-actions">
      ${progress}
      ${OWNER ? `<button class="btn hide-sm" data-act="add-files">Add files</button><button class="btn primary" data-act="share">Share</button>` : ""}
      <button class="btn ghost hide-sm" data-act="agent" title="Using an AI agent">Agent</button>
      <button class="btn ghost" data-act="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
    </div>`;
}

function chip(view, name, meta, dot = "") {
  return `<button class="chip" data-view="${esc(view)}" aria-pressed="${state.viewing === view}">${dot ? `<span class="dot ${dot}"></span>` : ""}${esc(name)}${meta ? ` <small>${esc(meta)}</small>` : ""}</button>`;
}

function renderPeople() {
  const total = items().length;
  const dot = (n) => (n === 0 ? "none" : n < total ? "partial" : "done");
  const parts = [];
  const others = OWNER ? state.data.raters : state.data.raters.filter((r) => r.id !== me().id);
  if (OWNER) {
    parts.push(`<span class="label">Viewing</span>`, chip("everyone", "Everyone", "average"));
    if (others.length) parts.push(`<span class="sep"></span>`);
    else parts.push(`<span class="label">No one has been invited yet.</span>`);
  } else {
    parts.push(`<span class="label">Viewing</span>`, chip(me().id, "You", `${rankedCount(me().id)}/${total}`, dot(rankedCount(me().id))));
    if (others.length) parts.push(`<span class="sep"></span>`);
  }
  for (const r of others) {
    const n = rankedCount(r.id);
    parts.push(chip(r.id, r.name, `${n}/${total}`, dot(n)));
  }
  if (!OWNER && others.length) parts.push(`<span class="sep"></span>`, chip("everyone", "Everyone", "average"));
  parts.push(`<span class="spacer"></span>`);
  if (state.viewing === "everyone" && total) {
    parts.push(`<button class="chip" data-act="table" aria-pressed="${state.table}">Table</button>`);
  }
  if (OWNER && state.data.raters.length) parts.push(`<a class="chip" href="${API}/results.csv" download>Export CSV</a>`);
  peoplebar.hidden = !OWNER && !others.length;
  peoplebar.innerHTML = parts.join("");
}

function noticeHtml() {
  if (OWNER && !state.data.raters.length) {
    return `<div class="notice"><span><strong>No rankings yet.</strong> Make a personal link for each person, or share one open link anyone can join.</span><button class="btn primary small" data-act="share">Share</button></div>`;
  }
  if (state.viewing === "everyone") {
    const n = state.data.raters.filter((r) => rankedCount(r.id) > 0).length;
    return `<div class="notice"><span><strong>Everyone's average</strong> across ${plural(n, "person", "people")}. Each card sits in the tier nearest its average score.</span></div>`;
  }
  if (!editable()) {
    const r = state.data.raters.find((x) => x.id === state.viewing);
    const back = OWNER ? `<button class="btn small" data-copy="${esc(r.url)}">Copy ${esc(r.name)}'s link</button>` : `<button class="btn small" data-view="${me().id}">Back to yours</button>`;
    return `<div class="notice"><span>Viewing <strong>${esc(r.name)}</strong>'s ranking (${rankedCount(r.id)} of ${items().length} ranked). Read-only.</span>${back}</div>`;
  }
  return "";
}

function cardHtml(id, extra) {
  const it = byId.get(id);
  const classes = ["card"];
  if (it.kind === "image") classes.push("is-image");
  if (state.selected === id) classes.push("selected");
  let votes = "";
  let avg = "";
  if (extra) {
    const tiers = Object.values(extra.ratings).sort((a, b) => POINTS[b] - POINTS[a]);
    if (tiers.length) {
      classes.push("with-votes");
      const shown = tiers.slice(0, 7).map((t) => `<i style="background:${COLOR[t]}">${t}</i>`).join("");
      votes = `<span class="votes">${shown}${tiers.length > 7 ? `+${tiers.length - 7}` : ""}</span>`;
      avg = `<span class="avg" title="Average score">${fmtAvg(extra.avg)}</span>`;
    }
  }
  const img = it.kind === "image" ? `<img src="${fileUrl(it)}" alt="" loading="lazy" draggable="false">` : "";
  const snip = it.kind !== "image" && it.snippet ? `<span class="snip">${esc(it.snippet)}</span>` : "";
  return `<div class="${classes.join(" ")}" data-id="${id}" role="button" tabindex="-1" aria-label="#${it.n} ${esc(it.title)}" title="${esc(it.title)}">${img}<span class="num">#${it.n}</span><span class="kind">${KIND_LABEL[it.kind] || ""}</span><span class="title">${esc(it.title)}</span>${snip}${votes}${avg}</div>`;
}

function renderBoard() {
  for (const s of sortables) s.destroy();
  sortables = [];
  if (!items().length) {
    boardScroll.innerHTML = OWNER
      ? `<div class="empty-drop"><h2>Drop files here</h2><p>Blog posts, screenshots, PDFs, HTML pages, anything. Each file becomes a card people drag into tiers.</p><button class="btn primary" data-act="add-files">Choose files</button><p style="font-size:12.5px">Or give your agent this page's link. It can upload files for you (see <a href="/llms.txt" target="_blank">llms.txt</a>).</p></div>`
      : `<div class="empty-drop"><h2>Nothing to rank yet</h2><p>The owner hasn't added anything. This page updates by itself when they do.</p></div>`;
    return;
  }
  if (state.viewing === "everyone" && state.table) {
    boardScroll.innerHTML = noticeHtml() + tableHtml();
    return;
  }
  const { lists, extra } = currentView();
  const edit = editable();
  let html = noticeHtml();
  html += `<div class="board${edit ? "" : " readonly"}">`;
  for (const t of TIERS) {
    html += `<div class="tier-row" data-tier="${t.id}" style="--tier:${t.color}">
      <div class="tier-label"><span class="letter">${t.id}</span><span class="pts">${t.points} pt${Math.abs(t.points) === 1 ? "" : "s"}</span></div>
      <div class="tier-drop" data-tier="${t.id}">${lists[t.id].map((id) => cardHtml(id, extra?.get(id))).join("")}</div>
    </div>`;
  }
  html += `</div>`;
  const left = lists[UNSORTED].length;
  const hint = edit
    ? `Click a card to read it, then press <kbd>S</kbd> <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> <kbd>F</kbd> or drag it`
    : state.viewing === "everyone" ? "" : "Read-only";
  html += `<section class="pool${left ? "" : " empty"}">
    <div class="pool-head"><h2>${state.viewing === "everyone" ? "Not ranked yet" : "Unsorted"}</h2><span class="count">${left}</span><span class="hint">${hint}</span></div>
    <div class="tier-drop" data-tier="${UNSORTED}">${lists[UNSORTED].map((id) => cardHtml(id, extra?.get(id))).join("")}</div>
    ${edit && !left ? `<div class="pool-done">All ${items().length} ranked. Drag cards any time to change your mind.</div>` : ""}
  </section>`;
  boardScroll.innerHTML = html;
  if (edit) makeSortable();
}

function tableHtml() {
  const res = results();
  const raters = state.data.raters;
  const pill = (t) => (t && t !== UNSORTED ? `<span class="tier-pill" style="--tier:${COLOR[t]}">${t}</span>` : `<span class="tier-pill none">–</span>`);
  const rows = res.items
    .map((row) => `<tr>
      <td class="num-cell">${row.rank ?? "–"}</td>
      <td class="title-cell" data-open="${row.id}"><span class="num-cell">#${row.n}</span> ${esc(row.title)}</td>
      <td class="num-cell">${fmtAvg(row.avg)}</td>
      <td>${row.avg === null ? pill() : pill(row.tier)}</td>
      ${raters.map((r) => `<td>${pill(row.ratings[r.id])}</td>`).join("")}
      <td class="num-cell">${row.count}</td>
    </tr>`)
    .join("");
  return `<div class="table-wrap"><table class="results-table">
    <thead><tr><th>Rank</th><th>Item</th><th>Avg</th><th>Tier</th>${raters.map((r) => `<th>${esc(r.name)}</th>`).join("")}<th>Ratings</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function makeSortable() {
  for (const el of boardScroll.querySelectorAll(".tier-drop")) {
    sortables.push(
      Sortable.create(el, {
        group: "tiers",
        animation: 160,
        sort: el.dataset.tier !== UNSORTED,
        delay: 140,
        delayOnTouchOnly: true,
        ghostClass: "card-ghost",
        chosenClass: "card-chosen",
        onStart() {
          state.dragging = true;
        },
        onEnd(evt) {
          state.dragging = false;
          const id = evt.item.dataset.id;
          const tier = evt.to.dataset.tier;
          const position = tier === UNSORTED ? undefined : evt.newDraggableIndex;
          const before = locate(me().id, id);
          const unchanged = before.tier === tier && (tier === UNSORTED || before.position === position);
          // Let Sortable finish its own cleanup before the board is redrawn.
          setTimeout(() => {
            if (!unchanged) place([{ item_id: id, tier, position }], { animate: false });
            else if (state.refreshQueued) refresh();
          }, 0);
        },
      }),
    );
  }
}

function captureRects() {
  const rects = new Map();
  for (const el of boardScroll.querySelectorAll(".card")) rects.set(el.dataset.id, el.getBoundingClientRect());
  return rects;
}

function playFlip(before) {
  if (REDUCED_MOTION) return;
  for (const el of boardScroll.querySelectorAll(".card")) {
    const a = before.get(el.dataset.id);
    if (!a) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}

function flashTier(tier) {
  const row = boardScroll.querySelector(`.tier-row[data-tier="${tier}"]`);
  if (!row || REDUCED_MOTION) return;
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
}

// ---------- selection & reader ----------

function select(id, { open, scroll = true } = {}) {
  state.selected = id;
  if (open !== undefined) state.preview = open;
  for (const el of boardScroll.querySelectorAll(".card.selected")) el.classList.remove("selected");
  const el = id && boardScroll.querySelector(`.card[data-id="${id}"]`);
  if (el) {
    el.classList.add("selected");
    if (scroll) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  renderPreview();
}

function step(delta) {
  const list = items();
  if (!list.length) return;
  const i = list.findIndex((it) => it.id === state.selected);
  const next = i === -1 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
  select(list[next].id);
}

function renderPreview() {
  const it = state.selected && byId.get(state.selected);
  reader.hidden = !(state.preview && it);
  document.body.classList.toggle("reading", !reader.hidden);
  if (reader.hidden) {
    if (previewBodyFor) pBody.innerHTML = "";
    previewBodyFor = null;
    return;
  }
  preview.classList.toggle("fill", it.kind === "html" || it.kind === "pdf");
  // Just the title, the thing itself, and a slim bar to place it.
  if (!(pHead.contains(document.activeElement) && document.activeElement.isContentEditable)) {
    pHead.innerHTML = `
      <h2 ${OWNER ? `contenteditable="plaintext-only" spellcheck="false" data-edit-item="${it.id}" title="Rename"` : ""}>${esc(it.title)}</h2>
      ${OWNER ? `<button class="icon-btn" data-act="remove-item" title="Remove from collection" aria-label="Remove from collection">${TRASH_ICON}</button>` : ""}
      <button class="icon-btn" data-act="close" title="Close (Esc)" aria-label="Close">✕</button>`;
  }
  const placeRow = editable()
    ? `<div class="tier-buttons">${TIERS.map((t) => `<button class="tier-btn" style="--tier:${t.color}" data-place="${t.id}" aria-pressed="${locate(me().id, it.id).tier === t.id}" title="${t.id} (${t.points} pts) · press ${t.id} or ${t.points === -1 ? "−" : t.points}">${t.id}</button>`).join("")}</div>`
    : `<div class="ratings-line">${ratingsLine(it)}</div>`;
  pBar.innerHTML = `${placeRow}
    <div class="preview-nav">
      <button class="icon-btn" data-act="prev" title="Previous (←)" aria-label="Previous">‹</button>
      <button class="icon-btn" data-act="next" title="Next (→)" aria-label="Next">›</button>
    </div>`;
  if (previewBodyFor !== it.id) {
    previewBodyFor = it.id;
    renderPreviewBody(it);
  }
}

function ratingsLine(it) {
  const pill = (t) => `<span class="tier-pill" style="--tier:${COLOR[t]}">${t}</span>`;
  if (state.viewing !== "everyone") {
    const t = locate(state.viewing, it.id).tier;
    const who = OWNER || state.viewing !== me().id ? raterName(state.viewing) : "You";
    return t === UNSORTED ? `${esc(who)} hasn't placed this yet.` : `${esc(who)} put this in ${pill(t)}`;
  }
  const row = results().items.find((r) => r.id === it.id);
  if (!row || !row.count) return "No one has placed this yet.";
  const people = Object.entries(row.ratings)
    .sort((a, b) => POINTS[b[1]] - POINTS[a[1]])
    .map(([rid, t]) => `<span class="who">${pill(t)} ${esc(raterName(rid))}</span>`)
    .join("");
  return `<span>Average <strong style="color:var(--ink)">${fmtAvg(row.avg)}</strong> (${row.tier})</span>${people}`;
}

async function renderPreviewBody(it) {
  pBody.scrollTop = 0;
  const url = fileUrl(it);
  switch (it.kind) {
    case "markdown":
    case "text": {
      pBody.innerHTML = `<div class="doc" style="color:var(--muted)">Loading…</div>`;
      let text = "";
      try {
        const res = await fetch(url);
        text = await res.text();
      } catch {
        text = "Couldn't load this file.";
      }
      if (previewBodyFor !== it.id) return;
      if (it.kind === "markdown" && window.marked && window.DOMPurify) {
        let md = text.replace(/^---\n[\s\S]*?\n---\n/, "");
        // The title is already at the top of the reader; don't repeat it.
        const h1 = /^\s*#\s+(.+?)\s*#*\s*(\n|$)/.exec(md);
        if (h1 && h1[1].trim() === it.title.trim()) md = md.slice(h1[0].length);
        pBody.innerHTML = `<article class="doc">${DOMPurify.sanitize(marked.parse(md))}</article>`;
      } else {
        pBody.innerHTML = `<pre class="plain">${esc(text)}</pre>`;
      }
      break;
    }
    case "html":
      pBody.innerHTML = `<iframe sandbox="allow-scripts allow-popups allow-forms" src="${url}" title="${esc(it.title)}"></iframe>`;
      break;
    case "pdf":
      pBody.innerHTML = `<iframe src="${url}" title="${esc(it.title)}"></iframe>`;
      break;
    case "image":
      pBody.innerHTML = `<div class="media"><img src="${url}" alt="${esc(it.title)}"></div>`;
      break;
    case "video":
      pBody.innerHTML = `<div class="media"><video src="${url}" controls preload="metadata"></video></div>`;
      break;
    case "audio":
      pBody.innerHTML = `<div class="media"><audio src="${url}" controls preload="metadata"></audio></div>`;
      break;
    case "link":
      pBody.innerHTML = `<div class="fileinfo"><p style="word-break:break-all">${esc(it.link_url)}</p><a class="btn primary" href="${esc(it.link_url)}" target="_blank" rel="noopener noreferrer">Open link ↗</a></div>`;
      break;
    default:
      pBody.innerHTML = `<div class="fileinfo"><p>This file type doesn't preview in the browser.</p><a class="btn primary" href="${url}?download">Download it</a></div>`;
  }
}

if (window.DOMPurify) {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

// ---------- view switching ----------

function setViewing(view) {
  state.viewing = view;
  if (view !== "everyone") state.table = false;
  render();
}

// ---------- owner actions ----------

async function saveEdit(el) {
  const value = el.textContent.trim();
  try {
    if (el.dataset.edit) {
      const field = el.dataset.edit;
      if (field === "title" && !value) return renderTopbar();
      if (value === (state.data.collection[field] || "")) return;
      await api("", { method: "PATCH", json: { [field]: value } });
    } else if (el.dataset.editItem) {
      const it = byId.get(el.dataset.editItem);
      if (!value || value === it.title) return (el.textContent = it.title);
      await api(`/items/${it.id}`, { method: "PATCH", json: { title: value } });
    }
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

function pickFiles() {
  const input = Object.assign(document.createElement("input"), { type: "file", multiple: true });
  input.onchange = () => uploadFiles(input.files);
  input.click();
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const queue = files.slice();
  const failed = [];
  let done = 0;
  const progress = () => toast(`Uploading ${done} of ${files.length}…`, { sticky: true });
  progress();
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      const fd = new FormData();
      fd.append("file", f, f.name);
      try {
        await api("/items", { method: "POST", body: fd });
      } catch (err) {
        failed.push(`${f.name}: ${err.message}`);
      }
      done++;
      progress();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await refresh();
  const ok = files.length - failed.length;
  toast(failed.length ? `Added ${ok}. ${failed.length} failed (${failed[0]})` : `Added ${plural(ok, "file")}`);
}

async function removeItem(id) {
  const it = byId.get(id);
  if (!confirm(`Remove "${it.title}" from the collection? Everyone's placement of it is removed too.`)) return;
  try {
    await api(`/items/${id}`, { method: "DELETE" });
    state.preview = false;
    state.selected = null;
    await refresh();
    toast("Removed");
  } catch (err) {
    toast(err.message);
  }
}

// ---------- dialogs ----------

function openDialog(title, bodyHtml, onMount) {
  document.querySelector("dialog")?.remove();
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div><div class="dlg-body">${bodyHtml}</div>`;
  document.body.append(dlg);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
    const c = e.target.closest("[data-copy]");
    if (c) copy(c.dataset.copy, c.dataset.copyLabel || "Link copied");
  });
  dlg.addEventListener("close", () => dlg.remove());
  onMount?.(dlg);
  dlg.showModal();
  return dlg;
}

const copyRow = (value, label = "Copy") =>
  `<div class="copy-row"><input class="input" readonly data-select value="${esc(value)}"><button class="btn" data-copy="${esc(value)}">${label}</button></div>`;

function peopleListHtml() {
  const total = items().length;
  if (!state.data.raters.length) return `<p style="margin:8px 0 0">No one yet.</p>`;
  return `<div class="people-list">${state.data.raters
    .map((r) => `<div class="person-row">
      <span class="name">${esc(r.name)}<small>${rankedCount(r.id)}/${total} ranked</small></span>
      <button class="btn small" data-copy="${esc(r.url)}" data-copy-label="${esc(r.name)}'s link copied">Copy link</button>
      <a class="btn small ghost" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>
      <button class="icon-btn" data-remove-rater="${r.id}" title="Remove ${esc(r.name)} and their ranking" aria-label="Remove">✕</button>
    </div>`)
    .join("")}</div>`;
}

function openShare() {
  const { links, collection } = state.data;
  const dlg = openDialog(
    "Share",
    `<section class="dlg-section">
      <h3>Personal links</h3>
      <p>One link per person. Each gets their own ranking, and you can see each one's here.</p>
      <form class="copy-row" data-form="add-people">
        <input class="input" name="names" placeholder="Names, separated by commas" autocomplete="off" style="font-family:var(--sans);color:var(--ink)">
        <button class="btn primary">Make links</button>
      </form>
      <div data-people>${peopleListHtml()}</div>
      ${state.data.raters.length > 1 ? `<button class="btn small ghost" data-act="copy-all" style="margin-top:8px">Copy all links as a list</button>` : ""}
    </section>
    <section class="dlg-section">
      <h3>Open link</h3>
      <p>Anyone with this link types their name and gets their own personal link.</p>
      ${copyRow(links.join_url)}
    </section>
    <section class="dlg-section">
      <label class="toggle"><input type="checkbox" data-toggle="show_others" ${collection.show_others ? "checked" : ""}> People can see each other's rankings</label>
    </section>
    <section class="dlg-section">
      <h3>Owner link</h3>
      <p>This page. Whoever has it can add files, make links and see everyone's rankings, so keep it private.</p>
      ${copyRow(links.owner_url)}
    </section>`,
    (d) => {
      d.querySelector('[data-form="add-people"]').addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = e.target.names;
        const names = input.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        if (!names.length) return input.focus();
        try {
          const { raters } = await api("/raters", { method: "POST", json: { names } });
          input.value = "";
          await refresh();
          d.querySelector("[data-people]").innerHTML = peopleListHtml();
          if (raters.length === 1) copy(raters[0].url, `${raters[0].name}'s link copied`);
          else toast(`Made ${raters.length} links`);
        } catch (err) {
          toast(err.message);
        }
      });
      d.addEventListener("click", async (e) => {
        const rm = e.target.closest("[data-remove-rater]");
        if (rm) {
          const name = raterName(rm.dataset.removeRater);
          if (!confirm(`Remove ${name}? Their link stops working and their ranking is deleted.`)) return;
          await api(`/raters/${rm.dataset.removeRater}`, { method: "DELETE" }).catch((err) => toast(err.message));
          await refresh();
          d.querySelector("[data-people]").innerHTML = peopleListHtml();
        }
        if (e.target.closest('[data-act="copy-all"]')) {
          copy(state.data.raters.map((r) => `${r.name}: ${r.url}`).join("\n"), "All links copied");
        }
      });
      d.querySelector('[data-toggle="show_others"]').addEventListener("change", async (e) => {
        await api("", { method: "PATCH", json: { show_others: e.target.checked } }).catch((err) => toast(err.message));
        refresh();
      });
    },
  );
  setTimeout(() => dlg.querySelector("input[name=names]")?.focus(), 30);
}

function openAgent() {
  const origin = location.origin;
  if (OWNER) {
    const { links } = state.data;
    openDialog(
      "Use it with your agent",
      `<section class="dlg-section agent-box">
        <p>Paste this page's link to your agent. It can add files, make a personal link for each person, DM them their links, and pull everyone's results. The link controls the collection, so only give it to agents you trust.</p>
        ${copyRow(links.owner_url)}
      </section>
      <section class="dlg-section agent-box">
        <h3>Try asking</h3>
        <pre>Here's a tiergrader collection: ${esc(links.owner_url)}
Make personal links for Kieran and Dan, DM each of them theirs on Slack with a one-line note on what to judge, and tell me when they've both finished.</pre>
      </section>
      <section class="dlg-section agent-box">
        <h3>For agent builders</h3>
        <p>REST API and workflow: <a href="/llms.txt" target="_blank">${esc(origin)}/llms.txt</a>. MCP server: <code>${esc(origin)}/mcp</code>. With this page open, browser agents get WebMCP tools (<code>tiergrader_get_board</code>, <code>tiergrader_get_results</code>, <code>tiergrader_create_links</code>, <code>tiergrader_add_text_items</code>…), also on <code>window.tiergrader</code>.</p>
      </section>`,
    );
  } else {
    openDialog(
      "Rank with your agent",
      `<section class="dlg-section agent-box">
        <p>If your browser agent supports WebMCP, or can run JavaScript on this page, it can read each item and move the cards for you. You can still drag anything afterwards.</p>
        <pre>Read every item on this tiergrader page and sort them into S–F tiers by how clearly each one explains its idea. Tell me why for the S and F ones.</pre>
      </section>
      <section class="dlg-section agent-box">
        <h3>Tools on this page</h3>
        <p><code>tiergrader_get_board</code>, <code>tiergrader_read_item</code>, <code>tiergrader_place_items</code>, <code>tiergrader_view</code>, <code>tiergrader_get_results</code>. The same functions are on <code>window.tiergrader</code>. Full reference: <a href="/llms.txt" target="_blank">${esc(origin)}/llms.txt</a>.</p>
      </section>`,
    );
  }
}

function openHelp() {
  openDialog(
    "Keyboard shortcuts",
    `<dl class="shortcuts">
      <dt><kbd>S</kbd> <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> <kbd>F</kbd></dt><dd>Put the selected card in that tier (holding <kbd>⌥</kbd> works too)</dd>
      <dt><kbd>4</kbd> <kbd>3</kbd> <kbd>2</kbd> <kbd>1</kbd> <kbd>0</kbd> <kbd>−</kbd></dt><dd>Same, by points: S 4 · A 3 · B 2 · C 1 · D 0 · F −1</dd>
      <dt><kbd>U</kbd> or <kbd>⌫</kbd></dt><dd>Back to unsorted</dd>
      <dt><kbd>←</kbd> <kbd>→</kbd> or <kbd>J</kbd> <kbd>K</kbd></dt><dd>Previous / next card</dd>
      <dt><kbd>Enter</kbd></dt><dd>Open or close the reader</dd>
      <dt><kbd>Space</kbd></dt><dd>Scroll the reader</dd>
      <dt><kbd>⌘</kbd> <kbd>Z</kbd></dt><dd>Undo</dd>
      <dt><kbd>Esc</kbd></dt><dd>Close the reader</dd>
    </dl>
    <p style="margin:0;color:var(--muted);font-size:12.5px">After you place a card, the next unsorted one is selected, so you can read, press a key, read, press a key.</p>`,
  );
}

// ---------- events ----------

app.addEventListener("click", (e) => {
  const t = e.target;
  const card = t.closest(".card");
  if (card) return select(card.dataset.id, { open: true, scroll: false });
  const open = t.closest("[data-open]");
  if (open) return select(open.dataset.open, { open: true, scroll: false });
  const view = t.closest("[data-view]");
  if (view) return setViewing(view.dataset.view);
  const placeBtn = t.closest("[data-place]");
  if (placeBtn && state.selected) {
    const wasUnsorted = locate(me().id, state.selected).tier === UNSORTED;
    return place([{ item_id: state.selected, tier: placeBtn.dataset.place }], { advanceFrom: wasUnsorted ? state.selected : null });
  }
  const copyBtn = t.closest("[data-copy]");
  if (copyBtn) return copy(copyBtn.dataset.copy, "Link copied");
  const act = t.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "share") openShare();
  else if (act === "agent") openAgent();
  else if (act === "help") openHelp();
  else if (act === "add-files") pickFiles();
  else if (act === "table") {
    state.table = !state.table;
    render();
  } else if (act === "prev") step(-1);
  else if (act === "next") step(1);
  else if (act === "close") select(state.selected, { open: false });
  else if (act === "remove-item") removeItem(state.selected);
});

// Read-only fields (links) select themselves on focus; inline handlers are blocked by the page's CSP.
document.addEventListener("focusin", (e) => e.target.matches?.("[data-select]") && e.target.select());

app.addEventListener("focusout", (e) => {
  if (e.target.isContentEditable) saveEdit(e.target);
});

const KEY_TIERS = { s: "S", a: "A", b: "B", c: "C", d: "D", f: "F", 4: "S", 3: "A", 2: "B", 1: "C", 0: "D", "-": "F", "−": "F", u: UNSORTED };
const CODE_KEYS = { Minus: "-", NumpadSubtract: "-" };

function keyName(e) {
  // With ⌥ held, macOS turns letters into symbols (⌥S = ß), so read the physical key instead.
  if (e.altKey) {
    const m = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d))$/.exec(e.code);
    if (m) return (m[1] || m[2] || m[3]).toLowerCase();
    return CODE_KEYS[e.code] ?? e.key;
  }
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

document.addEventListener("keydown", (e) => {
  if (!state.data) return;
  const el = document.activeElement;
  if (el?.isContentEditable) {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    }
    if (e.key === "Escape") {
      el.textContent = el.dataset.editItem ? byId.get(el.dataset.editItem)?.title : state.data.collection[el.dataset.edit] || "";
      el.blur();
    }
    return;
  }
  if (document.querySelector("dialog[open]") || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName)) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    return undo();
  }
  if (e.metaKey || e.ctrlKey) return;
  const key = keyName(e);
  // Enter and Space belong to whichever button or link has focus.
  if ((key === "Enter" || key === " ") && el?.closest?.("button, a, summary, iframe")) return;

  if (key === "?") return openHelp();
  if (key === "Escape") {
    if (state.preview) select(state.selected, { open: false, scroll: false });
    else select(null);
    return;
  }
  if (key === "ArrowRight" || key === "j") {
    e.preventDefault();
    return step(1);
  }
  if (key === "ArrowLeft" || key === "k") {
    e.preventDefault();
    return step(-1);
  }
  if (key === "Enter") {
    e.preventDefault();
    if (!state.selected) return firstSelection();
    return select(state.selected, { open: !state.preview });
  }
  if (key === " ") {
    e.preventDefault();
    if (state.preview) return pBody.scrollBy({ top: (e.shiftKey ? -0.8 : 0.8) * pBody.clientHeight, behavior: REDUCED_MOTION ? "auto" : "smooth" });
    if (!state.selected) return firstSelection();
    return select(state.selected, { open: true });
  }
  const tier = key === "Backspace" || key === "Delete" ? UNSORTED : KEY_TIERS[key];
  if (!tier) return;
  e.preventDefault();
  if (!editable()) {
    if (OWNER) return toast("This is the owner view. To rank too, make yourself a personal link under Share.");
    return toast(`You're viewing ${state.viewing === "everyone" ? "everyone's average" : `${raterName(state.viewing)}'s ranking`}.`, {
      action: "Back to yours",
      onAction: () => setViewing(me().id),
    });
  }
  if (!state.selected) return firstSelection();
  const wasUnsorted = locate(me().id, state.selected).tier === UNSORTED;
  place([{ item_id: state.selected, tier }], { advanceFrom: wasUnsorted && tier !== UNSORTED ? state.selected : null });
});

function firstSelection() {
  const first = (!OWNER && nextUnsorted(null)) || items()[0]?.id;
  if (first) select(first, { open: true });
}

// Owners can drop files anywhere on the page.
if (OWNER) {
  let overlay = null;
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    if (!overlay) {
      overlay = Object.assign(document.createElement("div"), { className: "drop-overlay", textContent: "Drop to add to this collection" });
      document.body.append(overlay);
    }
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) {
      depth = 0;
      overlay?.remove();
      overlay = null;
    }
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay?.remove();
    overlay = null;
    uploadFiles(e.dataTransfer.files);
  });
}

// ---------- the page as an agent sees it (WebMCP and window.tiergrader) ----------

function resolveItem(ref) {
  const s = String(ref ?? "").trim().replace(/^#/, "");
  const list = items();
  return (
    list.find((it) => it.id === s) ||
    list.find((it) => String(it.n) === s) ||
    list.find((it) => it.title.toLowerCase() === s.toLowerCase()) ||
    null
  );
}

function resolveView(person) {
  const p = String(person ?? "").trim().toLowerCase();
  if (["everyone", "average", "all", "consensus"].includes(p)) return "everyone";
  if (!OWNER && ["me", "you", "mine", "my", "self", me().name.toLowerCase()].includes(p)) return me().id;
  const r = state.data.raters.find((x) => x.id === person || x.name.toLowerCase() === p) || state.data.raters.find((x) => x.name.toLowerCase().startsWith(p));
  return r?.id ?? null;
}

const brief = (id) => {
  const it = byId.get(id);
  return { id: it.id, n: it.n, title: it.title, kind: it.kind };
};

const controller = {
  role: boot.role,
  getBoard() {
    const { lists, extra } = currentView();
    const viewing = state.viewing === "everyone" ? "everyone (average)" : OWNER || state.viewing !== me().id ? raterName(state.viewing) : `you (${me().name})`;
    return {
      collection: { title: state.data.collection.title, description: state.data.collection.description },
      page: OWNER ? "owner page (sees everyone's rankings; boards are read-only here)" : `${me().name}'s personal ranking page`,
      viewing,
      editable: editable(),
      scoring: POINTS,
      tiers: Object.fromEntries(TIER_IDS.map((t) => [t, lists[t].map((id) => (extra ? { ...brief(id), average: extra.get(id).avg } : brief(id)))])),
      unsorted: lists[UNSORTED].map(brief),
      people: state.data.raters.map((r) => ({ name: r.name, ranked: rankedCount(r.id), total: items().length })),
    };
  },
  async readItem(ref) {
    const it = resolveItem(ref);
    if (!it) throw new Error(`No item "${ref}". Use an id, a number like 3, or the exact title.`);
    const full = await api(`/items/${it.id}`);
    const text = full.text ?? null;
    return {
      id: it.id,
      n: it.n,
      title: it.title,
      kind: it.kind,
      text: text && text.length > 60000 ? `${text.slice(0, 60000)}\n\n[truncated]` : text,
      file_url: it.kind === "link" ? null : location.origin + fileUrl(it),
      link_url: it.link_url,
      note: text === null ? "No text for this kind of item; open file_url to look at it." : undefined,
    };
  },
  placeItems(placements) {
    if (OWNER) throw new Error("This is the owner page; boards are read-only here. Rankings are made on personal links.");
    if (!Array.isArray(placements) || !placements.length) throw new Error("Give placements: [{ item, tier }].");
    if (state.viewing !== me().id) setViewing(me().id);
    const moves = placements.map((p) => {
      const it = resolveItem(p.item ?? p.item_id ?? p.id);
      if (!it) throw new Error(`No item "${p.item ?? p.item_id}".`);
      const tier = normalizeTier(p.tier);
      if (!tier) throw new Error(`Unknown tier "${p.tier}". Use S, A, B, C, D, F or unsorted.`);
      return { item_id: it.id, tier, position: Number.isInteger(p.position) ? p.position : undefined };
    });
    place(moves);
    return controller.getBoard();
  },
  view(person) {
    const v = resolveView(person);
    if (!v) throw new Error(`No one called "${person}" here. People: ${state.data.raters.map((r) => r.name).join(", ") || "none yet"}.`);
    if (!OWNER && v === "everyone" && !state.data.raters.some((r) => r.id !== me().id)) throw new Error("Other people's rankings aren't visible on this page.");
    setViewing(v);
    return controller.getBoard();
  },
  getResults() {
    const res = results();
    return {
      scoring: POINTS,
      items: res.items.map((r) => ({
        rank: r.rank,
        n: r.n,
        id: r.id,
        title: r.title,
        average: r.avg,
        ratings_count: r.count,
        consensus_tier: r.tier,
        ratings: Object.fromEntries(Object.entries(r.ratings).map(([rid, t]) => [raterName(rid), t])),
      })),
      people: res.raters.map((r) => ({ name: r.name, ranked: r.ranked, total: r.total })),
    };
  },
  async createLinks(names) {
    if (!OWNER) throw new Error("Only the owner page can make links.");
    const { raters } = await api("/raters", { method: "POST", json: { names } });
    await refresh();
    return raters.map((r) => ({ name: r.name, url: r.url }));
  },
  async addTextItems(list) {
    if (!OWNER) throw new Error("Only the owner page can add items.");
    const { added } = await api("/items", { method: "POST", json: { items: list } });
    await refresh();
    return added.map((it) => ({ id: it.id, n: it.n, title: it.title }));
  },
};

// ---------- start ----------

(async () => {
  try {
    applyData(await api(""));
  } catch (err) {
    if (err.status === 404) return gone();
    app.innerHTML = `<main class="notfound"><h1>Couldn't load</h1><p>${esc(err.message)}</p></main>`;
    return;
  }
  app.removeAttribute("aria-busy");
  const c = state.data.collection;
  const url = location.origin + location.pathname;
  if (OWNER) remember("tg.owned", { url, title: c.title, at: Date.now() });
  else remember("tg.rated", { url, title: c.title, name: me().name, at: Date.now() });
  connectEvents();
  registerAgentTools(controller);
})();
