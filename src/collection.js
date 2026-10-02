// Sticker Book logic (spec §43-46). The rules (which month, what is printed on a back) live in Rust.
import { renderBackCard, renderBackFallback } from "./back-card.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

let index = [];
let current = null; // { year, month }
let entries = [];
let selected = null; // BookEntry
let daily = null;
let faceUp = true;
const thumbs = new Map();

async function thumb(stickerId) {
  if (!thumbs.has(stickerId)) {
    const bytes = await invoke("sticker_asset", { stickerId });
    thumbs.set(stickerId, URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
  }
  return thumbs.get(stickerId);
}

const label = (e) => (e.originalNumber != null ? `No. ${String(e.originalNumber).padStart(4, "0")}` : "—");
const shortDate = (d) => { const [, m, day] = d.split("-"); return `${SHORT[Number(m) - 1]} ${Number(day)}`; };

// ---- index (years > months) ----

function renderIndex() {
  const box = $("index");
  box.replaceChildren();
  let year = null;
  for (const m of index) {
    if (m.year !== year) {
      year = m.year;
      const y = document.createElement("div");
      y.className = "year";
      y.textContent = String(year);
      box.append(y);
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "month-tab";
    b.dataset.art = "book-tab";
    b.dataset.year = m.year;
    b.dataset.month = m.month;
    b.setAttribute("aria-current", String(current && current.year === m.year && current.month === m.month));
    b.innerHTML = `<span></span><small></small>`;
    b.firstChild.textContent = SHORT[m.month - 1];
    b.lastChild.textContent = String(m.count);
    b.addEventListener("click", () => openMonth(m.year, m.month));
    box.append(b);
  }
}

// ---- page ----

/** A soft shadow sweeps across the page when you turn to another month (art: book/page-curl-shadow.png). */
function turnPage() {
  const page = $("page");
  page.classList.remove("turning");
  void page.offsetWidth; // restart the animation
  page.classList.add("turning");
}

async function openMonth(year, month) {
  if (current && (current.year !== year || current.month !== month)) turnPage();
  current = { year, month };
  renderIndex();
  entries = await invoke("book_page", { year, month });
  $("page-title").textContent = `${MONTHS[month - 1]} ${year}`;
  $("page-sub").textContent = `${entries.length} sticker${entries.length === 1 ? "" : "s"}`;
  $("empty").hidden = entries.length > 0;
  const grid = $("grid");
  grid.replaceChildren(...await Promise.all(entries.map(async (e, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.dataset.stickerId = e.stickerId;
    b.setAttribute("aria-pressed", String(selected?.stickerId === e.stickerId && selected?.date === e.date));
    const img = document.createElement("img");
    img.alt = "";
    img.src = await thumb(e.stickerId);
    const cap = document.createElement("small");
    cap.textContent = `${label(e)} · ${shortDate(e.date)}`;
    b.append(img, cap);
    if (e.onDesktop) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "on desktop";
      b.append(badge);
    }
    b.addEventListener("click", () => select(entries[i]));
    return b;
  })));
}

// ---- detail ----

async function select(entry) {
  selected = entry;
  faceUp = true;
  $("detail").hidden = false;
  $("msg").textContent = "";
  document.querySelectorAll(".tile").forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.stickerId === entry.stickerId)));
  $("detail-img").src = await thumb(entry.stickerId);
  $("detail-front").hidden = false;
  $("detail-back").hidden = true;
  $("turn").textContent = "Turn over";

  const back = await invoke("sticker_back", { stickerId: entry.stickerId });
  $("detail-back").replaceChildren(back ? renderBackCard(back) : renderBackFallback());

  const facts = [["Material", back?.material?.name ?? "—"], ["Made", back?.createdOn ?? "—"], ["By", back?.createdBy ?? "—"]];
  if (back?.kind === "received") facts.push(["Received from", back.receivedFrom ?? "—"]);
  facts.push(["Today's Peta", entry.sourceType === "collection" ? "stuck again" : "made"]);
  $("facts").replaceChildren(...facts.flatMap(([k, v]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    return [dt, dd];
  }));
  $("history").replaceChildren(...(back?.history ?? []).map((h) => {
    const li = document.createElement("li");
    const a = document.createElement("span");
    const b = document.createElement("span");
    a.textContent = { created: "Made", gifted: "Gifted", received: "Received", pack_opened: "Pack opened" }[h.type] ?? h.type;
    if (h.by) a.textContent += ` · ${h.by}`;
    b.textContent = h.on;
    li.append(a, b);
    return li;
  }));
  updateActions();
}

function updateActions() {
  if (!selected) return;
  const stick = $("act-stick");
  stick.hidden = selected.onDesktop;
  stick.disabled = !(daily?.canCreate);
  stick.title = daily?.canCreate ? "" : "Today's Peta is already stuck. See you tomorrow.";
  $("act-peel").hidden = !selected.onDesktop;
}

