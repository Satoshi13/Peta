// Today screen logic (spec §14). Visuals are placeholders; see docs/ui-handoff.md for the art hand-off.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const stages = ["envelope", "material", "choose", "collection", "done"].reduce((o, k) => ((o[k] = $(`stage-${k}`)), o), {});

let status = null;
let view = "main"; // "main" | "collection"
let chosenMaterial = null; // only set once the user has picked a chip; otherwise today's material is the default
let busy = false;
const thumbs = new Map(); // stickerId -> blob url

const show = (el, on) => { el.hidden = !on; };

async function thumbUrl(stickerId) {
  if (!thumbs.has(stickerId)) {
    const bytes = await invoke("sticker_asset", { stickerId });
    thumbs.set(stickerId, URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
  }
  return thumbs.get(stickerId);
}

function recipeSummary(m) {
  const r = m.recipe;
  const parts = [r.substrate.replace(/_/g, " ")];
  if (r.reflection?.enabled) parts.push(`${r.reflection.type} reflection`);
  if (r.texture) parts.push(r.texture.replace(/_/g, " "));
  if (r.colorTreatment) parts.push(r.colorTreatment.replace(/_/g, " "));
  return parts.join(" · ");
}

function setError(message) {
  $("error").textContent = message || "";
  show($("error"), Boolean(message));
}

function friendly(err) {
  const text = String(err);
  return text === "already_used_today" ? "Today's Peta is already stuck. See you tomorrow." : text;
}

async function render() {
  const s = status;
  $("date").textContent = s.date;
  $("debug-slot").textContent = `slot: ${s.slot}`;

  const done = s.slot === "confirmed" || s.slot === "used";
  show(stages.envelope, !s.materialOpened && !done);
  show(stages.material, s.materialOpened);
  show(stages.choose, !done && view === "main" && s.materialOpened);
  show(stages.collection, !done && view === "collection");
  show(stages.done, done);

  if (s.material) {
    $("material-name").textContent = s.material.name;
    $("material-rarity").textContent = s.material.rarity;
    $("material-rarity").dataset.rarity = s.material.rarity;
    $("material-recipe").textContent = recipeSummary(s.material);
  }

  // Material picker: anything unlocked; today's material is the default until the user picks another.
  if (chosenMaterial && !s.unlocked.some((m) => m.id === chosenMaterial)) chosenMaterial = null;
  const selected = chosenMaterial ?? s.material?.id ?? s.unlocked[0]?.id ?? null;
  const picker = $("material-picker");
  picker.replaceChildren(...s.unlocked.map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m.id === selected));
    b.textContent = m.name;
    b.addEventListener("click", () => { chosenMaterial = m.id; render(); });
    return b;
  }));

  $("material-list").replaceChildren(...s.unlocked.map((m) => {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><span class="badge"></span>`;
    li.firstChild.textContent = m.name;
    li.lastChild.textContent = m.rarity;
    li.lastChild.dataset.rarity = m.rarity;
    return li;
  }));

  if (done && s.stickerId) {
    $("done-sticker").src = await thumbUrl(s.stickerId);
  }
}

async function refresh() {
  status = await invoke("daily_status");
  if (status.slot === "confirmed" || status.slot === "used") view = "main";
  await render();
}

async function act(fn) {
  if (busy) return;
  busy = true;
  setError("");
  try {
    status = await fn();
  } catch (err) {
    setError(friendly(err));
    await refresh();
  } finally {
    busy = false;
  }
  await render();
}

async function showCollection() {
  view = "collection";
  const items = await invoke("collection_unused");
  show($("collection-empty"), items.length === 0);
  const grid = $("collection-grid");
  grid.replaceChildren(...await Promise.all(items.map(async (s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.innerHTML = `<img alt=""><small></small>`;
    b.firstChild.src = await thumbUrl(s.id);
    b.lastChild.textContent = s.originalNumber != null ? `ORIGINAL #${String(s.originalNumber).padStart(4, "0")}` : s.id;
    b.addEventListener("click", () => act(async () => {
      const next = await invoke("daily_stick_from_collection", { stickerId: s.id });
      view = "main";
      return next;
    }));
    return b;
  })));
  await render();
}

$("open-material").addEventListener("click", () => act(() => invoke("daily_open_material")));
$("choose-create").addEventListener("click", () => act(() => invoke("daily_create", {
  materialId: chosenMaterial ?? status.material?.id ?? null,
})));
$("choose-collection").addEventListener("click", () => showCollection());
$("collection-back").addEventListener("click", () => { view = "main"; render(); });

await listen("daily-changed", () => refresh());
await refresh();
