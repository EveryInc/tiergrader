import { LOCKUP_HTML } from "../public/shared.js";

// HTML shells. The board itself is drawn in the browser; the server only adds the boot data and,
// for agents reading the raw page, a plain-text brief of what the link is and how to use it.

// Pinned versions with integrity hashes; the page CSP allows exactly these three files.
export const CDN = {
  sortable: { src: "https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js", integrity: "sha384-HZZ/fukV+9G8gwTNjN7zQDG0Sp7MsZy5DDN6VfY3Be7V9dvQpEpR2jF2HlyFUUjU" },
  marked: { src: "https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js", integrity: "sha384-948ahk4ZmxYVYOc+rxN1H2gM1EJ2Duhp7uHtZ4WSLkV4Vtx5MUqnV+l7u9B+jFv+" },
  purify: { src: "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js", integrity: "sha384-JEyTNhjM6R1ElGoJns4U2Ln4ofPcqzSsynQkmEc/KGy6336qAZl70tDLufbkla+3" },
};

// Every's type, minus what can't ship in an open-source repo: Switzer (Every's body face, free from
// Fontshare's CDN), Geist Mono, and Newsreader standing in for Signifier, which is commercially licensed.
export const FONTS = {
  google: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,300..600&display=swap",
  fontshare: "https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap",
};

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// JSON inside <script type="application/json"> must not be able to close the tag.
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

const ICON = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='10' rx='2' fill='%23ff7f7f'/><rect y='11' width='32' height='10' rx='2' fill='%23ffdf7f'/><rect y='22' width='32' height='10' rx='2' fill='%237fbfff'/></svg>`;

function shell({ title, description = "", body, scripts = [], head = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="data:image/svg+xml,${ICON}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS.google}">
<link rel="stylesheet" href="${FONTS.fontshare}">
<link rel="stylesheet" href="/static/app.css">
${head}
</head>
<body>
${body}
${scripts.map((s) => (typeof s === "object" ? `<script src="${s.src}" integrity="${s.integrity}" crossorigin="anonymous"></script>` : `<script type="module" src="${s}"></script>`)).join("\n")}
</body>
</html>`;
}

const agentBrief = (markdown) =>
  `<details class="agent-brief" id="agent-brief"><summary>Agent brief</summary><pre>${esc(markdown)}</pre></details>`;

// boot: { auth: "every" | "key" | "open", user: { name, email, tier, subscriber } | null }
export function homePage(base, boot) {
  return shell({
    title: "tiergrader",
    description: "Upload files, share a link, and see how everyone tiers them.",
    head: `<link rel="alternate" type="text/markdown" href="/llms.txt">`,
    body: `<main id="home" class="home"></main>
<script id="boot" type="application/json">${safeJson(boot)}</script>
<details class="agent-brief" id="agent-brief"><summary>Agent brief</summary><pre>tiergrader: upload files, make links, have people rank them S/A/B/C/D/F.
Agents: read ${esc(base)}/llms.txt for the API (create a collection, upload files, make personal links, read results).</pre></details>`,
    scripts: ["/static/home.js"],
  });
}

export function boardPage({ title, boot, brief }) {
  return shell({
    title: `${title} · tiergrader`,
    description: "Drag each card into a tier.",
    head: `<link rel="alternate" type="text/markdown" href="?format=md">`,
    body: `<div id="app" class="app" aria-busy="true"></div>
<script id="boot" type="application/json">${safeJson(boot)}</script>
${agentBrief(brief)}`,
    scripts: [CDN.sortable, CDN.marked, CDN.purify, "/static/board.js"],
  });
}

export function joinPage({ collection, code, count }) {
  return shell({
    title: `Join: ${collection.title} · tiergrader`,
    description: collection.description || "Rank these into tiers.",
    body: `<main id="join" class="join"></main>
<script id="boot" type="application/json">${safeJson({ code, title: collection.title, description: collection.description, count })}</script>
${agentBrief(`Open link to join the tiergrader collection "${collection.title}" (${count} items). POST /api/j/${code} with {"name": "..."} to get a personal ranking link.`)}`,
    scripts: ["/static/join.js"],
  });
}

export function notFoundPage(message = "This link doesn't go anywhere. It may have been deleted, or mistyped.") {
  return shell({
    title: "Not found · tiergrader",
    body: `<main class="notfound">${LOCKUP_HTML}<h1>Nothing here</h1><p>${esc(message)}</p><p><a href="/">Make a new collection</a></p></main>`,
  });
}
