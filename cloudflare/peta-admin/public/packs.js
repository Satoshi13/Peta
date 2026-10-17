import { stickerPreview } from "./sticker-preview.js";
import { state, rarity as rarityName, $, el, api, date, action, confirmAction, notice, copy } from "./ui.js";
/* Official shop packs: drafts made here, signed on the owner's Mac (scripts/sign-pack.sh), then put on sale for a period.
   This page never signs and never asks for a key. */
let data = null, editing = null;
const PACK_COLORS = {
  matte: [{id:null,name:"Ivory",swatch:"#eee6d6",filter:"none"},
    {id:"rose",name:"Rose",swatch:"#dab9b4",filter:"grayscale(1) sepia(.45) saturate(.7) hue-rotate(305deg) brightness(.9)"},
    {id:"mint",name:"Sage",swatch:"#bdc7ad",filter:"grayscale(1) sepia(.45) saturate(.7) hue-rotate(45deg) brightness(.86)"},
    {id:"blue",name:"Blue grey",swatch:"#b8c8d0",filter:"grayscale(1) sepia(.45) saturate(.7) hue-rotate(155deg) brightness(.88)"},
    {id:"lavender",name:"Lavender",swatch:"#c9bed7",filter:"grayscale(1) sepia(.45) saturate(.7) hue-rotate(215deg) brightness(.9)"}],
  holo: [{id:null,name:"Silver",swatch:"#d9dce2",filter:"none"},
    {id:"rose",name:"Rose",swatch:"#ecc5db",filter:"sepia(.55) saturate(1.9) hue-rotate(270deg) brightness(1.03)"},
    {id:"mint",name:"Mint",swatch:"#b6e4c9",filter:"sepia(.55) saturate(1.9) hue-rotate(80deg) brightness(1.03)"},
    {id:"blue",name:"Sky",swatch:"#b7deee",filter:"sepia(.55) saturate(1.9) hue-rotate(160deg) brightness(1.03)"},
    {id:"lavender",name:"Lavender",swatch:"#cfc7ee",filter:"sepia(.55) saturate(1.9) hue-rotate(205deg) brightness(1.03)"}],
};
const WRAPPING = {kraft:"クラフト",matte:"マット",holo:"ホログラム",glassine:"グラシン"};
const COLOR = {rose:"ローズ",mint:"ミント",blue:"ブルーグレー",lavender:"ラベンダー"};
const LABEL = {kraft:[21,39,79,65.5],matte:[20,47.8,80.5,72],holo:[22.5,38,77.2,62.6],glassine:[27,67,76,88]};
const cost = p => p.free ? "無料（1台1セット）" : `${p.price} Scraps`;
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
  if (!bitmap) throw new Error(`${file.name}：読み取れる画像ではありません。PNG を選んでください。`);
  const max = data.contract.picture.maxEdge, scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = false, drawn = false; for (let i = 3; i < alpha.length; i += 4) { if (alpha[i] < 255) clear = true; if (alpha[i] > 0) drawn = true; if (clear && drawn) break; }
  if (!clear) throw new Error(`${file.name}：背景が透明ではありません。アプリの Share → Cut-out for a pack で、フチなしの PNG を書き出してください。`);
  if (!drawn) throw new Error(`${file.name}：何も写っていない画像です。`);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (blob.size > data.contract.picture.maxBytes) throw new Error(`${file.name}：縮小後も ${kb(blob.size)} あります。画像は1枚1.5 MB以内にしてください。`);
  return blob;
}

function preview(m, draftId) {
  const box = el("div", undefined, "pk-preview"), pouch = el("div", undefined, `pk-pouch pk-${m.pouch}`), label = el("div", undefined, "pk-label");
  const bag=el("img");bag.className="pk-bag";bag.alt=WRAPPING[m.pouch];
  bag.src=m.pouch==="glassine"?"assets/glassine.webp":`assets/pack-${m.pouch}.png`;
  bag.style.filter=PACK_COLORS[m.pouch]?.find(c=>c.id===(m.color||null))?.filter||"none";
  const [left,top,right,bottom]=LABEL[m.pouch];
  label.style.left=left+"%";label.style.top=top+"%";label.style.width=(right-left)+"%";label.style.height=(bottom-top)+"%";
  label.append(el("strong",m.title||"名前のないパック"),el("small",m.by||"Peta"));pouch.append(bag,label);
  const { each, byRarity } = chances(m.items);
  const stickers = el("div", undefined, "pk-stickers");
  m.items.forEach((item, i) => {
    const fig = el("figure"), img = el("img"); img.alt = item.name; img.src = pictureUrl(draftId, item.key);
    fig.append(img, el("figcaption", `${item.name || item.key} · ${rarityName(item.rarity)} · ${pct(each[i])}`)); stickers.append(fig);stickerPreview(img,img.src).catch(()=>{});
  });
  const odds = el("p", data.contract.rarities.map(r => `${rarityName(r)} ${pct(byRarity[r])}`).join(" · "), "hint");
  box.append(pouch, el("div", undefined, "pk-meta"));
  box.lastChild.append(el("p", `${cost(m)} · ${m.items.length}枚`), el("p", m.blurb || "説明はまだありません。", "muted"), odds);
  box.append(stickers);
  return box;
}

