// The landing page's moving picture: cards fly into the tray, a cursor drags them into tiers, keys
// place others, one gets reranked, and the board flips between people. Loops; stills itself for
// reduced motion and pauses while the tab is hidden.
import { TIERS } from "./shared.js";

const ITEMS = [
  { id: "a", label: "Post A", kind: "text" },
  { id: "b", label: "Hero v2", kind: "img", art: "linear-gradient(135deg, #9ce5f5, #1a2ee1)" },
  { id: "c", label: "Post C", kind: "text" },
  { id: "d", label: "Deck", kind: "pdf" },
  { id: "e", label: "Post E", kind: "text" },
  { id: "f", label: "Logo B", kind: "img", art: "linear-gradient(135deg, #ffdf7f, #c3311d)" },
  { id: "g", label: "Post G", kind: "text" },
];
const ROWS = [...TIERS.map((t) => t.id), "tray"];
const empty = () => Object.fromEntries(ROWS.map((r) => [r, []]));

// Where things end up for each person, so the board can flip between them.
const BOARDS = {
  you: { S: ["c", "a", "e"], A: ["f"], B: ["b"], C: ["g"], D: [], F: ["d"], tray: [] },
  kieran: { S: ["b", "c"], A: ["a", "g"], B: ["e"], C: ["f"], D: ["d"], F: [], tray: [] },
  everyone: { S: ["c"], A: ["a", "b", "e"], B: ["f", "g"], C: [], D: ["d"], F: [], tray: [] },
};

