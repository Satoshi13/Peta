// Today screen logic (spec §14). Visuals are placeholders; see docs/ui-handoff.md for the art hand-off.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const stages = ["envelope", "material", "choose", "collection", "pack", "gift", "done"].reduce((o, k) => ((o[k] = $(`stage-${k}`)), o), {});

let status = null;
let view = "main"; // "main" | "collection" | "pack" | "gift"
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
  show(stages.pack, !done && view === "pack");
  show(stages.gift, !done && view === "gift");
  show(stages.done, done);

  if (s.material) {
    $("material-card").dataset.materialId = s.material.id; // for the art layer (src/art/art.js)
    $("material-name").textContent = s.material.name;
    $("material-rarity").textContent = s.material.rarity;
    $("material-rarity").dataset.rarity = s.material.rarity;
    $("material-recipe").textContent = recipeSummary(s.material);
  }

  // Material picker: what is in stock (materials are used up; plain paper never is). Today's material is the
  // default until the user picks another.
  const usable = s.unlocked.filter((m) => m.unlimited || m.count > 0);
  if (chosenMaterial && !usable.some((m) => m.id === chosenMaterial)) chosenMaterial = null;
  const selected = chosenMaterial ?? (usable.some((m) => m.id === s.material?.id) ? s.material.id : usable[0]?.id) ?? null;
  const picker = $("material-picker");
  picker.replaceChildren(...usable.map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m.id === selected));
    b.dataset.materialId = m.id; // for the art layer
    b.textContent = m.unlimited ? m.name : `${m.name} ×${m.count}`;
    b.addEventListener("click", () => { chosenMaterial = m.id; render(); });
    return b;
  }));

  $("material-list").replaceChildren(...s.unlocked.map((m) => {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><span class="badge"></span>`;
    li.firstChild.textContent = m.unlimited ? m.name : `${m.name} ×${m.count}`;
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
  refreshPackChoice();
  refreshGiftChoice();
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

const packLeft = (p) => `${p.remaining} of ${p.total} left`;

/** Pack choice: enabled while some pack still has something to open. */
async function refreshPackChoice() {
  try {
    const { packs, canOpen } = await invoke("pack_status");
    const left = packs.reduce((n, p) => n + p.remaining, 0);
    $("choose-pack").disabled = !canOpen || left === 0;
    $("pack-note").textContent = left === 0 ? "All opened" : `Open one at random · ${left} left`;
  } catch { /* leave it disabled */ }
}

async function showPack() {
  view = "pack";
  const { packs } = await invoke("pack_status");
  $("pack-list").replaceChildren(...packs.map((p) => {
    const card = document.createElement("div");
    card.className = "pack-card";
    card.dataset.packId = p.id;
    card.innerHTML = `<img class="pack-art" data-art="pack-pouch" src="art/today/choice-pack-pouch.png" alt=""><div><strong></strong><small class="muted"></small><button type="button" class="primary pack-open">Open one</button></div>`;
    card.querySelector("strong").textContent = `${p.title} by ${p.by}`;
    card.querySelector("small").textContent = packLeft(p);
    const open = card.querySelector(".pack-open");
    open.disabled = p.remaining === 0;
    open.addEventListener("click", () => act(async () => {
      await invoke("pack_open", { packId: p.id });
      view = "main";
      return invoke("daily_status");
    }));
    return card;
  }));
  await render();
}

/** Gift choice: a note of how many are waiting. */
async function refreshGiftChoice() {
  try {
    const waiting = (await invoke("gift_inbox")).filter((g) => !g.openedAt).length;
    $("gift-note-small").textContent = waiting ? `${waiting} waiting` : "Open one that arrived";
  } catch { /* keep the default */ }
}

async function showGift() {
  view = "gift";
  const gifts = await invoke("gift_inbox");
  const waiting = gifts.filter((g) => !g.openedAt);
  show($("gift-empty"), waiting.length === 0);
  $("gift-list").replaceChildren(...waiting.map((g) => {
    const card = document.createElement("div");
    card.className = "pack-card gift-card";
    card.dataset.giftId = g.giftId;
    card.innerHTML = `<img class="pack-art" data-art="gift-envelope" src="art/arrival/arrival-gift.png" alt=""><div><strong>A Peta arrived.</strong><small class="muted"></small><button type="button" class="primary gift-open">Open</button></div>`;
    card.querySelector("small").textContent = g.note ? `from ${g.from} — “${g.note}”` : `from ${g.from}`;
    card.querySelector(".gift-open").addEventListener("click", () => act(async () => {
      await invoke("gift_open", { giftId: g.giftId });
      view = "main";
      return invoke("daily_status");
    }));
    return card;
  }));
  await render();
}

async function receiveGiftFile() {
  setError("");
  try {
    await invoke("gift_receive_file");
  } catch (err) {
    setError(String(err) === "gift_already_received" ? "That gift is already in your Inbox." : String(err));
  }
  await showGift();
}

$("open-material").addEventListener("click", () => act(() => invoke("daily_open_material")));
$("choose-create").addEventListener("click", () => act(() => invoke("daily_create", {
  materialId: chosenMaterial ?? (status.unlocked.some((m) => m.id === status.material?.id && m.count > 0) ? status.material.id : null),
})));
$("choose-collection").addEventListener("click", () => showCollection());
$("choose-pack").addEventListener("click", () => showPack());
$("choose-gift").addEventListener("click", () => showGift());
$("gift-back").addEventListener("click", () => { view = "main"; render(); });
$("gift-file").addEventListener("click", () => receiveGiftFile());
$("pack-back").addEventListener("click", () => { view = "main"; render(); });
$("collection-back").addEventListener("click", () => { view = "main"; render(); });

await listen("daily-changed", () => refresh());
await refresh();
