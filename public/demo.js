// The landing page's moving picture, acting out the three example tier grades: cards fly in, a cursor
// drags and keys them into tiers, the board flips between You, Dan, Kate and Everyone, then "+ New"
// starts the next one. Loops; stills itself for reduced motion and pauses while the tab is hidden.
import { TIERS, computeResults } from "./shared.js";
import { EXAMPLES } from "./examples.js";

const ROWS = [...TIERS.map((t) => t.id), "tray"];
const PEOPLE = ["You", "Dan", "Kate"];
const KEY_FOR = { S: ["S", "4"], A: ["A", "3"], B: ["B", "2"], C: ["C", "1"], D: ["D", "0"], F: ["F", "−"] };
const empty = () => Object.fromEntries(ROWS.map((r) => [r, []]));

const CURSOR = `<svg viewBox="0 0 18 22" width="18" height="22" aria-hidden="true"><path d="M1 1v17l4.6-4.3 3 6.8 3.2-1.4-3-6.6H15z" fill="#121212" stroke="#fdfaf7" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const DARK = new Set(["#5b3be8", "#121212", "#1a2ee1"]);

// Each example becomes a scene: its cards, and each person's board (item ids per tier).
const SCENES = EXAMPLES.map((ex) => {
  const items = ex.items.map((it, i) => ({ id: `${ex.slug}-${i}`, label: it.title, svg: it.svg, accent: it.accent }));
  const boardOf = (grades) => {
    const b = empty();
    grades.forEach((t, i) => b[t].push(items[i].id));
    return b;
  };
  const boards = Object.fromEntries(PEOPLE.map((p) => [p, boardOf(ex.grades[p])]));
  const raters = PEOPLE.map((p) => ({ id: p, name: p }));
  const placements = PEOPLE.flatMap((p) => ex.grades[p].map((tier, i) => ({ rater_id: p, item_id: items[i].id, tier })));
  const everyone = empty();
  for (const row of computeResults(items.map((it, i) => ({ id: it.id, n: i + 1, title: it.label })), raters, placements).items) everyone[row.tier].push(row.id);
  boards.Everyone = everyone;
  return { title: ex.title, items, grades: ex.grades.You, boards };
});

function cardInner(it) {
  if (it.svg) return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(it.svg)}" alt="">`;
  if (it.accent) return `<i class="bars${DARK.has(it.accent) ? " light" : ""}"></i><span>${it.label}</span>`;
  return `<span>${it.label}</span>`;
}