const CURSOR = `<svg viewBox="0 0 18 22" width="18" height="22" aria-hidden="true"><path d="M1 1v17l4.6-4.3 3 6.8 3.2-1.4-3-6.6H15z" fill="#121212" stroke="#fdfaf7" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

export function startDemo(root) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.innerHTML = `
    <div class="demo-people">
      <span class="demo-chip on" data-person="you">You</span>
      <span class="demo-chip" data-person="kieran">Kieran</span>
      <span class="demo-chip" data-person="everyone">Everyone</span>
    </div>
    <div class="demo-board">
      ${TIERS.map((t) => `<div class="demo-row" data-row="${t.id}" style="--tier:${t.color}"><b>${t.id}</b><span class="demo-lane"></span></div>`).join("")}
    </div>
    <div class="demo-tray-label">Unranked</div>
    <div class="demo-tray" data-row="tray"><span class="demo-lane"></span></div>
    ${ITEMS.map((it) => `<div class="demo-card ${it.kind}" data-id="${it.id}" style="${it.art ? `--art:${it.art}` : ""}"><span>${it.label}</span>${it.kind === "pdf" ? "<i>PDF</i>" : ""}</div>`).join("")}
    <div class="demo-cursor">${CURSOR}</div>`;

  const card = (id) => root.querySelector(`.demo-card[data-id="${id}"]`);
  const cursor = root.querySelector(".demo-cursor");
  let CW = 54; // shrinks on narrow screens so all seven cards fit in the tray
  const CH = 30;
  const GAP = 5;
  let state = empty();
  let lanes = {};

  function measure() {
    const box = root.getBoundingClientRect();
    const trayWidth = root.querySelector(".demo-tray").getBoundingClientRect().width;
    CW = Math.max(34, Math.min(54, Math.floor((trayWidth - 12 - GAP * (ITEMS.length - 1)) / ITEMS.length)));
    root.style.setProperty("--cw", `${CW}px`);
    lanes = {};
    for (const row of ROWS) {
      const lane = root.querySelector(`[data-row="${row}"] .demo-lane`).getBoundingClientRect();
      lanes[row] = { x: lane.left - box.left + 6, y: lane.top - box.top + (lane.height - CH) / 2 };
    }
  }
  const slot = (row, i) => ({ x: lanes[row].x + i * (CW + GAP), y: lanes[row].y });

  function put(el, { x, y }, { ms = 0, delay = 0, rot = 0, scale = 1, fade } = {}) {
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1) ${delay}ms, opacity ${Math.min(ms, 300)}ms ${delay}ms` : "none";
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`;
    if (fade !== undefined) el.style.opacity = fade;
  }

  function layout(ms, except) {
    for (const row of ROWS) state[row].forEach((id, i) => id !== except && put(card(id), slot(row, i), { ms }));
  }

  function move(id, row, index) {
    for (const r of ROWS) state[r] = state[r].filter((x) => x !== id);
    const list = state[row];
    list.splice(index ?? list.length, 0, id);
    return slot(row, state[row].indexOf(id));
  }

  const wait = async (ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end || document.hidden) await new Promise((r) => setTimeout(r, document.hidden ? 300 : Math.min(60, end - performance.now())));
  };
  const centerOf = (p) => ({ x: p.x + CW / 2, y: p.y + CH / 2 });
  const cursorTo = async (p, ms = 600) => {
    put(cursor, p, { ms, fade: 1 });
    await wait(ms);
  };
  const click = async () => {
    cursor.classList.add("down");
    const ring = document.createElement("span");
    ring.className = "demo-ring";
    const t = new DOMMatrix(getComputedStyle(cursor).transform);
    ring.style.left = `${t.m41}px`;
    ring.style.top = `${t.m42}px`;
    root.append(ring);
    setTimeout(() => ring.remove(), 600);
    await wait(160);
    cursor.classList.remove("down");
  };
  const flash = (row) => {
    const el = root.querySelector(`.demo-row[data-row="${row}"]`);
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };

  async function drag(id, row, index) {
    const el = card(id);
    const from = slot(...where(id));
    await cursorTo(centerOf(from), 650);
    await click();
    el.classList.add("lift");
    put(el, from, { ms: 150, scale: 1.08 });
    await wait(150);
    const to = move(id, row, index);
    layout(450, id);
    put(el, to, { ms: 700, scale: 1.08, rot: -2 });
    await cursorTo(centerOf(to), 700);
    el.classList.remove("lift");
    put(el, to, { ms: 180 });
    flash(row);
    await wait(350);
  }

  async function key(id, k, row) {
    const el = card(id);
    el.classList.add("sel");
    await wait(450);
    const at = slot(...where(id));
    const cap = document.createElement("kbd");
    cap.className = "demo-key";
    cap.textContent = k;
    cap.style.left = `${at.x + CW / 2 - 13}px`;
    cap.style.top = `${at.y - 30}px`;
    root.append(cap);
    setTimeout(() => cap.remove(), 900);
    await wait(380);
    el.classList.remove("sel");
    move(id, row);
    layout(600);
    flash(row);
    await wait(700);
  }

  async function show(person) {
    const chip = root.querySelector(`[data-person="${person}"]`);
    const box = root.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    await cursorTo({ x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }, 700);
    await click();
    for (const c of root.querySelectorAll(".demo-chip")) c.classList.toggle("on", c === chip);
    state = structuredClone(BOARDS[person]);
    layout(800);
    await wait(1700);
  }

  function where(id) {
    for (const row of ROWS) {
      const i = state[row].indexOf(id);
      if (i !== -1) return [row, i];
    }
    return ["tray", 0];
  }

  async function loop() {
    for (;;) {
      measure();
      const box = root.getBoundingClientRect();
      // Start offscreen, then fly into the tray one by one.
      state = empty();
      for (const c of root.querySelectorAll(".demo-chip")) c.classList.toggle("on", c.dataset.person === "you");
      ITEMS.forEach((it, i) => put(card(it.id), { x: box.width + 40 + i * 30, y: -60 + (i % 3) * 50 }, { rot: 20 - i * 6, fade: 0 }));
      put(cursor, { x: box.width - 30, y: box.height - 10 }, { fade: 0 });
      await wait(400);
      ITEMS.forEach((it, i) => {
        state.tray.push(it.id);
        put(card(it.id), slot("tray", i), { ms: 900, delay: i * 110, fade: 1 });
      });
      await wait(1700);

      await drag("a", "S");
      await key("c", "A", "A");
      await key("e", "4", "S");
      await drag("b", "B");
      await key("d", "−", "F");
      await drag("f", "A");
      await key("g", "C", "C");
      await wait(300);
      // Change your mind: Post C moves up to the front of S.
      await drag("c", "S", 0);
      await wait(900);

      await show("kieran");
      await show("everyone");
      await show("you");
      await wait(600);

      // Clear the board and go again.
      put(cursor, { x: box.width - 30, y: box.height - 10 }, { ms: 500, fade: 0 });
      ITEMS.forEach((it, i) => {
        const [row, idx] = where(it.id);
        const p = slot(row, idx);
        put(card(it.id), { x: p.x + 30, y: p.y - 40 }, { ms: 500, delay: i * 50, scale: 0.8, fade: 0 });
      });
      await wait(1100);
    }
  }

  if (reduced) {
    measure();
    state = structuredClone(BOARDS.you);
    layout(0);
    cursor.style.opacity = 0;
    return;
  }
  addEventListener("resize", () => {
    measure();
    layout(0);
  });
  loop();
}