let turning = false;
async function turnOver() {
  if (!selected || turning) return;
  turning = true;
  const [front, back] = [$("detail-front"), $("detail-back")];
  const spin = (el, a, b, ms, easing) => el.animate(
    [{ transform: `perspective(700px) rotateY(${a}deg)` }, { transform: `perspective(700px) rotateY(${b}deg)` }], { duration: ms, easing }).finished;
  const [from, to] = faceUp ? [front, back] : [back, front];
  faceUp = !faceUp;
  $("turn").textContent = faceUp ? "Turn over" : "Turn back";
  try {
    await spin(from, 0, 90, 150, "ease-in");
    from.hidden = true;
    to.hidden = false;
    await spin(to, -90, 0, 190, "ease-out");
  } catch { /* cancelled */ } finally {
    turning = false;
  }
}

// ---- materials ----

async function renderMaterials() {
  const list = await invoke("material_book");
  $("material-grid").replaceChildren(...list.map(({ material: m, unlocked }) => {
    const card = document.createElement("div");
    card.className = "material";
    card.dataset.locked = String(!unlocked);
    card.dataset.materialId = m.id;
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.dataset.art = `swatch-${m.id}`;
    const name = document.createElement("h3");
    name.textContent = unlocked ? m.name : "?";
    const rarity = document.createElement("span");
    rarity.className = "rarity";
    rarity.textContent = unlocked ? m.rarity : "locked";
    const when = document.createElement("small");
    when.className = "muted";
    when.textContent = unlocked
      ? `${m.unlimited ? "Always available" : `${m.count} in stock`} · found ${(m.unlockedAt ?? "").slice(0, 10)}`
      : "Open Today's Material to find it";
    card.append(swatch, name, rarity, when);
    return card;
  }));
}

// ---- wiring ----

function showTab(which) {
  $("view-book").hidden = which !== "book";
  $("view-materials").hidden = which !== "materials";
  $("tab-book").setAttribute("aria-selected", String(which === "book"));
  $("tab-materials").setAttribute("aria-selected", String(which === "materials"));
  if (which === "materials") renderMaterials();
}
$("tab-book").addEventListener("click", () => showTab("book"));
$("tab-materials").addEventListener("click", () => showTab("materials"));
$("detail-close").addEventListener("click", () => { selected = null; $("detail").hidden = true; document.querySelectorAll(".tile").forEach((t) => t.setAttribute("aria-pressed", "false")); });
$("turn").addEventListener("click", turnOver);

$("act-stick").addEventListener("click", async () => {
  if (!selected) return;
  try {
    await invoke("daily_stick_from_collection", { stickerId: selected.stickerId });
    $("msg").textContent = "Stuck on your desktop. See you tomorrow.";
  } catch (e) {
    $("msg").textContent = String(e) === "already_used_today" ? "Today's Peta is already stuck. See you tomorrow." : String(e);
  }
  await reload();
});
// ---- gift: seal a copy into a .peta file ----
const giftForm = $("gift-form");
$("act-gift").addEventListener("click", () => {
  giftForm.hidden = !giftForm.hidden;
  if (!giftForm.hidden) $("gift-to").focus();
});
$("gift-cancel").addEventListener("click", () => { giftForm.hidden = true; });
giftForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selected) return;
  const to = $("gift-to").value.trim();
  if (!to) { $("msg").textContent = "Who is it for?"; $("gift-to").focus(); return; }
  try {
    const sent = await invoke("gift_send", { stickerId: selected.stickerId, to, note: $("gift-note").value.trim() || null });
    if (sent) {
      $("msg").textContent = `Sealed as edition #${String(sent.edition).padStart(4, "0")}. Send the file to ${to} any way you like.`;
      giftForm.hidden = true;
      $("gift-note").value = "";
      await reload();
    }
  } catch (err) {
    $("msg").textContent = String(err);
  }
});

$("act-peel").addEventListener("click", async () => {
  if (!selected) return;
  await invoke("peel_sticker", { stickerId: selected.stickerId });
  $("msg").textContent = "Peeled off. It waits here.";
  await reload();
});

const nameInput = $("display-name");
async function saveName() {
  const p = await invoke("profile_set", { displayName: nameInput.value });
  nameInput.value = p.displayName;
}
nameInput.addEventListener("change", saveName);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

/** Re-read everything (something was stuck, peeled, or the day changed). Keeps the selection if it still exists. */
async function reload() {
  daily = await invoke("daily_status");
  index = await invoke("book_index");
  const stillThere = current && index.some((m) => m.year === current.year && m.month === current.month);
  if (!stillThere) current = index[0] ? { year: index[0].year, month: index[0].month } : null;
  if (current) {
    await openMonth(current.year, current.month);
  } else {
    renderIndex();
    entries = [];
    $("page-title").textContent = "No pages yet";
    $("page-sub").textContent = "";
    $("grid").replaceChildren();
    $("empty").hidden = false;
  }
  if (selected) {
    const fresh = entries.find((e) => e.stickerId === selected.stickerId && e.date === selected.date);
    if (fresh) { selected = fresh; updateActions(); } else { selected = null; $("detail").hidden = true; }
  }
  if (!$("view-materials").hidden) renderMaterials();
}

await listen("placements-changed", () => reload());
await listen("daily-changed", () => reload());
nameInput.value = (await invoke("profile_get")).displayName;
await reload();
