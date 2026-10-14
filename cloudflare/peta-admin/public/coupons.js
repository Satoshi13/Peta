import { $, el, api, date, itemsText, copy, action, confirmAction, notice } from "./ui.js";
let catalog = [], draft = null, issued = null;
const kinds = { scraps: "Scraps", envelope: "Envelopes", material: "Material", tool: "Tool", pack: "Pack" };
function itemRow() {
  if ($("items").children.length >= 10) return;
  const row = el("div", undefined, "item"), kindLabel = el("label", "Kind", "kind"), idLabel = el("label", "Item"), countLabel = el("label", "Count"), kind = el("select"), id = el("select"), count = el("input"), cap = el("small"), remove = el("button", "×", "subtle remove");
  kind.setAttribute("aria-label", "Item kind"); id.setAttribute("aria-label", "Item choice"); count.setAttribute("aria-label", "Item count");
  for (const [value, label] of Object.entries(kinds)) { const o = el("option", label); o.value = value; kind.append(o); }
  count.type = "number"; count.min = "1"; count.step = "1"; count.required = true; count.value = "1";
  remove.type = "button"; remove.setAttribute("aria-label", "Remove item");
  const updateCap = () => { const option = catalog.find(o => o.kind === kind.value && o.id === id.value); count.max = String(option?.cap ?? 0); cap.textContent = `Up to ${option?.cap ?? 0}`; };
  kind.onchange = () => { id.replaceChildren(); for (const choice of catalog.filter(o => o.kind === kind.value)) { const o = el("option", choice.id || kinds[kind.value]); o.value = choice.id; id.append(o); } updateCap(); };
  id.onchange = updateCap; remove.onclick = () => { row.remove(); $("add-item").disabled = false; };
  kindLabel.append(kind); idLabel.append(id); countLabel.append(count, cap); row.append(kindLabel, idLabel, countLabel, remove);
  row.read = () => ({ kind: kind.value, id: id.value, count: Number(count.value) });
  $("items").append(row); kind.onchange(); $("add-item").disabled = $("items").children.length >= 10;
}
function localDay(value) { const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d); }
function formData() {
  const items = [...$("items").children].map(row => row.read());
  if (!items.length || new Set(items.map(g => `${g.kind}:${g.id}`)).size !== items.length) throw new Error("Give 1 to 10 different things. Each item appears once.");
  for (const g of items) { const choice = catalog.find(c => c.kind === g.kind && c.id === g.id); if (!choice || !Number.isInteger(g.count) || g.count < 1 || g.count > choice.cap) throw new Error("Choose a count within each item's limit."); }
  const end = localDay($("ends").value); end.setDate(end.getDate() + 1);
  const start = $("starts").value ? new Date($("starts").value) : new Date();
  if (!Number.isFinite(end.getTime()) || end <= start || end <= new Date()) throw new Error("Choose an end after the start and after now.");
  return { name: $("coupon-name").value.trim().toUpperCase(), items, startsAt: $("starts").value ? Math.floor(start.getTime() / 1000) : null, endsAt: Math.floor(end.getTime() / 1000), maxClaims: $("limit").value ? Number($("limit").value) : null, title: $("title").value.trim(), message: $("message").value };
}
function detail(c) { return `${itemsText(c.items)}\nFrom ${date(c.startsAt)} through ${date(c.endsAt - 1)}\n${c.maxClaims == null ? "No limit" : `First ${c.maxClaims} Macs`}`; }
function discord(c) { return `## 🎁 ${c.title}\nPeta の **Redeem Code…** に  \`${c.name}\`  と入れてください。\n${itemsText(c.items)}\n${date(c.endsAt - 1)} まで${c.maxClaims == null ? "" : `・先着${c.maxClaims}台`}(Mac 1台につき1回)${c.message ? `\n${c.message}` : ""}`; }
export async function loadCoupons() {
  const data = await api("/api/coupons"); catalog = data.catalog;
  if (!$("items").children.length) itemRow(); $("add-item").disabled = $("items").children.length >= 10; $("preview-coupon").disabled = false;
  $("coupon-list").replaceChildren();
  if (!data.coupons.length) $("coupon-list").append(el("p", "No coupons yet. A small gift starts here.", "empty"));
  for (const c of data.coupons) {
    const card = el("article", undefined, "card"), heading = el("div", undefined, "card-head"), controls = el("div", undefined, "actions"), share = el("button", "Copy Discord message", "subtle"), stop = el("button", "Stop", "danger");
    heading.append(el("h3", c.name), el("span", c.state, "tag")); card.append(heading, el("p", c.readable ? itemsText(c.items) : "Signed content couldn't be displayed."), el("p", `${date(c.startsAt)} → ${date(c.endsAt - 1)}`, "hint"), el("p", `${c.claims} received · ${c.maxClaims == null ? "No limit" : `${c.maxClaims} Macs maximum`}`, "hint"));
    share.type = stop.type = "button"; share.onclick = () => action(share, () => copy(discord(c))); share.disabled = !c.readable;
    stop.disabled = c.state === "stopped"; stop.onclick = async () => { if (await confirmAction(`Stop ${c.name}?`, "Future claims will stop. Gifts already received stay with their owners.")) await action(stop, async () => { await api("/api/coupons/stop", { name: c.name }); notice("Coupon stopped."); await loadCoupons(); }); };
    controls.append(share, stop); card.append(controls); $("coupon-list").append(card);
  }
}
export function setupCoupons() {
  const defaultEnd = new Date(); defaultEnd.setDate(defaultEnd.getDate() + 14);
  $("ends").value = `${defaultEnd.getFullYear()}-${String(defaultEnd.getMonth() + 1).padStart(2, "0")}-${String(defaultEnd.getDate()).padStart(2, "0")}`;
  $("timezone").textContent = `Times use ${Intl.DateTimeFormat().resolvedOptions().timeZone}. The last day includes the whole day.`;
  $("coupon-name").oninput = () => { $("coupon-name").value = $("coupon-name").value.toUpperCase(); };
  $("add-item").onclick = itemRow;
  $("coupon-form").onsubmit = event => { event.preventDefault(); try { draft = formData(); $("review-name").textContent = draft.name; $("review-details").replaceChildren(...detail(draft).split("\n").map(line => el("p", line)), el("h3", draft.title), el("p", draft.message)); $("review").showModal(); } catch (error) { notice(error.message, true); } };
  $("cancel-review").onclick = () => $("review").close();
  $("issue-coupon").onclick = () => action($("issue-coupon"), async () => { issued = await api("/api/coupons", draft); $("review").close(); $("issued").hidden = false; $("issued-name").textContent = issued.name; $("issued-detail").textContent = itemsText(issued.items); $("coupon-name").value = ""; notice("Coupon issued. Copy its message to share it."); await loadCoupons(); });
  $("copy-coupon").onclick = () => action($("copy-coupon"), () => copy(discord(issued)));
  $("refresh-coupons").onclick = () => action($("refresh-coupons"), loadCoupons);
  $("stop-all").onclick = async () => { if (await confirmAction("Stop every coupon?", "This includes coupons created with the offline signing tool. Already received gifts stay with their owners.")) await action($("stop-all"), async () => { await api("/api/coupons/stop-all", { confirm: true }); notice("All coupons stopped."); await loadCoupons(); }); };
}
