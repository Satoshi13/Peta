import { $, el, api, date, action, confirmAction, notice, copy } from "./ui.js";
/* Official shop packs: drafts made here, signed on the owner's Mac (scripts/sign-pack.sh), then put on sale for a period.
   This page never signs and never asks for a key. */
let data = null, editing = null;
const POUCH_COLORS = { kraft: "#c9a878", glassine: "#ece8de", matte: "#eee6d6", holo: "#d9dce2" };
const TINTS = { rose: "#dab9b4", mint: "#bdc7ad", blue: "#b8c8d0", lavender: "#c9bed7" };
const localInput = seconds => { const d = new Date(seconds * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const seconds = value => Math.floor(new Date(value).getTime() / 1000);
const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const weightOf = item => item.weight ?? data.contract.rarityWeights[item.rarity] ?? 1;
const slug = name => (name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "sticker");
const button = (label, className = "subtle") => { const b = el("button", label, className); b.type = "button"; return b; };
const field = (label, input) => { const l = el("label", label); l.append(input); return l; };
const pictureUrl = (draftId, key) => `/api/packs/drafts/${draftId}/pictures/${encodeURIComponent(key)}?v=${Date.now()}`;

/* Chances: each sticker's share of the weights, and each rarity's. */
function chances(items) {
  const total = items.reduce((n, i) => n + weightOf(i), 0) || 1;
  const byRarity = Object.fromEntries(data.contract.rarities.map(r => [r, items.filter(i => i.rarity === r).reduce((n, i) => n + weightOf(i), 0) / total]));
  return { each: items.map(i => weightOf(i) / total), byRarity };
}
const pct = x => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

/* Shrink to 1024 px and check transparency here, so a picture the app would refuse never leaves this Mac. */
async function prepare(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name}: not a picture this page can read.`);
  const max = data.contract.picture.maxEdge, scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = false, drawn = false; for (let i = 3; i < alpha.length; i += 4) { if (alpha[i] < 255) clear = true; if (alpha[i] > 0) drawn = true; if (clear && drawn) break; }
  if (!clear) throw new Error(`${file.name}: the background isn't transparent. Cut the sticker out first (no border; Peta adds it).`);
  if (!drawn) throw new Error(`${file.name}: the picture is empty.`);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (blob.size > data.contract.picture.maxBytes) throw new Error(`${file.name}: ${kb(blob.size)} after resizing; each picture is at most 1.5 MB.`);
  return blob;
}

function preview(m, draftId) {
  const box = el("div", undefined, "pk-preview"), pouch = el("div", undefined, `pk-pouch pk-${m.pouch}`), label = el("div", undefined, "pk-label");
  pouch.style.background = m.color ? TINTS[m.color] : POUCH_COLORS[m.pouch];
  label.append(el("strong", m.title || "Untitled pack"), el("small", `BY ${(m.by || "Peta").toUpperCase()}`)); pouch.append(label);
  const { each, byRarity } = chances(m.items);
  const stickers = el("div", undefined, "pk-stickers");
  m.items.forEach((item, i) => {
    const fig = el("figure"), img = el("img"); img.alt = item.name; img.src = pictureUrl(draftId, item.key);
    fig.append(img, el("figcaption", `${item.name || item.key} · ${item.rarity} · ${pct(each[i])}`)); stickers.append(fig);
  });
  const odds = el("p", data.contract.rarities.map(r => `${r} ${pct(byRarity[r])}`).join(" · "), "hint");
  box.append(pouch, el("div", undefined, "pk-meta"));
  box.lastChild.append(el("p", `${m.price} Scraps · ${m.items.length} stickers`), el("p", m.blurb || "No line yet.", "muted"), odds);
  box.append(stickers);
  return box;
}

function editor(d) {
  const m = structuredClone(d.manifest), card = el("article", undefined, "card pk-editor"), c = data.contract;
  const title = el("input"), by = el("input"), blurb = el("input"), pouch = el("select"), color = el("select"), price = el("input");
  title.maxLength = by.maxLength = c.titleChars; blurb.maxLength = c.blurbChars; title.value = m.title; by.value = m.by; blurb.value = m.blurb;
  for (const p of c.pouches) pouch.append(new Option(p, p, false, p === m.pouch));
  color.append(new Option("None (ivory / silver)", "")); for (const t of c.colors) color.append(new Option(t, t, false, t === m.color));
  price.type = "number"; price.min = c.price.min; price.max = c.price.max; price.step = 1; price.value = m.price;
  const syncColor = () => { color.disabled = !c.colorPouches.includes(pouch.value); if (color.disabled) color.value = ""; };
  syncColor();
  const rows = el("ol", undefined, "pk-items"), view = el("div"), error = el("p", "", "daily-error"); error.setAttribute("role", "status");
  const read = () => ({ ...m, title: title.value, by: by.value, blurb: blurb.value, pouch: pouch.value, color: color.value || null, price: Number(price.value), items: m.items });
  const draw = () => {
    rows.replaceChildren(...m.items.map((item, i) => {
      const li = el("li"), img = el("img"), name = el("input"), rarity = el("select"), weight = el("input"), up = button("↑"), down = button("↓"), remove = button("Remove", "danger");
      img.alt = ""; img.src = pictureUrl(d.draftId, item.key); name.value = item.name; name.maxLength = c.titleChars; name.setAttribute("aria-label", `Name of sticker ${i + 1}`);
      for (const r of c.rarities) rarity.append(new Option(r, r, false, r === item.rarity));
      weight.type = "number"; weight.min = c.weight.min; weight.max = c.weight.max; weight.placeholder = String(c.rarityWeights[item.rarity]); weight.value = item.weight ?? ""; weight.setAttribute("aria-label", `Weight of ${item.name || item.key}`);
      name.oninput = () => { item.name = name.value; }; rarity.onchange = () => { item.rarity = rarity.value; weight.placeholder = String(c.rarityWeights[item.rarity]); draw(); };
      weight.onchange = () => { item.weight = weight.value === "" ? null : Number(weight.value); draw(); };
      up.disabled = i === 0; down.disabled = i === m.items.length - 1;
      up.onclick = () => { [m.items[i - 1], m.items[i]] = [m.items[i], m.items[i - 1]]; draw(); };
      down.onclick = () => { [m.items[i + 1], m.items[i]] = [m.items[i], m.items[i + 1]]; draw(); };
      remove.onclick = () => { m.items.splice(i, 1); draw(); };
      li.append(img, name, rarity, weight, up, down, remove); return li;
    }));
    view.replaceChildren(preview(read(), d.draftId));
  };
  for (const input of [title, by, blurb, price]) input.oninput = () => view.replaceChildren(preview(read(), d.draftId));
  pouch.onchange = () => { syncColor(); view.replaceChildren(preview(read(), d.draftId)); }; color.onchange = pouch.onchange;
  const files = el("input"); files.type = "file"; files.accept = "image/png"; files.multiple = true; files.className = "pk-file";
  const drop = el("label", undefined, "pk-drop"); drop.append(el("span", "Drop transparent PNGs here, or choose files"), files);
  const add = async list => {
    error.textContent = "";
    for (const file of list) {
      if (m.items.length >= c.items.max) { error.textContent = "A pack holds up to 12 stickers."; break; }
      try {
        const blob = await prepare(file);
        let key = slug(file.name), n = 2; while (m.items.some(i => i.key === key)) key = `${slug(file.name).slice(0, 36)}-${n++}`;
        const r = await fetch(`/api/packs/drafts/${d.draftId}/pictures/${key}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
        if (!r.ok) throw new Error(`${file.name}: ${(await r.json()).message}`);
        m.items.push({ key, name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, c.titleChars), rarity: "common", weight: null });
      } catch (e) { error.textContent = e.message; }
    }
    draw(); await api("/api/packs/drafts/save", { draftId: d.draftId, manifest: read() }).catch(e => { error.textContent = e.message; });
  };
  files.onchange = () => add([...files.files]);
  drop.ondragover = e => { e.preventDefault(); drop.dataset.over = "true"; }; drop.ondragleave = () => { delete drop.dataset.over; };
  drop.ondrop = e => { e.preventDefault(); delete drop.dataset.over; add([...e.dataTransfer.files]); };
  const save = button("Save draft", ""), ready = button("Ready to sign", ""), close = button("Close");
  save.onclick = () => action(save, async () => { await api("/api/packs/drafts/save", { draftId: d.draftId, manifest: read() }); notice("Draft saved."); await loadPacks(); });
  ready.onclick = async () => {
    if (!await confirmAction("Ready to sign?", "The draft can't change after this. You'll sign it on your Mac with one command, after checking the pictures there.")) return;
    await action(ready, async () => { await api("/api/packs/drafts/save", { draftId: d.draftId, manifest: read() }); await api("/api/packs/drafts/ready", { draftId: d.draftId }); editing = null; notice("Ready. Copy the command and run it on your Mac."); await loadPacks(); });
  };
  close.onclick = () => { editing = null; render(); };
  const fields = el("div", undefined, "fields"), more = el("div", undefined, "fields");
  fields.append(field("Title", title), field("By", by)); more.append(field("Wrapping", pouch), field("Color", color), field("Price (Scraps)", price));
  card.append(el("h3", `${m.packId} · version ${m.version}`), fields, field("Line in Market (optional)", blurb), more, drop, error, rows, el("p", "HOW IT LOOKS", "eyebrow"), view);
  const actions = el("div", undefined, "actions"); actions.append(close, save, ready); card.append(actions);
  draw(); return card;
}

/* A signed file, read here: its words as plain text, its pictures as blob: images. Nothing in it runs. */
async function contents(packId, version) {
  const r = await fetch(`/api/packs/file/${packId}/${version}`);
  if (!r.ok) throw new Error((await r.json()).message);
  const bytes = new Uint8Array(await r.arrayBuffer()), view = new DataView(bytes.buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "PETAEVNT") throw new Error("This isn't a Peta shop pack file.");
  const n = view.getUint32(9), header = JSON.parse(new TextDecoder().decode(bytes.subarray(13, 13 + n)));
  const box = el("div", undefined, "pk-contents"), p = header.payload, figs = el("div", undefined, "report-pictures");
  let at = 13 + n;
  for (const a of header.attachments) {
    const item = p.items.find(i => i.key === a.key) || {}, fig = el("figure"), img = el("img");
    img.src = URL.createObjectURL(new Blob([bytes.subarray(at, at + a.pngLen)], { type: "image/png" })); img.alt = item.name || a.key; at += a.pngLen + (a.maskLen || 0);
    fig.append(img, el("figcaption", `${item.name} · ${item.rarity}${item.weight ? ` · weight ${item.weight}` : ""}`)); figs.append(fig);
  }
  box.append(el("p", `${p.title} by ${p.by} · ${p.price} Scraps · ${p.pouch}${p.color ? ` (${p.color})` : ""} · signed with ${header.signer.keyId}`), el("p", p.blurb || "", "muted"), figs);
  return box;
}

function signedCard(p) {
  const card = el("article", undefined, "card"), head = el("div", undefined, "card-head");
  head.append(el("h3", `${p.title} · v${p.version}`), el("span", p.state, "tag"));
  card.append(head, el("p", `${p.packId} · ${p.price} Scraps · ${kb(p.size)} · key ${p.keyId || "?"}`),
    el("p", p.startsAt === null ? "Not on sale yet." : `${date(p.startsAt)} – ${p.endsAt === null ? "no end" : date(p.endsAt)}`, "hint"));
  const actions = el("div", undefined, "actions"), show = button("Show contents"), slot = el("div");
  show.onclick = () => action(show, async () => { slot.replaceChildren(await contents(p.packId, p.version)); });
  if (p.state !== "removed") actions.append(show);
  if (["signed", "scheduled", "on sale", "ended"].includes(p.state)) {
    const t = Math.floor(Date.now() / 1000), form = el("form", undefined, "fields pk-period"), starts = el("input"), ends = el("input"), open = el("label", undefined, "check"), forever = el("input"), go = el("button", p.startsAt === null ? "Put on sale" : "Change period");
    starts.type = ends.type = "datetime-local"; starts.value = localInput(p.startsAt ?? t); ends.value = localInput(p.endsAt ?? t + 14 * 86400); forever.type = "checkbox"; forever.checked = p.startsAt !== null && p.endsAt === null;
    ends.disabled = forever.checked; forever.onchange = () => { ends.disabled = forever.checked; }; open.append(forever, el("span", "No end"));
    go.type = "submit";
    form.append(field("Starts", starts), field("Ends", ends), open, go);
    form.onsubmit = e => { e.preventDefault(); action(go, async () => { await api("/api/packs/publish", { packId: p.packId, version: p.version, startsAt: seconds(starts.value), endsAt: forever.checked ? null : seconds(ends.value) }); notice("Saved. Friends see it after Peta checks in."); await loadPacks(); }); };
    card.append(form);
    const stop = button("Stop", "danger");
    stop.onclick = async () => { if (await confirmAction(`Stop ${p.title}?`, "It leaves the shop after Peta checks in. Packs already on friends' shelves still open. To sell it again, make a new version.")) await action(stop, async () => { await api("/api/packs/stop", { packId: p.packId, version: p.version }); notice("Stopped."); await loadPacks(); }); };
    actions.append(stop);
  }
  const next = button("New version…");
  next.onclick = () => action(next, async () => { const r = await api("/api/packs/drafts", { fromPackId: p.packId }); editing = r.draftId; await loadPacks(); });
  if (p === data.packs.find(x => x.packId === p.packId)) actions.append(next);
  card.append(actions, slot); return card;
}

function draftCard(d) {
  const card = el("article", undefined, "card"), head = el("div", undefined, "card-head");
  head.append(el("h3", `${d.manifest.title || "Untitled"} · v${d.version}`), el("span", d.state === "ready" ? "waiting for signature" : "draft", "tag"));
  card.append(head, el("p", `${d.packId} · ${d.manifest.items.length} stickers · ${d.pictures.length} pictures · ${date(d.updatedAt)}`, "hint"));
  const actions = el("div", undefined, "actions");
  if (d.state === "draft") { const edit = button("Edit", ""); edit.onclick = () => { editing = d.draftId; render(); }; actions.append(edit); }
  if (d.command) {
    const line = el("code", d.command, "pk-command"), c = button("Copy command", "");
    c.onclick = () => copy(d.command);
    card.append(el("p", "Run this on your Mac. It opens the pictures there for you to check before anything is signed.", "hint"), line);
    actions.append(c);
  }
  const dup = button("Duplicate"), discard = button("Discard", "danger");
  dup.onclick = () => action(dup, async () => { const r = await api("/api/packs/drafts/duplicate", { draftId: d.draftId }); editing = r.draftId; await loadPacks(); });
  discard.onclick = async () => { if (await confirmAction("Discard this draft?", "Its pictures are removed at the next clean-up.")) await action(discard, async () => { await api("/api/packs/drafts/discard", { draftId: d.draftId }); await loadPacks(); }); };
  actions.append(dup, discard); card.append(actions); return card;
}

function render() {
  const edit = editing && data.drafts.find(d => d.draftId === editing && d.state === "draft");
  $("packs-editor").replaceChildren(...(edit ? [editor(edit)] : []));
  $("packs-drafts").replaceChildren(...(data.drafts.length ? data.drafts.map(draftCard) : [el("p", "No drafts.", "empty")]));
  $("packs-signed").replaceChildren(...(data.packs.length ? data.packs.map(signedCard) : [el("p", "Nothing signed yet.", "empty")]));
  $("packs-storage").textContent = `${kb(data.storage.bytes)} in ${data.storage.objects} files${data.storage.truncated ? " (and more)" : ""}.`;
}
export async function loadPacks() { data = await api("/api/packs"); render(); }
export function setupPacks() {
  $("packs-new").onsubmit = e => {
    e.preventDefault();
    action($("packs-start"), async () => { const r = await api("/api/packs/drafts", { packId: $("packs-id").value.trim() }); $("packs-id").value = ""; editing = r.draftId; await loadPacks(); });
  };
  $("refresh-packs").onclick = () => action($("refresh-packs"), loadPacks);
  $("packs-clean").onclick = async () => {
    if (!await confirmAction("Clean up?", "Removes old versions that are no longer sold, and discarded or signed drafts' pictures. Packs on friends' shelves keep their pictures on each Mac.")) return;
    await action($("packs-clean"), async () => { const r = await api("/api/packs/cleanup", { confirm: true }); notice(`Removed ${r.objects} files (${kb(r.bytes)}).`); await loadPacks(); });
  };
}
