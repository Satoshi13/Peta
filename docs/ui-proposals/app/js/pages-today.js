/* Shared page pieces + the Today page: envelope -> reveal -> the four ways to make today's Peta. */
function PageHead(title, sub, ...extra) {
  return h("header.ph", h("div.ph-text", h("p.eyebrow", sub || ""), h("h1", title)), h("div.ph-extra", ...extra));
}
const DateStamp = () => h("span.datestamp", fmtDate(S.today, { month: "short", day: "numeric" }) + " · " + fmtDate(S.today, { weekday: "short" }));
const usableMats = () => ["matte", "kraft", "holographic", "gold", "riso", "vintage"].filter((id) => !MAT[id].locked && (MAT[id].unlimited || S.stock[id] > 0));

/** A tray of material cards. Picking lifts one and tapes it down; it is what the next Create is made of. */
function MaterialTray({ w = 148, onPick, interactive = true, selected = S.chosen } = {}) {
  const tray = h("div.mtray", { role: "radiogroup", "aria-label": "Material" });
  const render = () => {
    const sel = usableMats().includes(S.chosen) ? S.chosen : usableMats()[0]; S.chosen = sel;
    tray.replaceChildren(...usableMats().map((id, i) => {
      const m = MAT[id], on = id === sel;
      const c = h("button.mcard", { role: "radio", "aria-checked": String(on), data: { m: id, sel: on }, vars: { "--w": w + "px", "--r": [-3, 2, -1.5][i % 3] + "deg" }, disabled: !interactive,
        on: { click: () => { if (S.chosen === id) return; S.chosen = id; Snd.tap(); render(); onPick && onPick(id); } } },
        h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)), m.unlimited ? null : h("span.cnt", "×" + S.stock[id]), on ? h("i.tape.t1") : null);
      Stk.tilt(c, { max: 8, scale: 1 }); return c;
    }));
  };
  render(); tray.rerender = render; return tray;
}

const CHOICES = [
  { id: "create", key: "chCreate", label: "Create", sub: "From an image you pick" },
  { id: "book", key: "chCollection", label: "Collection", sub: "Stick one you already have" },
  { id: "gifts", key: "chGift", label: "Gift", sub: () => { const n = S.gifts.filter((g) => !g.opened).length; return n ? `${n} waiting` : "Open one that arrived"; } },
  { id: "packs", key: "chPack", label: "Pack", sub: () => { const n = S.packs.filter(packOpenable).length; return n ? "Open one at random" : S.packs.some((p) => p.left.length) ? "Welcome Pack: back tomorrow" : "All opened"; } },
];
function Choices({ compact } = {}) {
  return h("div.choices" + (compact ? ".compact" : ""), CHOICES.map((c, i) => {
    const sub = typeof c.sub === "function" ? c.sub() : c.sub, off = c.id === "packs" && !S.packs.some(packOpenable);
    return h("button.choice", { disabled: off, style: { "--i": i }, data: { id: c.id },
      on: { click: (e) => { Snd.tap(); if (c.id === "book") S.pickMode = true; Shell.go(c.id, { origin: e.currentTarget, via: "object" }); } } },
      h("span.choice-obj", { style: { backgroundImage: `var(--a-${c.key})` } }), h("b", c.label), compact ? null : h("small", sub));
  }));
}

/** A material card that is just something to look at (not a control). */
function MatCard(m, w = 132) {
  const c = h("div.mcard", { data: { m: m.id }, vars: { "--w": w + "px" } }, h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)));
  Stk.tilt(c, { max: 9, scale: 1.03 }); return c;
}
function StuckStrip() {
  const strip = h("div.stuck-strip");
  if (!S.stuckToday.length) return strip.append(h("p.hand.empty-note", "Nothing stuck yet — your desktop is waiting.")), strip;
  S.stuckToday.forEach((id, i) => { const e = S.lib.find((l) => l.id === id); if (!e) return; const t = h("div.stuck-t", { style: { "--i": i } }); resOf(e, { max: 360 }).then((res) => t.append(Stk.el(res, res.aspect >= 1 ? 74 : 74 * res.aspect))); strip.append(t); });
  return strip;
}

function EnvelopeScene() {
  return h("div.env-scene", { role: "button", tabindex: 0, "aria-label": "Open today's material" },
    h("div.env-float",
      img("envBack", "layer back"), img("envCard", "layer card"),
      h("span.layer.pocket", img("envPocket"), h("span.env-label", "Today's", h("br"), "Material")),
      img("envFlap", "layer flap")));
}
function RevealScene(m) {
  const card = h("div.mcard.big", { data: { m: m.id }, vars: { "--w": "300px" } }, h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)));
  return h("div.reveal-scene", { data: { m: m.id, rarity: m.rarity } },
    h("i.glow"), img("foilBack", "layer foil-back"), h("div.card-hold", card), img("foilFront", "layer foil-front"), h("i.sparkle"));
}

