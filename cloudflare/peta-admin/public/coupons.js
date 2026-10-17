import { state, $, el, api, date, itemsText, copy, action, confirmAction, notice, materialName } from "./ui.js";
let catalog = [], draft = null, issued = null;
const kinds = { scraps: "Scraps", envelope: "追加の封筒", material: "素材", tool: "ツール", pack: "パック" };
function itemRow() {
  if ($("items").children.length >= 10) return;
  const row = el("div", undefined, "item"), kindLabel = el("label", "種類", "kind"), idLabel = el("label", "内容"), countLabel = el("label", "数量"), kind = el("select"), id = el("select"), count = el("input"), cap = el("small"), remove = el("button", "×", "subtle remove");
  kind.setAttribute("aria-label", "内容の種類"); id.setAttribute("aria-label", "アイテムの選択"); count.setAttribute("aria-label", "数量");
  for (const [value, label] of Object.entries(kinds)) { const o = el("option", label); o.value = value; kind.append(o); }
  count.type = "number"; count.min = "1"; count.step = "1"; count.required = true; count.value = "1";
  remove.type = "button"; remove.setAttribute("aria-label", "アイテムを削除");
  const updateCap = () => { const option = catalog.find(o => o.kind === kind.value && o.id === id.value); count.max = String(option?.cap ?? 0); cap.textContent = `上限 ${option?.cap ?? 0}`; };
  kind.onchange = () => { id.replaceChildren(); for (const choice of catalog.filter(o => o.kind === kind.value)) { const o = el("option", kind.value === "material" ? materialName(choice.id) : ({board:"ボード","link-tag":"リンクタグ"})[choice.id] || choice.id || kinds[kind.value]); o.value = choice.id; id.append(o); } updateCap(); };
  id.onchange = updateCap; remove.onclick = () => { row.remove(); $("add-item").disabled = false; };
  kindLabel.append(kind); idLabel.append(id); countLabel.append(count, cap); row.append(kindLabel, idLabel, countLabel, remove);
  row.read = () => ({ kind: kind.value, id: id.value, count: Number(count.value) });
  $("items").append(row); kind.onchange(); $("add-item").disabled = $("items").children.length >= 10;
}
function localDay(value) { const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d); }
function formData() {
  const items = [...$("items").children].map(row => row.read());
  if (!items.length || new Set(items.map(g => `${g.kind}:${g.id}`)).size !== items.length) throw new Error("異なるアイテムを1～10個指定してください。同じアイテムは1回だけ指定できます。");
  for (const g of items) { const choice = catalog.find(c => c.kind === g.kind && c.id === g.id); if (!choice || !Number.isInteger(g.count) || g.count < 1 || g.count > choice.cap) throw new Error("各アイテムの上限以内で数量を指定してください。"); }
  const end = localDay($("ends").value); end.setDate(end.getDate() + 1);
  const start = $("starts").value ? new Date($("starts").value) : new Date();
  if (!Number.isFinite(end.getTime()) || end <= start || end <= new Date()) throw new Error("終了日時は開始日時および現在時刻より後にしてください。");
  return { name: $("coupon-name").value.trim().toUpperCase(), items, startsAt: $("starts").value ? Math.floor(start.getTime() / 1000) : null, endsAt: Math.floor(end.getTime() / 1000), maxClaims: $("limit").value ? Number($("limit").value) : null, title: $("title").value.trim(), message: $("message").value };
}
function detail(c) { return `${itemsText(c.items)}\n${date(c.startsAt)} 〜 ${date(c.endsAt - 1)}\n${c.maxClaims == null ? "上限なし" : `先着 ${c.maxClaims} 台`}`; }
function discord(c) { return `## 🎁 ${c.title}\nPeta の **Redeem Code…** に  \`${c.name}\`  と入れてください。\n${itemsText(c.items)}\n${date(c.endsAt - 1)} まで${c.maxClaims == null ? "" : `・先着${c.maxClaims}台`}(Mac 1台につき1回)${c.message ? `\n${c.message}` : ""}`; }
export async function loadCoupons() {
  const data = await api("/api/coupons"); catalog = data.catalog;
  if (!$("items").children.length) itemRow(); $("add-item").disabled = $("items").children.length >= 10; $("preview-coupon").disabled = false;
  $("coupon-list").replaceChildren();
  if (!data.coupons.length) $("coupon-list").append(el("p", "クーポンはまだありません。ここから小さな贈り物を始められます。", "empty"));
  for (const c of data.coupons) {
    const card = el("article", undefined, "card"), heading = el("div", undefined, "card-head"), controls = el("div", undefined, "actions"), share = el("button", "Discord用メッセージをコピー", "subtle"), stop = el("button", "停止", "danger");
    heading.append(el("h3", c.name), el("span", state(c.state), "tag")); card.append(heading, el("p", c.readable ? itemsText(c.items) : "署名済みの内容を表示できませんでした。"), el("p", `${date(c.startsAt)} → ${date(c.endsAt - 1)}`, "hint"), el("p", `${c.claims} 台が受取済み · ${c.maxClaims == null ? "上限なし" : `最大 ${c.maxClaims} 台`}`, "hint"));
    share.type = stop.type = "button"; share.onclick = () => action(share, () => copy(discord(c))); share.disabled = !c.readable;
    stop.disabled = c.state === "stopped"; stop.onclick = async () => { if (await confirmAction(`${c.name} を停止しますか？`, "これからの受取を停止します。受取済みの Gift は持ち主の手元に残ります。")) await action(stop, async () => { await api("/api/coupons/stop", { name: c.name }); notice("クーポンを停止しました。"); await loadCoupons(); }); };
    controls.append(share, stop); card.append(controls); $("coupon-list").append(card);
  }
}
export function setupCoupons() {
  const defaultEnd = new Date(); defaultEnd.setDate(defaultEnd.getDate() + 14);
  $("ends").value = `${defaultEnd.getFullYear()}-${String(defaultEnd.getMonth() + 1).padStart(2, "0")}-${String(defaultEnd.getDate()).padStart(2, "0")}`;
  $("timezone").textContent = `入力時刻のタイムゾーン：${Intl.DateTimeFormat().resolvedOptions().timeZone}。最終日は23:59まで含みます。表示日時は日本時間です。`;
  $("coupon-name").oninput = () => { $("coupon-name").value = $("coupon-name").value.toUpperCase(); };
  $("add-item").onclick = itemRow;
  $("coupon-form").onsubmit = event => { event.preventDefault(); try { draft = formData(); $("review-status").textContent = ""; $("review-name").textContent = draft.name; $("review-details").replaceChildren(...detail(draft).split("\n").map(line => el("p", line)), el("h3", draft.title), el("p", draft.message)); $("review").showModal(); } catch (error) { notice(error.message, true); } };
  $("cancel-review").onclick = () => $("review").close();
  $("issue-coupon").onclick = () => action($("issue-coupon"), async () => { try { issued = await api("/api/coupons", draft); } catch (error) { $("review-status").textContent = error.message; throw error; } $("review").close(); $("issued").hidden = false; $("issued-name").textContent = issued.name; $("issued-detail").textContent = itemsText(issued.items); $("coupon-name").value = ""; notice("クーポンを発行しました。メッセージをコピーして共有してください。"); await loadCoupons(); });
  $("copy-coupon").onclick = () => action($("copy-coupon"), () => copy(discord(issued)));
  $("refresh-coupons").onclick = () => action($("refresh-coupons"), loadCoupons);
  $("stop-all").onclick = async () => { if (await confirmAction("すべてのクーポンを停止しますか？", "オフラインの署名ツールで作ったクーポンも停止します。受取済みの Gift は持ち主の手元に残ります。")) await action($("stop-all"), async () => { await api("/api/coupons/stop-all", { confirm: true }); notice("すべてのクーポンを停止しました。"); await loadCoupons(); }); };
}
