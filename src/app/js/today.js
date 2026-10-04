Pages.today = {
  timer: null,
  enter() { this.resume(); },
  leave() { this.suspend(); },
  suspend() { clearInterval(this.timer); this.timer = null; },
  resume() {
    this.suspend();
    const ticket = $(".envelope-ticket", Shell.current);
    if (!ticket || S.page !== "today" || !S.windowOpen || document.hidden || document.querySelector(".cer") || S.dayState !== "opened") return;
    S.envelopeDeadline ??= PetaMath.nextLocalMidnight(Date.now());
    let labelledMinute = null;
    const tick = () => {
      const clock = PetaMath.envelopeClock(Date.now(), S.envelopeDeadline);
      if (!clock.seconds) {
        this.suspend(); S.envelopeDeadline = null;
        Bridge.changed(); // daily_status uses the same native rollover as the 30-second watcher.
        return false;
      }
      $$(".envelope-clock > span", ticket).forEach((digit, i) => { digit.textContent = clock.text[i]; });
      if (labelledMinute !== clock.minute) { ticket.setAttribute("aria-label", clock.label); labelledMinute = clock.minute; }
      return true;
    };
    if (tick()) this.timer = setInterval(tick, 1000);
  },
  build() {
    const st = S.dayState, root = h("div.page-in.today", { data: { state: st } });
    root.append(PageHead("Today", fmtDate(S.today, { weekday: "long", month: "long", day: "numeric" }), st === "opened" ? EnvelopeTicket() : DateStamp()));
    if (st === "arrived") {
      const scene = EnvelopeScene();
      const open = () => Pages.today.openEnvelope(root);
      scene.addEventListener("click", open); scene.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && open());
      root.append(h("section.t-arrived", scene, h("p.lead", S.extraEnvelope ? "An extra envelope from Peta." : "Today's Material has arrived."), h("button.btn.open", { on: { click: open } }, "Open")));
    } else root.append(Pages.today.openedBlock());
    root.append(h("button.link", {on:{click:()=>Distribution.redeem()}}, "Redeem Code…"));
    return root;
  },
  openedBlock() {
    const m = MAT[S.todayMat];
    return h("section.t-choose",
      h("div.t-top", h("p.today-lead", "A new material arrives every day. Matte never runs out."), h("p.eyebrow.make-label", "Make a Peta"), Choices({hero:true})),
      h("div.t-bottom",
        h("div.t-mat", h("div.tm-card", MatCard(m, 138)),
          h("div.tm-text", h("div.tm-heading", h("p.eyebrow", "Today's material"), h("small.addnote", "Added to your Material Book")), h("h3", m.name, " ", h("span.seal", { data: { rarity: m.rarity } }, m.rarity)),
            h("div.material-features", m.recipe.split(" · ").map(text=>h("span.chip.fill", text[0].toUpperCase()+text.slice(1))))),
          h("div.stock", usableMats().map(id=>h("span.stock-pill", MaterialSwatch(MAT[id]), MAT[id].name, " ", h("b", MAT[id].unlimited ? "∞" : "×"+S.stock[id]))))),
        h("div.t-stuck", h("div.stuck-heading", h("b", "Stuck today"), h("small.muted", `${S.stuckToday.length} on your desktop`)), StuckStrip())));
  },

  /* the opening: envelope -> foil -> card, then the card settles into the tray */
  async openEnvelope(root) {
    if (root._opening) return; root._opening = true;
    const scene = $(".env-scene", root), lead = $(".lead", root), btn = $(".btn.open", root); let m;
    btn.disabled = true; Bridge.busy = true;
    try { const daily = await Bridge.invoke("daily_open_material"); await Bridge.reload(); m = MAT[daily.material.id]; }
    catch(e) { Bridge.busy = false; btn.disabled = false; root._opening = false; Shell.toast(String(e)); return; }
    Snd.crinkle(6, .3);
    const flap = $(".flap", scene), card = $(".card", scene);
    await anim(scene, [{ transform: "scale(1)" }, { transform: "scale(1.04)" }], { duration: 200, easing: EASE.out });
    Snd.crack(); anim(flap, [{ transform: "rotateX(0)" }, { transform: "rotateX(-172deg)" }], { duration: 480, easing: EASE.out, delay: 0 });
    await anim(card, [{ transform: "translateY(0)" }, { transform: "translateY(-42%)" }], { duration: 480, easing: EASE.out, delay: 200 });
    anim(lead, [{ opacity: 1 }, { opacity: 0 }], { duration: 240 }); anim(btn, [{ opacity: 1 }, { opacity: 0 }], { duration: 240 });
    await anim(scene, [{ transform: "scale(1.04) translateY(0)", opacity: 1 }, { transform: "scale(.96) translateY(26px)", opacity: 0 }], { duration: 360, easing: EASE.inOut });
    S.dayState = "opened"; Shell.renderNav(); Desktop.hideArrival();
    // The card is in a wrapper of its own material (foil, kraft or paper): tear it, pull the card out.
    const stageEl = $(".t-arrived", root);
    const res = await Cer.openMaterial(m);
    const block = Pages.today.openedBlock(); block.style.opacity = 0; stageEl.replaceWith(block);
    $(".ph-extra", root).replaceChildren(EnvelopeTicket());
    const target = $(".tm-card .mcard", block), choices = $$(".choice", block);
    await sleep(30);
    const from = res.rect, fl = res.node;
    if (target) {
      const to = target.getBoundingClientRect(), k = to.width / from.width;
      fl.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;z-index:300;pointer-events:none;--w:${from.width}px;transform-origin:0 0;`;
      document.body.append(fl); target.style.visibility = "hidden"; res.close({keepScene:true});
      anim(block, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      choices.forEach((c, i) => anim(c, [{ opacity: 0, transform: "translateY(18px) scale(.9)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: 260 + i * 80, easing: EASE.spring }));
      await anim(fl, [{ transform: "translate(0,0) rotate(-2deg) scale(1)" }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) rotate(-2deg) scale(${k})` }], { duration: 640, easing: EASE.inOut });
      fl.remove(); target.style.visibility = ""; Snd.tap(); await Bridge.leaveCeremony();
    } else { res.close(); block.style.opacity = 1; }
    block.style.opacity = 1; block.getAnimations().forEach((a) => a.cancel()); Bridge.busy = false; if(S.bonusEnvelopes > 0) Shell.refresh(); this.resume();
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