Pages.today = {
  build() {
    const st = S.dayState, root = h("div.page-in.today", { data: { state: st } });
    root.append(PageHead("Today", fmtDate(S.today, { weekday: "long", month: "long", day: "numeric" }), DateStamp()));
    if (st === "arrived") {
      const scene = EnvelopeScene();
      const open = () => Pages.today.openEnvelope(root);
      scene.addEventListener("click", open); scene.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && open());
      root.append(h("section.t-arrived", scene, h("p.lead.hand", "Today's Material has arrived."), h("button.btn.open", { on: { click: open } }, "Open")));
    } else root.append(Pages.today.openedBlock());
    return root;
  },
  openedBlock() {
    const m = MAT[S.todayMat], stock = usableMats().map((id) => `${MAT[id].name} ${MAT[id].unlimited ? "∞" : "×" + S.stock[id]}`).join("  ·  ");
    return h("section.t-choose",
      h("div.t-top", h("h2", "What will you stick today?"), h("p.muted", "A new material arrives every day. Make as many Petas as your materials last — plain Matte never runs out."), Choices()),
      h("div.t-bottom",
        h("div.t-mat", h("div.tm-card", MatCard(m, 138)),
          h("div.tm-text", h("p.eyebrow", "Today's Material"), h("h3", m.name, " ", h("span.seal", { data: { rarity: m.rarity } }, m.rarity)), h("p.muted", m.recipe), h("p.addnote.hand", "Added to your Material Book"), h("p.stock", stock))),
        h("div.t-stuck", h("p.eyebrow", "Stuck today"), StuckStrip())));
  },

  /* the opening: envelope -> foil -> card, then the card settles into the tray */
  async openEnvelope(root) {
    if (root._opening) return; root._opening = true;
    const scene = $(".env-scene", root), lead = $(".lead", root), btn = $(".btn.open", root), m = MAT[S.todayMat];
    btn.disabled = true; Snd.crinkle(6, .3);
    const flap = $(".flap", scene), card = $(".card", scene);
    await anim(scene, [{ transform: "scale(1)" }, { transform: "scale(1.04)" }], { duration: 200, easing: EASE.out });
    Snd.crack(); anim(flap, [{ transform: "rotateX(0)" }, { transform: "rotateX(-172deg)" }], { duration: 480, easing: EASE.out, delay: 0 });
    await anim(card, [{ transform: "translateY(0)" }, { transform: "translateY(-42%)" }], { duration: 480, easing: EASE.out, delay: 200 });
    anim(lead, [{ opacity: 1 }, { opacity: 0 }], { duration: 240 }); anim(btn, [{ opacity: 1 }, { opacity: 0 }], { duration: 240 });
    await anim(scene, [{ transform: "scale(1.04) translateY(0)", opacity: 1 }, { transform: "scale(.96) translateY(26px)", opacity: 0 }], { duration: 360, easing: EASE.inOut });
    S.dayState = "opened"; if (!m.unlimited) S.stock[m.id]++; Shell.renderNav(); Desktop.hideArrival();
    // The card is in a wrapper of its own material (foil, kraft or paper): tear it, pull the card out.
    const stageEl = $(".t-arrived", root);
    const res = await Cer.openMaterial(m);
    const block = Pages.today.openedBlock(); block.style.opacity = 0; stageEl.replaceWith(block);
    const target = $(".tm-card .mcard", block), choices = $$(".choice", block);
    await sleep(30);
    const from = res.rect, fl = res.node;
    if (target) {
      const to = target.getBoundingClientRect(), k = to.width / from.width;
      fl.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;z-index:300;pointer-events:none;--w:${from.width}px;transform-origin:0 0;`;
      document.body.append(fl); target.style.visibility = "hidden"; res.close();
      anim(block, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      choices.forEach((c, i) => anim(c, [{ opacity: 0, transform: "translateY(18px) scale(.9)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: 260 + i * 80, easing: EASE.spring }));
      await anim(fl, [{ transform: "translate(0,0) rotate(-2deg) scale(1)" }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) rotate(-2deg) scale(${k})` }], { duration: 640, easing: EASE.inOut });
      fl.remove(); target.style.visibility = ""; Snd.tap();
    } else { res.close(); block.style.opacity = 1; }
    block.style.opacity = 1; block.getAnimations().forEach((a) => a.cancel());
  },
};

/** A few pastel four-point sparkles, drawn on a canvas over `host`. */
function sparkBurst(host, n = 24, { colors = ["#f6c6e3", "#c9c3f5", "#bfe3f7", "#c8f2dc", "#f7f0be", "#fff"], cx = .5, cy = .45, power = 1 } = {}) {
  if (reduced()) return;
  const c = h("canvas.spark", { style: { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 40 } });
  host.append(c); const r = host.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = r.width * dpr; c.height = r.height * dpr; const x = c.getContext("2d"); x.scale(dpr, dpr);
  const ps = Array.from({ length: n }, () => { const a = rand(0, Math.PI * 2), v = rand(1.5, 6) * power; return { x: r.width * cx, y: r.height * cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, s: rand(5, 14), life: rand(.7, 1.2), t: 0, col: pick(colors), rot: rand(0, 3) }; });
  let last = performance.now();
  const star = (px, py, s, rot) => { x.save(); x.translate(px, py); x.rotate(rot); x.beginPath(); for (let i = 0; i < 4; i++) { x.rotate(Math.PI / 2); x.moveTo(0, 0); x.quadraticCurveTo(s * .12, s * .12, s, 0); x.quadraticCurveTo(s * .12, -s * .12, 0, 0); } x.fill(); x.restore(); };
  (function tick(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; x.clearRect(0, 0, r.width, r.height); let alive = false;
    for (const p of ps) { p.t += dt; if (p.t > p.life) continue; alive = true; p.vy += 4.5 * dt; p.vx *= .985; p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt; p.rot += dt * 2;
      x.globalAlpha = Math.max(0, 1 - p.t / p.life); x.fillStyle = p.col; star(p.x, p.y, p.s * (1 - p.t / p.life * .4), p.rot); }
    if (alive) requestAnimationFrame(tick); else c.remove();
  })(last);
}
