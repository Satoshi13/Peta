/* Shared page pieces + the Today page: envelope -> reveal -> the four ways to make today's Peta. */
function PageHead(title, sub, ...extra) {
  return h("header.ph", h("div.ph-text", h("p.eyebrow", sub || ""), h("h1", title)), h("div.ph-extra", ...extra));
}
const DateStamp = () => h("span.datestamp", fmtDate(S.today, { month: "short", day: "numeric" }) + " · " + fmtDate(S.today, { weekday: "short" }));
const usableMats = () => Object.keys(MAT).filter((id) => !MAT[id].locked && (MAT[id].unlimited || S.stock[id] > 0));

/** The active choice is circled along a pen stroke; the decorative SVG never affects text layout. */
function SegButton(label, props) {
  const ns = "http://www.w3.org/2000/svg", ring = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({ class:"seg-ring", viewBox:"0 0 120 48", preserveAspectRatio:"none", "aria-hidden":"true", focusable:"false" })) ring.setAttribute(key, value);
  const strokes = [
    ["M17 10C40 3 92 3 108 14C119 22 112 38 90 41C62 46 26 44 12 34C3 26 8 14 30 8C46 4 62 4 76 6", "2.6"],
    ["M26 6C52 1 101 7 111 21C116 32 99 42 72 43C45 45 15 40 9 28C6 18 17 10 36 7", "1.3"],
  ];
  for (const [d, width] of strokes) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d); path.setAttribute("pathLength", "1"); path.setAttribute("stroke-width", width);
    ring.append(path);
  }
  return h("button", props, h("span.seg-label", label), ring);
}

/** A tray of material cards. Picking marks the material for the next Create without moving the controls. */
function MaterialTray({ w = 148, onPick, interactive = true, selected = S.chosen } = {}) {
  const tray = h("div.mtray", { role: "radiogroup", "aria-label": "Material" });
  if(usableMats().includes(selected)) S.chosen=selected;
  const render = () => {
    const ids=usableMats(), sel=ids.includes(S.chosen) ? S.chosen : ids[0]; S.chosen=sel;
    tray.replaceChildren(...ids.map(id => {
      const m=MAT[id], on=id===sel;
      return h("button.material-plate", {role:"radio", "aria-checked":String(on), tabindex:on ? 0 : -1, data:{m:id,sel:on}, vars:{"--w":w+"px"}, disabled:!interactive,
        on:{click:()=>{
          if(S.chosen===id) return;
          S.chosen=id; Snd.tap(); $$("[role=radio]",tray).forEach(b=>{const selected=b.dataset.m===id;b.dataset.sel=String(selected);b.setAttribute("aria-checked",String(selected));b.tabIndex=selected ? 0 : -1;}); onPick?.(id);
        }}}, MaterialPlateContents(m));
    }));
  };
  tray.addEventListener("keydown", e=>{
    if(!interactive || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key)) return;
    e.preventDefault(); const buttons=$$("[role=radio]",tray), i=buttons.indexOf(e.target);
    const next=e.key==="Home" ? 0 : e.key==="End" ? buttons.length-1 : (i+(["ArrowLeft","ArrowUp"].includes(e.key) ? -1 : 1)+buttons.length)%buttons.length;
    buttons[next]?.click();buttons[next]?.focus();
  });
  render(); tray.rerender=render; return tray;
}
function MaterialPlateContents(m, stock = m.unlimited ? "∞" : `${S.stock[m.id]} left`) {
  return [MaterialSwatch(m), h("b",m.name), h("small",stock)];
}

const CHOICES = [
  { id: "create", key: "chCreate", label: "Create", sub: "From an image you pick" },
  { id: "book", key: "chCollection", label: "Collection", sub: "Stick one you already have" },
  { id: "gifts", key: "chGift", label: "Gift", sub: () => { const n = S.gifts.filter((g) => !g.opened).length; return n ? `${n} waiting` : "Open one that arrived"; } },
  { id: "packs", key: "chPack", label: "Pack", sub: () => { const n = S.packs.filter(p=>packOpenable(p) || packHasFreeOpening(p)).length; return n ? "Open one at random" : S.packs.some((p) => p.left.length) ? "Welcome Pack: back tomorrow" : "All opened"; } },
];
function Choices({ compact, hero = false, more = false } = {}) {
  const list = more ? CHOICES.filter((c) => c.id !== "create") : CHOICES;
  return h("div.choices" + (compact ? ".compact" : hero ? ".featured" : more ? ".more" : ""), list.map((c, i) => {
    const sub = typeof c.sub === "function" ? c.sub() : c.sub, off = c.id === "packs" && !S.packs.some(p=>packOpenable(p) || packHasFreeOpening(p));
    return h("button.choice" + (hero && c.id === "create" ? ".hero" : ""), { disabled: off, style: { "--i": i }, data: { id: c.id },
      on: { click: (e) => { Snd.tap(); if (c.id === "book") S.pickMode = true; Shell.go(c.id, { origin: e.currentTarget, via: "object" }); } } },
      hero && c.id === "create" ? h("span.choice-copy", h("b", "Create"), h("small", "Turn any image into a sticker, cut out on the mat."), h("span.btn.small.choice-cta", "Choose image")) : null,
      h("span.choice-obj", { style: { backgroundImage: `var(--a-${c.key})` } }), hero && c.id === "create" ? null : h("b", c.label), compact || (hero && c.id === "create") ? null : h("small", hero && c.id === "book" ? "Stick one you own" : sub),
      (hero || more) && c.id === "gifts" && S.gifts.some(g=>!g.opened) ? h("span.choice-count", String(S.gifts.filter(g=>!g.opened).length)) : null);
  }));
}

