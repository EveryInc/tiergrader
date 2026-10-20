// Open link: type your name, get your own personal ranking link (remembered in this browser).
import { LOCKUP_HTML } from "./shared.js";
const boot = JSON.parse(document.getElementById("boot").textContent);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const KEY = `tg.join.${boot.code}`;
let saved = null;
try {
  saved = JSON.parse(localStorage.getItem(KEY) || "null");
} catch {
  /* storage unavailable */
}

const main = document.getElementById("join");
main.innerHTML = `
  ${LOCKUP_HTML}
  <div class="panel">
    <div style="color:var(--muted);font-size:12.5px">You've been asked to rank ${boot.count} item${boot.count === 1 ? "" : "s"} into tiers</div>
    <h1>${esc(boot.title)}</h1>
    ${boot.description ? `<p style="margin:0;color:var(--muted)">${esc(boot.description)}</p>` : ""}
    ${saved ? `<a class="btn primary" style="height:40px;justify-content:center" href="${esc(new URL(saved.url).pathname)}">Continue as ${esc(saved.name)}</a><div style="color:var(--muted);font-size:12.5px;text-align:center">or join as someone else:</div>` : ""}
    <form style="display:grid;gap:10px">
      <label style="display:grid;gap:6px;font-size:12.5px;color:var(--muted);font-weight:550">Your name
        <input class="input" name="name" autocomplete="name" required ${saved ? "" : "autofocus"}>
      </label>
      <button class="btn ${saved ? "" : "primary"}" style="height:40px;justify-content:center">Start ranking</button>
    </form>
    <p style="margin:0;color:var(--muted);font-size:12.5px">You'll get your own link. Bookmark it to come back and change your ranking.</p>
  </div>`;

const form = main.querySelector("form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = form.name.value.trim();
  if (!name) return form.name.focus();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const res = await fetch(`/api/j/${boot.code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || "Couldn't join");
    try {
      localStorage.setItem(KEY, JSON.stringify({ name: out.name, url: out.url }));
    } catch {
      /* storage unavailable */
    }
    location.href = new URL(out.url).pathname;
  } catch (err) {
    alert(err.message);
    button.disabled = false;
  }
});