export function startDemo(root) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.innerHTML = `
    <div class="demo-head"><span class="demo-title"></span><span class="demo-new">+ New</span></div>
    <div class="demo-people">${[...PEOPLE, "Everyone"].map((p) => `<span class="demo-chip${p === "You" ? " on" : ""}" data-person="${p}">${p}</span>`).join("")}</div>
    <div class="demo-board">
      ${TIERS.map((t) => `<div class="demo-row" data-row="${t.id}" style="--tier:${t.color}"><b>${t.id}</b><span class="demo-lane"></span></div>`).join("")}
    </div>
    <div class="demo-tray-label">Unranked</div>
    <div class="demo-tray" data-row="tray"><span class="demo-lane"></span></div>
    <div class="demo-cursor">${CURSOR}</div>`;

  const titleEl = root.querySelector(".demo-title");
  const cursor = root.querySelector(".demo-cursor");
  const maxItems = Math.max(...SCENES.map((s) => s.items.length));
  const CH = 30;
  const GAP = 5;
  let CW = 54; // shrinks on narrow screens so a whole scene fits in the tray
  let state = empty();
  let lanes = {};
  let cards = new Map();

  function measure() {
    const box = root.getBoundingClientRect();
    const trayWidth = root.querySelector(".demo-tray").getBoundingClientRect().width;
    CW = Math.max(34, Math.min(54, Math.floor((trayWidth - 12 - GAP * (maxItems - 1)) / maxItems)));
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
  const layout = (ms, except) => {
    for (const row of ROWS) state[row].forEach((id, i) => id !== except && put(cards.get(id), slot(row, i), { ms }));
  };
  const where = (id) => {
    for (const row of ROWS) {
      const i = state[row].indexOf(id);
      if (i !== -1) return [row, i];
    }
    return ["tray", 0];
  };
  function move(id, row, index) {
    for (const r of ROWS) state[r] = state[r].filter((x) => x !== id);
    state[row].splice(index ?? state[row].length, 0, id);
    return slot(row, state[row].indexOf(id));
  }

  const wait = async (ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end || document.hidden) await new Promise((r) => setTimeout(r, document.hidden ? 300 : Math.min(60, end - performance.now())));
  };
  const centerOf = (p) => ({ x: p.x + CW / 2, y: p.y + CH / 2 });
  const centerOfEl = (el) => {
    const box = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
  };
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
    const el = cards.get(id);
    const from = slot(...where(id));
    await cursorTo(centerOf(from), 600);
    await click();
    el.classList.add("lift");
    put(el, from, { ms: 150, scale: 1.08 });
    await wait(150);
    const to = move(id, row, index);
    layout(450, id);
    put(el, to, { ms: 650, scale: 1.08, rot: -2 });
    await cursorTo(centerOf(to), 650);
    el.classList.remove("lift");
    put(el, to, { ms: 180 });
    flash(row);
    await wait(300);
  }

  async function key(id, k, row) {
    const el = cards.get(id);
    el.classList.add("sel");
    await wait(380);
    const at = slot(...where(id));
    const cap = document.createElement("kbd");
    cap.className = "demo-key";
    cap.textContent = k;
    cap.style.left = `${at.x + CW / 2 - 13}px`;
    cap.style.top = `${at.y - 30}px`;
    root.append(cap);
    setTimeout(() => cap.remove(), 900);
    await wait(340);
    el.classList.remove("sel");
    move(id, row);
    layout(550);
    flash(row);
    await wait(600);
  }

  async function show(scene, person) {
    const chip = root.querySelector(`[data-person="${person}"]`);
    await cursorTo(centerOfEl(chip), 650);
    await click();
    for (const c of root.querySelectorAll(".demo-chip")) c.classList.toggle("on", c === chip);
    state = structuredClone(scene.boards[person]);
    layout(750);
    await wait(1500);
  }

  // Swap in a scene's cards: the old ones fly off, the new ones fly into Unranked like an upload.
  async function load(scene) {
    for (const el of cards.values()) el.remove();
    cards = new Map();
    titleEl.textContent = scene.title;
    for (const c of root.querySelectorAll(".demo-chip")) c.classList.toggle("on", c.dataset.person === "You");
    const box = root.getBoundingClientRect();
    state = empty();
    scene.items.forEach((it, i) => {
      const el = document.createElement("div");
      el.className = `demo-card${it.svg ? " logo" : it.accent ? " page" : ""}`;
      if (it.accent) el.style.setProperty("--art", it.accent);
      el.innerHTML = cardInner(it);
      root.insertBefore(el, cursor);
      cards.set(it.id, el);
      put(el, { x: box.width + 40 + i * 30, y: -60 + (i % 3) * 50 }, { rot: 20 - i * 6, fade: 0 });
    });
    await wait(60);
    scene.items.forEach((it, i) => {
      state.tray.push(it.id);
      put(cards.get(it.id), slot("tray", i), { ms: 850, delay: i * 100, fade: 1 });
    });
    await wait(1300 + scene.items.length * 100);
  }

  async function clear() {
    [...cards.values()].forEach((el, i) => {
      const t = new DOMMatrix(getComputedStyle(el).transform);
      put(el, { x: t.m41 + 30, y: t.m42 - 40 }, { ms: 450, delay: i * 40, scale: 0.8, fade: 0 });
    });
    await wait(700);
  }

  async function newOne(scene) {
    await cursorTo(centerOfEl(root.querySelector(".demo-new")), 700);
    await click();
    await clear();
    await load(scene);
  }

  // Grade a scene into "You"'s board, alternating drags and keypresses.
  async function grade(scene, order) {
    for (const [n, i] of order.entries()) {
      const id = scene.items[i].id;
      const tier = scene.grades[i];
      if (n % 2 === 0) await drag(id, tier);
      else await key(id, KEY_FOR[tier][n % 4 === 1 ? 0 : 1], tier);
    }
  }

  async function loop() {
    const [intros, logos, pages] = SCENES;
    for (;;) {
      measure();
      put(cursor, { x: root.getBoundingClientRect().width - 30, y: 40 }, { fade: 0 });
      await load(intros);
      // Intro D goes to B first, then gets moved up: changing your mind is just another drag.
      await drag(intros.items[0].id, "S");
      await key(intros.items[1].id, "−", "F");
      await key(intros.items[2].id, "4", "S");
      await drag(intros.items[3].id, "B");
      await key(intros.items[5].id, "A", "A");
      await key(intros.items[4].id, "F", "F");
      await drag(intros.items[3].id, "A", 0);
      await wait(500);
      await show(intros, "Dan");
      await show(intros, "Kate");
      await show(intros, "Everyone");
      await show(intros, "You");

      await newOne(logos);
      await grade(logos, [1, 0, 4, 2, 5, 3]);
      await show(logos, "Everyone");

      await newOne(pages);
      await grade(pages, [0, 4, 1, 2, 3]);
      await show(pages, "Everyone");

      await cursorTo({ x: root.getBoundingClientRect().width - 30, y: 40 }, 500);
      put(cursor, { x: root.getBoundingClientRect().width - 30, y: 40 }, { ms: 300, fade: 0 });
      await clear();
    }
  }

  if (reduced) {
    measure();
    (async () => {
      await load(SCENES[0]);
      state = structuredClone(SCENES[0].boards.You);
      layout(0);
      cursor.style.opacity = 0;
    })();
    return;
  }
  addEventListener("resize", () => {
    measure();
    layout(0);
  });
  loop();
}