function MaterialSwatch(m) {
  return h("i.material-swatch", {"aria-hidden":"true",data:{m:m.id},style:m.sw || m.card ? {backgroundImage:`var(--a-${m.sw || m.card})`} : {}});
}

/** A material card that is just something to look at (not a control). */
function MatCard(m, w = 132) {
  const c = h("div.mcard", { data: { m: m.id }, vars: { "--w": w + "px" } }, h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)));
  Stk.tilt(c, { max: 9, scale: 1.03 }); return c;
}
function StuckStrip() {
  const strip = h("div.stuck-strip");
  if (!S.stuckToday.length) return strip.append(h("div.stuck-empty", h("b", "Nothing stuck yet"), h("small.muted", "Your desktop is waiting."))), strip;
  S.stuckToday.forEach((id, i) => { const e = S.lib.find((l) => l.id === id); if (!e) return; const t = h("div.stuck-t", { style: { "--i": i } }); resOf(e, { max: 360 }).then((res) => t.append(Stk.el(res, res.aspect >= 1 ? 74 : 74 * res.aspect))); strip.append(t); });
  return strip;
}

function EnvelopeScene() {
  return h("div.env-scene", { role: "button", tabindex: 0, "aria-label": "Open today's material" },
    h("div.env-lift", h("div.env-float",
      img("envBack", "layer back"), img("envCard", "layer card"),
      h("span.layer.pocket", img("envPocket"), h("span.env-label", "Today's", h("br"), "Material")),
      img("envFlap", "layer flap"))));
}
function RevealScene(m) {
  const card = h("div.mcard.big", { data: { m: m.id }, vars: { "--w": "300px" } }, h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)));
  return h("div.reveal-scene", { data: { m: m.id, rarity: m.rarity } },
    h("i.glow"), img("foilBack", "layer foil-back"), h("div.card-hold", card), img("foilFront", "layer foil-front"), h("i.sparkle"));
}


function EnvelopeTicket() {
  return h("p.envelope-ticket", { role: "timer", "aria-label": "Next envelope" }, h("span", "Next envelope in "), h("span.envelope-clock", Array.from("00:00:00", digit => h("span", digit))));
}

