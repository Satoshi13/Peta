import { state, $, el, api, date, action, confirmAction, notice } from "./ui.js";
let catalog = null, order = [];
const localInput = seconds => { const d = new Date(seconds * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const seconds = value => Math.floor(new Date(value).getTime() / 1000);
const range = p => p.free ? null : [Math.ceil(p.price * catalog.limits.minPercent / 100), Math.floor(p.price * catalog.limits.maxPercent / 100)];
const title = id => catalog.packs.find(p => p.id === id)?.title || id;
function drawOrder() {
  $("shop-order").replaceChildren(...order.map((id, i) => {
    const up = el("button", "↑", "subtle"), down = el("button", "↓", "subtle");
    up.type = down.type = "button"; up.disabled = i === 0; down.disabled = i === order.length - 1;
    up.setAttribute("aria-label", `${title(id)}を上へ`); down.setAttribute("aria-label", `${title(id)}を下へ`);
    up.onclick = () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawOrder(); };
    down.onclick = () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawOrder(); };
    const li = el("li"); li.append(el("span", `${i + 1}. ${title(id)}`), up, down); return li;
  }));
}
/* The form starts from the setting in effect, so a save changes only what the owner touched. */
function fill(current) {
  $("shop-featured").replaceChildren(...catalog.packs.map(p => {
    const label = el("label", undefined, "check"), box = el("input"); box.type = "checkbox"; box.value = p.id; box.checked = !!current?.featured.includes(p.id);
    label.append(box, el("span", p.title)); return label;
  }));
  $("shop-official-first").checked = !!current?.officialFirst;
  order = [...(current?.order || []).filter(id=>catalog.packs.some(p=>p.id===id)), ...catalog.packs.map(p => p.id).filter(id => !current?.order?.includes(id))]; drawOrder();
  $("shop-packs").replaceChildren(...catalog.packs.map(p => {
    const saved = current?.packs.find(x => x.id === p.id), row = el("div", undefined, "shop-pack"), r = range(p);
    const sale = el("input"), price = el("input"), blurb = el("input"), saleLabel = el("label", undefined, "check"), priceLabel = el("label", r ? `価格（${r[0]}〜${r[1]} Scraps）` : "価格"), blurbLabel = el("label", "Market の説明（任意）"), fields = el("div", undefined, "fields");
    sale.type = "checkbox"; sale.checked = saved ? saved.onSale : true; sale.dataset.pack = p.id; sale.className = "shop-sale";
    price.type = "number"; price.step = 1; price.placeholder = r ? `${p.price}（署名済み）` : "無料"; price.disabled = !r; price.value = saved?.price ?? ""; price.dataset.pack = p.id; price.className = "shop-price";
    if (r) { price.min = r[0]; price.max = r[1]; }
    blurb.maxLength = catalog.limits.blurbMax; blurb.placeholder = "署名済みの説明を使う"; blurb.value = saved?.blurb ?? ""; blurb.dataset.pack = p.id; blurb.className = "shop-blurb";
    saleLabel.append(sale, el("span", "ショップに並べる")); priceLabel.append(price); blurbLabel.append(blurb); fields.append(priceLabel, blurbLabel);
    row.append(el("h4", `${p.title}${p.free ? " · 無料" : ""}`), saleLabel, fields); return row;
  }));
}
function read() {
  const kind = document.querySelector('input[name="shop-kind"]:checked').value, packs = [];
  for (const p of catalog.packs) {
    const sale = document.querySelector(`.shop-sale[data-pack="${p.id}"]`).checked, price = document.querySelector(`.shop-price[data-pack="${p.id}"]`).value, blurb = document.querySelector(`.shop-blurb[data-pack="${p.id}"]`).value.trim();
    const r = range(p), n = price === "" ? null : Number(price);
    if (n !== null && (!r || !Number.isInteger(n) || n < r[0] || n > r[1])) throw new Error(`${p.title} は ${r?.[0]}〜${r?.[1]} Scraps で入力するか、空欄にしてください。`);
    // Only packs that differ from the built-in shop are listed.
    if (!sale || n !== null || blurb) packs.push({ id: p.id, onSale: sale, price: n, blurb: blurb || null });
  }
  return { kind, featured: [...$("shop-featured").querySelectorAll("input:checked")].map(b => b.value), officialFirst: $("shop-official-first").checked, order, packs,
    ...(kind === "event" ? { startsAt: seconds($("shop-starts").value), endsAt: seconds($("shop-ends").value) } : {}) };
}
export async function loadShop() {
  const data = await api("/api/shop"); catalog = {...data.catalog,packs:data.catalog.packs.filter(p=>p.shop)};
  fill(data.configs.find(c => c.state === "active" && c.kind === "event") || data.configs.find(c => c.state === "active"));
  $("shop-list").replaceChildren();
  if (!data.configs.length) $("shop-list").append(el("p", "ショップ設定はまだありません。署名済みパックの内容で表示します。", "empty"));
  for (const c of data.configs) {
    const card = el("article", undefined, "card"), head = el("div", undefined, "card-head");
    head.append(el("h3", c.kind === "event" ? "期間限定" : "常設設定"), el("span", state(c.state), "tag"));
    card.append(head, el("p", `Featured: ${c.featured.map(title).join(", ") || "表示しない"}${c.officialFirst ? " · 公式を優先" : ""}`),
      el("p", c.packs.map(p => `${title(p.id)}: ${p.onSale ? p.price ?? "署名済みの価格" : "掲載しない"}`).join(" · ") || "署名済みの価格"), el("p", `${date(c.startsAt)} – ${date(c.endsAt)}`, "hint"));
    if (["active", "scheduled"].includes(c.state)) {
      const stop = el("button", "停止", "danger"); stop.type = "button";
      stop.onclick = async () => { if (await confirmAction("このショップ設定を停止しますか？", "次回の取得後、常設設定または署名済みパックの内容に戻ります。")) await action(stop, async () => { await api("/api/shop/stop", { id: c.id }); notice("ショップ設定を停止しました。"); await loadShop(); }); };
      card.append(stop);
    }
    $("shop-list").append(card);
  }
}
export function setupShop() {
  const t = Math.floor(Date.now() / 1000);
  $("shop-starts").value = localInput(t); $("shop-ends").value = localInput(t + 7 * 86400);
  for (const radio of document.querySelectorAll('input[name="shop-kind"]')) radio.onchange = () => { $("shop-period").hidden = radio.value !== "event" || !radio.checked; };
  $("shop-form").onsubmit = event => {
    event.preventDefault(); $("shop-error").textContent = "";
    let body; try { body = read(); } catch (error) { $("shop-error").textContent = error.message; return; }
    action($("save-shop"), async () => { await api("/api/shop", body); notice("ショップ設定を保存しました。"); await loadShop(); });
  };
  $("refresh-shop").onclick = () => action($("refresh-shop"), loadShop);
}