function editor(d) {
  const m = structuredClone(d.manifest), card = el("article", undefined, "card pk-editor"), c = data.contract;
  const title = el("input"), by = el("input"), blurb = el("input"), pouch = el("select"), color = el("select"), price = el("input"), free = el("input");
  free.type = "checkbox"; free.checked = !!m.free;
  title.maxLength = by.maxLength = c.titleChars; blurb.maxLength = c.blurbChars; title.value = m.title; by.value = m.by; blurb.value = m.blurb;
  for (const p of c.pouches) pouch.append(new Option(WRAPPING[p], p, false, p === m.pouch));
  color.append(new Option("色なし（アイボリー／シルバー）", "")); for (const t of c.colors) color.append(new Option(COLOR[t], t, false, t === m.color));
  price.type = "number"; price.min = c.price.min; price.max = c.price.max; price.step = 1; price.value = m.price;
  const syncColor = () => { color.disabled = !c.colorPouches.includes(pouch.value); if (color.disabled) color.value = ""; };
  syncColor();
  free.onchange = () => { price.disabled = free.checked; view.replaceChildren(preview(read(), d.draftId)); }; price.disabled = free.checked;
  const rows = el("ol", undefined, "pk-items"), view = el("div"), error = el("p", "", "daily-error"); error.setAttribute("role", "status");
  const read = () => ({ ...m, title: title.value, by: by.value, blurb: blurb.value, pouch: pouch.value, color: color.value || null, free: free.checked, price: free.checked ? 0 : Number(price.value), items: m.items });
  const draw = () => {
    rows.replaceChildren(...m.items.map((item, i) => {
      const li = el("li"), img = el("img"), name = el("input"), rarity = el("select"), weight = el("input"), up = button("↑"), down = button("↓"), remove = button("外す", "danger");
      img.alt = ""; img.src = pictureUrl(d.draftId, item.key); name.value = item.name; name.maxLength = c.titleChars; name.setAttribute("aria-label", `ステッカー${i+1}の名前`);
      for (const r of c.rarities) rarity.append(new Option(rarityName(r), r, false, r === item.rarity));
      weight.type = "number"; weight.min = c.weight.min; weight.max = c.weight.max; weight.placeholder = String(c.rarityWeights[item.rarity]); weight.value = item.weight ?? ""; weight.setAttribute("aria-label", `${item.name||item.key}の重み`);
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
  const drop = el("label", undefined, "pk-drop"); drop.append(el("span", "アプリで Collection → ステッカー → Share → Cut-out for a pack から書き出した PNG をドラッグ（または選択）"), files);
  let uploading = false;
  const add = async list => {
    if (uploading) { error.textContent = "画像を取り込んでいます。完了してから追加してください。"; return; }
    uploading = true; files.disabled = save.disabled = ready.disabled = true; card.setAttribute("aria-busy", "true");
    try {
    error.textContent = "";
    for (const file of list) {
      if (m.items.length >= c.items.max) { error.textContent = "1パックに入れられるのは12枚までです。"; break; }
      try {
        const blob = await prepare(file);
        let key = slug(file.name), n = 2; while (m.items.some(i => i.key === key)) key = `${slug(file.name).slice(0, 36)}-${n++}`;
        const r = await fetch(`/api/packs/drafts/${d.draftId}/pictures/${key}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
        if (!r.ok) throw new Error(`${file.name}: ${(await r.json()).message}`);
        m.items.push({ key, name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, c.titleChars), rarity: "common", weight: null });
      } catch (e) { error.textContent = e.message; }
    }
    draw(); await api("/api/packs/drafts/save", { draftId: d.draftId, manifest: read() }).catch(e => { error.textContent = e.message; });
    } finally { uploading = false; files.disabled = save.disabled = ready.disabled = false; card.removeAttribute("aria-busy"); }
  };
  files.onchange = () => add([...files.files]);
  drop.ondragover = e => { e.preventDefault(); drop.dataset.over = "true"; }; drop.ondragleave = () => { delete drop.dataset.over; };
  drop.ondrop = e => { e.preventDefault(); delete drop.dataset.over; add([...e.dataTransfer.files]); };
  const save = button("下書きを保存", ""), ready = button("署名の準備をする", ""), close = button("閉じる");
  save.onclick = () => action(save, async () => { await api("/api/packs/drafts/save", { draftId: d.draftId, manifest: read() }); notice("下書きを保存しました。"); await loadPacks(); });
  ready.onclick = async () => {
    if (uploading) return;
    if (!await confirmAction("署名の準備に進みますか？", "この後は下書きを変更できません。Mac でコマンドを実行し、プレビューを確認してから署名します。")) return;
    await action(ready, async () => { await api("/api/packs/drafts/save", { draftId: d.draftId, manifest: read() }); await api("/api/packs/drafts/ready", { draftId: d.draftId }); editing = null; notice("準備できました。コマンドをコピーし、Mac のターミナルで実行してください。"); await loadPacks(); });
  };
  close.onclick = () => { editing = null; render(); };
  const fields = el("div", undefined, "fields"), more = el("div", undefined, "fields");
  fields.append(field("タイトル", title), field("作り手", by)); more.append(field("袋", pouch), field("色", color), field("価格（Scraps）", price), Object.assign(field("無料（1台1セット、Welcome と同じ扱い）", free), {className:"check pk-free"}));
  card.append(el("h3", `${m.packId} · 第${m.version}版`), fields, field("Market の説明（任意）", blurb), more, drop, error, rows, el("p", "できあがりの見本", "eyebrow"), view);
  const actions = el("div", undefined, "actions"); actions.append(close, save, ready); card.append(actions);
  draw(); return card;
}

/* A signed file, read here: its words as plain text, its pictures as blob: images. Nothing in it runs. */
async function contents(packId, version) {
  const r = await fetch(`/api/packs/file/${packId}/${version}`);
  if (!r.ok) throw new Error((await r.json()).message);
  const bytes = new Uint8Array(await r.arrayBuffer()), view = new DataView(bytes.buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "PETAEVNT") throw new Error("Peta の公式パックファイルではありません。");
  const n = view.getUint32(9), header = JSON.parse(new TextDecoder().decode(bytes.subarray(13, 13 + n)));
  const box = el("div", undefined, "pk-contents"), p = header.payload, figs = el("div", undefined, "report-pictures");
  let at = 13 + n;
  for (const a of header.attachments) {
    const item = p.items.find(i => i.key === a.key) || {}, fig = el("figure"), img = el("img");
    img.src = URL.createObjectURL(new Blob([bytes.subarray(at, at + a.pngLen)], { type: "image/png" })); img.alt = item.name || a.key; at += a.pngLen + (a.maskLen || 0);
    fig.append(img, el("figcaption", `${item.name} · ${rarityName(item.rarity)}${item.weight ? ` · 重み ${item.weight}` : ""}`)); figs.append(fig);
  }
  box.append(el("p", `${p.title} · 作り手 ${p.by} · ${cost(p)} · ${WRAPPING[p.pouch]}${p.color ? `（${COLOR[p.color]}）` : ""} · 署名鍵 ${header.signer.keyId}`), el("p", p.blurb || "", "muted"), figs);
  return box;
}

function signedCard(p) {
  const card = el("article", undefined, "card"), head = el("div", undefined, "card-head");
  head.append(el("h3", `${p.title} · v${p.version}`), el("span", state(p.state), "tag"));
  card.append(head, el("p", `${p.packId} · ${cost(p)} · ${kb(p.size)} · 署名鍵 ${p.keyId||"?"}`),
    el("p", p.startsAt === null ? "まだショップに並べていません。" : `${date(p.startsAt)} – ${p.endsAt === null ? "終了日なし" : date(p.endsAt)}`, "hint"));
  const actions = el("div", undefined, "actions"), show = button("内容を見る"), slot = el("div");
  show.onclick = () => action(show, async () => { slot.replaceChildren(await contents(p.packId, p.version)); });
  if (p.state !== "removed") actions.append(show);
  if (["signed", "scheduled", "on sale", "ended"].includes(p.state)) {
    const t = Math.floor(Date.now() / 1000), form = el("form", undefined, "fields pk-period"), starts = el("input"), ends = el("input"), open = el("label", undefined, "check"), forever = el("input"), go = el("button", p.startsAt === null ? "ショップに並べる" : "掲載期間を変更");
    starts.type = ends.type = "datetime-local"; starts.value = localInput(p.startsAt ?? t); ends.value = localInput(p.endsAt ?? t + 14 * 86400); forever.type = "checkbox"; forever.checked = p.startsAt !== null && p.endsAt === null;
    ends.disabled = forever.checked; forever.onchange = () => { ends.disabled = forever.checked; }; open.append(forever, el("span", "終了日なし"));
    go.type = "submit";
    form.append(el("h4","3. ショップに並べる"), field("開始", starts), field("終了", ends), open, go);
    form.onsubmit = e => { e.preventDefault(); action(go, async () => { await api("/api/packs/publish", { packId: p.packId, version: p.version, startsAt: seconds(starts.value), endsAt: forever.checked ? null : seconds(ends.value) }); notice("保存しました。友達の次回の取得後に届きます。"); await loadPacks(); }); };
    card.append(form);
    const stop = button("ショップから外す", "danger");
    stop.onclick = async () => { if (await confirmAction(`${p.title} をショップから外しますか？`, "次回の取得後にショップから外れます。棚にある分は引き続き開けられます。再掲載する場合は新しい版を作ってください。")) await action(stop, async () => { await api("/api/packs/stop", { packId: p.packId, version: p.version }); notice("ショップから外しました。"); await loadPacks(); }); };
    actions.append(stop);
  }
  const next = button("新しい版を作る…");
  next.onclick = () => action(next, async () => { const r = await api("/api/packs/drafts", { fromPackId: p.packId }); editing = r.draftId; await loadPacks(); });
  if (p === data.packs.find(x => x.packId === p.packId)) actions.append(next);
  card.append(actions, slot); return card;
}

function draftCard(d) {
  const card = el("article", undefined, "card"), head = el("div", undefined, "card-head");
  head.append(el("h3", `${d.manifest.title || "名前なし"} · v${d.version}`), el("span", d.state === "ready" ? "Mac での署名待ち" : "下書き", "tag"));
  card.append(head, el("p", `${d.packId} · ステッカー${d.manifest.items.length}枚 · 画像${d.pictures.length}枚 · ${date(d.updatedAt)}`, "hint"));
  const actions = el("div", undefined, "actions");
  if (d.state === "draft") { const edit = button("編集", ""); edit.onclick = () => { editing = d.draftId; render(); }; actions.append(edit); }
  if (d.command) {
    const line = el("code", d.command, "pk-command"), c = button("コマンドをコピー", "");
    c.onclick = () => copy(d.command);
    card.append(el("p", "暗号化ディスクを開く → ターミナルにコマンドを貼る → 開いたプレビューで絵と内容を確かめる → よければ y と入力します。", "hint"), line);
    actions.append(c);
  }
  const dup = button("複製"), discard = button("捨てる", "danger");
  dup.onclick = () => action(dup, async () => { const r = await api("/api/packs/drafts/duplicate", { draftId: d.draftId }); editing = r.draftId; await loadPacks(); });
  discard.onclick = async () => { if (await confirmAction("この下書きを捨てますか？", "下書きの画像は次回の整理で削除されます。")) await action(discard, async () => { await api("/api/packs/drafts/discard", { draftId: d.draftId }); await loadPacks(); }); };
  actions.append(dup, discard); card.append(actions); return card;
}

function render() {
  const step=editing?1:data.drafts.some(d=>d.state==="ready")?2:data.packs.some(p=>p.state==="signed")?3:1;
  for(const item of $("packs-steps").children){if(Number(item.dataset.step)===step)item.setAttribute("aria-current","step");else item.removeAttribute("aria-current");}
  const edit = editing && data.drafts.find(d => d.draftId === editing && d.state === "draft");
  $("packs-editor").replaceChildren(...(edit ? [editor(edit)] : []));
  $("packs-drafts").replaceChildren(...(data.drafts.length ? data.drafts.map(draftCard) : [el("p", "下書きはありません。", "empty")]));
  $("packs-signed").replaceChildren(...(data.packs.length ? data.packs.map(signedCard) : [el("p", "署名済みのパックはまだありません。", "empty")]));
  $("packs-storage").textContent = `${data.storage.objects} ファイル · ${kb(data.storage.bytes)}${data.storage.truncated ? "（ほかにもあります）" : ""}`;
}
export async function loadPacks() { data = await api("/api/packs"); render(); }
export function setupPacks() {
  $("packs-new").onsubmit = e => {
    e.preventDefault();
    action($("packs-start"), async () => { const r = await api("/api/packs/drafts", { packId: $("packs-id").value.trim() }); $("packs-id").value = ""; editing = r.draftId; await loadPacks(); });
  };
  $("refresh-packs").onclick = () => action($("refresh-packs"), loadPacks);
  $("packs-clean").onclick = async () => {
    if (!await confirmAction("古いファイルを整理しますか？", "販売していない古い版と、捨てた下書き・署名済み下書きの画像を整理します。友達の棚にあるパックの絵は、それぞれの Mac に残ります。")) return;
    await action($("packs-clean"), async () => { const r = await api("/api/packs/cleanup", { confirm: true }); notice(`${r.objects} ファイル（${kb(r.bytes)}）を整理しました。`); await loadPacks(); });
  };
}