/* A single confirmation flow for unused sheets and the local Market. Prices come from Rust. */
const Scraps = {
  selection: null, inFlight: false,
  material(id) { return S.scraps.materials.find(m => m.id === id); },
  pack(id) { return S.scraps.packs.find(p => p.id === id); },
  badge() { return h("span.scraps-count", {"aria-label":`${S.scraps.balance.toLocaleString("en-US")} Scraps`}, h("span", "Scraps"), h("b", S.scraps.balance.toLocaleString("en-US"))); },
  button(kind, id, label, disabled = false) {
    return h("button.btn.paper.small.scrap-action", { disabled:disabled || this.inFlight, data:{scrapKind:kind,scrapItem:id}, on:{click:() => {
      if(this.inFlight) return;
      this.selection = {kind,itemId:id,quantity:1,request:null,error:""}; Snd.tap(); Shell.refresh();
      const form = $(".scrap-trade"); if(form) { form.closest(".page-in").scrollTop = 0; (form.querySelector("input") || form).focus({preventScroll:true}); }
    }} }, label);
  },
  finish() {
    const selected = this.selection; this.selection = null; Shell.refresh();
    const trigger = selected && $(`[data-scrap-kind="${selected.kind}"][data-scrap-item="${selected.itemId}"]:not(:disabled)`);
    (trigger || $(`#nav [data-page="${S.page}"]`))?.focus({preventScroll:true});
  },
  form() {
    const sel = this.selection;
    if(!sel || (sel.kind === "dismantle" ? S.page !== "materials" : S.page !== "market")) return null;
    const dismantle = sel.kind === "dismantle", pack = sel.kind === "pack", owned = pack && !!S.owned[sel.itemId], rate = pack ? this.pack(sel.itemId) : this.material(sel.itemId);
    if(!rate || (!dismantle && !pack && rate.exchange == null)) return null;
    const name = pack ? MARKET_PACKS.find(p=>p.id===sel.itemId).title : MAT[sel.itemId].name;
    const price = S.developer && !dismantle ? 0 : dismantle ? rate.dismantle : rate.exchange;
    const roomForPack = pack && S.packs.reduce((n,p)=>p.id===sel.itemId ? p.left.length : n, 0) + rate.stickers <= PACK_SEALED_CAP;
    const max = S.developer ? (pack ? +roomForPack : 1000) : pack ? (roomForPack && S.scraps.balance >= price ? 1 : 0) : Math.min(1000, dismantle ? S.stock[sel.itemId] : Math.floor(S.scraps.balance/price));
    const count = h("input", {type:"number",min:1,max:Math.max(1,max),step:1,value:sel.quantity,required:true,disabled:this.inFlight || !!sel.error,"aria-label":"Number of sheets"});
    const receive = h("b"), cost = h("b"), remaining = h("b"), stock = h("p.muted.small"), error = h("p.scrap-error", {role:"status"}, sel.error);
    const submit = h("button.btn.scrap-action", {type:"submit"}, dismantle ? "Dismantle" : "Exchange");
    const cancel = h("button.btn.paper.scrap-action", {type:"button",disabled:this.inFlight,on:{click:()=>this.finish()}}, "Cancel");
    const update = () => {
      const q = Number(count.value), retry = !!sel.error && sel.request?.trade.quantity === q;
      const valid = retry || (count.value !== "" && Number.isInteger(q) && q >= 1 && q <= max);
      sel.quantity = q; submit.disabled = !valid || this.inFlight;
      submit.textContent = retry ? "Retry" : dismantle ? "Dismantle" : "Exchange"; cancel.textContent = retry ? "Close" : "Cancel";
      receive.textContent = valid ? dismantle ? `${q*price} ${q*price===1 ? "Scrap" : "Scraps"}` : pack ? `${rate.stickers} stickers` : `${q} ${q===1 ? "sheet" : "sheets"}` : "—";
      cost.textContent = valid ? `${q*price} Scraps` : "—";
      remaining.textContent = valid ? ((retry ? sel.balanceBefore : S.scraps.balance) + (dismantle ? 1 : -1)*q*price).toLocaleString("en-US") : "—";
      stock.textContent = S.developer ? (dismantle ? "Developer materials never run out." : "Developer stock is unlimited. No Scraps are spent.") : retry ? "Retry checks the same request without spending twice." : pack ? (S.owned[sel.itemId] ? `Adds ${rate.stickers} sealed stickers to the same bag. Opened stickers stay in your Collection.` : "Adds this pack to your Packs shelf.") : valid ? `${S.stock[sel.itemId] + (dismantle ? -q : q)} ${name} sheets left after ${dismantle ? "dismantling" : "exchange"}.` : `Choose ${max ? `1–${max} sheets` : "a different material or collect more Scraps"}.`;
    };
    count.addEventListener("input", update); update();
    const form = h("form.scrap-trade", {tabindex:-1,"aria-label":dismantle ? "Confirm material dismantling" : "Confirm exchange", on:{
      keydown:ev => { if(ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); if(!this.inFlight) this.finish(); } },
      submit:async ev => {
        ev.preventDefault(); if(submit.disabled || this.inFlight) return;
        const trade = {kind:sel.kind,itemId:sel.itemId,quantity:sel.quantity};
        if(!sel.request || JSON.stringify(sel.request.trade)!==JSON.stringify(trade)) {
          sel.request = {trade,requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join("")}; sel.balanceBefore = S.scraps.balance;
        }
        this.inFlight = true; Bridge.busy = true; count.disabled = true; submit.disabled = true; cancel.disabled = true; sel.error = ""; error.textContent = "";
        try {
          const receipt = await Bridge.invoke("scrap_trade", sel.request); await Bridge.reload();
          this.inFlight = false; this.finish(); Snd.chime(2,740); Shell.toast(S.developer ? "Developer exchange completed." : dismantle ? `${receipt.delta} ${receipt.delta===1 ? "Scrap" : "Scraps"} saved.` : pack ? (owned ? `Another set of ${name} is in the bag.` : `${name} is on your shelf.`) : `${name} sheets added.`);
        } catch(e) { sel.error = String(e); error.textContent = sel.error; }
        finally { this.inFlight = false; Bridge.busy = false; count.disabled = !!sel.error; cancel.disabled = false; update(); }
      }
    }}, h("div.scrap-trade-head", h("h2", `${dismantle ? "Dismantle" : owned ? "Add another set of" : "Exchange for"} ${name}`), h("small.muted", `${price} ${price===1 ? "Scrap" : "Scraps"} ${pack ? "per pack" : "per sheet"}`)),
      h("div.scrap-summary" + (dismantle ? "" : ".has-cost"), pack ? h("div", h("span.muted.small", "Pack"), h("b", "1 pack")) : h("label", "Sheets", count),
        h("div", h("span.muted.small", "Receive"), receive), dismantle ? null : h("div", h("span.muted.small", "Spend"), cost), h("div", h("span.muted.small", "Scraps after"), remaining)), stock, error,
      h("div.scrap-actions", cancel, submit));
    return form;
  },
};
