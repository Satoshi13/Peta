/* The owner's announcement: one line above Today that can be closed for good. The text is plain text; a link can only be one of the two
   places built into the app. Builds without the server never have one. */
const TodayNotice = {
  data: undefined, loading: null,
  LINKS: { download: "Open the download page", discord: "Join the Discord" },
  KINDS: { info: "News", event: "Event", maintenance: "Maintenance" },
  load() {
    if (this.loading) return this.loading;
    this.loading = Bridge.invoke("announcement_current").then((d) => (this.data = d || null), () => this.data ?? null).finally(() => { this.loading = null; });
    return this.loading;
  },
  host() {
    const host = h("div.t-notice-host");
    const paint = (n) => host.replaceChildren(...(n ? [this.banner(n, host)] : []));
    if (this.data !== undefined) paint(this.data);
    this.load().then(paint);
    return host;
  },
  banner(n, host) {
    const close = h("button.t-notice-x", { type: "button", "aria-label": "Close this announcement", on: { click: () => {
      this.data = null; host.replaceChildren(); Snd.tap(); Bridge.invoke("announcement_dismiss", { id: n.id }).catch(() => {});
    } } }, "×");
    const link = this.LINKS[n.link] ? h("button.link.t-notice-link", { type: "button", on: { click: () => Bridge.invoke("announcement_open", { link: n.link }).catch((e) => Shell.toast(String(e))) } }, this.LINKS[n.link], " ", h("i", "→")) : null;
    return h("aside.t-notice", { role: "note", data: { kind: this.KINDS[n.kind] ? n.kind : "info" } },
      h("span.t-notice-kind", this.KINDS[n.kind] || "News"), h("p.t-notice-text", String(n.text)), link, close);
  },
};

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
    root.append(TodayNotice.host(), PageHead("Today", fmtDate(S.today, { weekday: "long", month: "long", day: "numeric" }), st === "opened" ? EnvelopeTicket() : DateStamp()));
    if (st === "arrived") {
      const scene = EnvelopeScene();
      const open = () => Pages.today.openEnvelope(root);
      scene.addEventListener("click", open); scene.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && open());
      root.append(h("section.t-arrived", scene, h("p.lead", S.extraEnvelope ? "An extra envelope from Peta." : "Today's Material has arrived."), h("button.btn.open", { on: { click: open } }, "Open")));
    } else root.append(Pages.today.openedBlock());
    return root;
  },
  openedBlock() {
    return h("section.t-choose.t-stage",
      h("p.today-lead", "A new material arrives every day. Each sticker uses one sheet."),
      Pages.today.stage(MAT[S.todayMat]),
      h("p.eyebrow.make-label", "Other ways to get a Peta"), Choices({ more: true }));
  },

  /* Today's Peta gets the stage: an empty die-cut slot until something is stuck, then the sticker itself. */
  stage(m) {
    const entries = PetaMath.newestBookEntries(S.stuckToday.map((id) => S.lib.find((l) => l.id === id)).filter(Boolean));
    const slot = h("div.t-slot", { data: { state: entries.length ? "stuck" : "empty" } });
    if (entries.length) Pages.today.fillSlot(slot, entries);
    else {
      const die = h("div.t-die", { "aria-hidden": "true" });
      die.innerHTML = '<svg viewBox="0 0 318 282"><path d="M60 40c40-34 126-30 170-6 44 24 70 74 58 128-12 54-62 88-130 88-70 0-128-26-140-82C8 114 20 72 60 40z"/></svg>';
      // The whole empty slot is the way in: it does what "Make today's Peta" does.
      slot.append(die, h("button.t-ghost", { type: "button", "aria-label": "Make today's Peta", on: { click: (e) => { Snd.tap(); Shell.go("create", { origin: e.currentTarget, via: "object" }); } } },
        h("span.t-plus", { "aria-hidden": "true" }), h("b", "Make today's Peta"), h("small", "Choose any image to begin")));
    }
    const n = entries.length;
    const info = h("div.t-info",
      h("p.eyebrow", "Today's Peta"), h("h2.t-status", n ? (n === 1 ? "Stuck on your desktop" : `${n} stuck on your desktop`) : "Ready when you are"),
      h("div.t-mat", h("div.tm-card", MatCard(m, 120)),
        h("div.tm-text", h("div.tm-heading", h("p.eyebrow", "Today's material"), h("small.addnote", "Added to your Materials")), h("h3", m.name, " ", h("span.seal", { data: { rarity: m.rarity } }, m.rarity)))),
      Pages.today.streak(),
      n ? h("div.t-cta", h("button.btn.t-make", { on: { click: (e) => { Snd.tap(); Shell.go("create", { origin: e.currentTarget, via: "object" }); } } }, "Make another")) : h("p.muted.t-ready-note", "Choose an image to turn into a sticker. Your material is ready."));
    return h("div.t-hero", slot, info);
  },
  /* The last seven days on a paper ticket: the weekday over a dot, filled where something was stuck, empty where not. No counting up, no shame for gaps. */
  streak() {
    const days = PetaMath.recentDays(S.lib.map((e) => PetaMath.bookDateKey(e.date)), S.today), n = days.filter((d) => d.filled).length;
    const name = (key) => { const [y, m, d] = key.split("-").map(Number); return fmtDate(new Date(y, m - 1, d, 12), { weekday: "short" }); };
    return h("div.t-chain", { role: "img", "aria-label": `${n} of the last 7 days` },
      h("div.wk-days", days.map((d) => h("div.wk-day" + (d.today ? ".today" : ""), h("span", name(d.key)), h("i", { class: d.filled ? "f" : "" })))), h("i.wk-rule"), h("small", `${n} of the last 7 days`));
  },
  fillSlot(slot, entries) {
    const wrap = h("div.t-landed"), stamp = DateStamp(), ripple = h("i.t-ripple");
    stamp.classList.add("t-stamp");
    const shown = entries.slice(0, 12), thumbs = h("div.t-others", { role: "group", "aria-label": "Stickers stuck today" });
    const show = async (e, first) => {
      const res = await resOf(e); if (!wrap.isConnected && !first) return;
      wrap.replaceChildren(Stk.el(res, Math.min(280, res.aspect >= 1 ? 280 : 280 * res.aspect)));
      Stk.tilt(wrap, { max: 5, scale: 1.015, trigger: slot });
      $$(".t-thumb", thumbs).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === e.id)));
      const on = $(`.t-thumb[data-id="${e.id}"]`, thumbs); // keep the chosen one inside the strip
      if (on) { const a = on.offsetLeft - 4, z = on.offsetLeft + on.offsetWidth + 4; if (a < thumbs.scrollLeft) thumbs.scrollTo({ left: a, behavior: "smooth" }); else if (z > thumbs.scrollLeft + thumbs.clientWidth) thumbs.scrollTo({ left: z - thumbs.clientWidth, behavior: "smooth" }); }
    };
    if (shown.length > 1) shown.forEach((e, i) => { const b = h("button.t-thumb", { data: { id: e.id }, "aria-pressed": String(i === 0), "aria-label": "Show " + titleOf(e), on: { click: () => { if (b.getAttribute("aria-pressed") === "true") return; Snd.tap(); show(e); } } }); resOf(e).then((res) => b.append(Stk.el(res, res.aspect >= 1 ? 40 : 40 * res.aspect))).catch(() => {}); thumbs.append(b); });
    // one row, about four and a half thumbnails wide; what runs past the edge fades out, and a wheel scrolls it sideways
    const fade = () => { const max = thumbs.scrollWidth - thumbs.clientWidth; thumbs.dataset.fadeStart = String(thumbs.scrollLeft > 2); thumbs.dataset.fadeEnd = String(max > 2 && thumbs.scrollLeft < max - 2); };
    thumbs.addEventListener("scroll", fade, { passive: true });
    thumbs.addEventListener("wheel", (ev) => { if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { thumbs.scrollLeft += ev.deltaY; ev.preventDefault(); } }, { passive: false });
    new ResizeObserver(fade).observe(thumbs);
    slot.append(wrap, ripple, stamp, shown.length > 1 ? thumbs : null);
    let saved = null; try { saved = JSON.parse(localStorage.getItem("peta.landed") || "null"); } catch {}
    const { fresh, next } = PetaMath.landingState(saved, PetaMath.bookDateKey(S.today), entries.map((e) => e.id));
    try { localStorage.setItem("peta.landed", JSON.stringify(next)); } catch {}
    const lands = fresh.includes(entries[0].id) && !reduced();
    if (lands) { stamp.style.opacity = 0; wrap.style.opacity = 0; }
    show(entries[0], true).then(async () => {
      if (!lands) return;
      const a = await anim(wrap, [{ opacity: 0, transform: "translateY(-70px) scale(1.14) rotate(-4deg)" }, { opacity: 1, transform: "translateY(0) scale(1.06) rotate(1deg)", offset: .6 }, { transform: "scale(.975)", offset: .82 }, { opacity: 1, transform: "none" }], { duration: 760, easing: EASE.out });
      a.cancel(); wrap.style.opacity = "";
      anim(ripple, [{ opacity: .45, transform: "translate(-50%,-50%) scale(.4)" }, { opacity: 0, transform: "translate(-50%,-50%) scale(1.9)" }], { duration: 560, easing: EASE.out });
      const s = await anim(stamp, [{ opacity: 0, transform: "rotate(-6deg) scale(1.8)" }, { opacity: .92, transform: "rotate(-3deg) scale(.95)", offset: .6 }, { opacity: .92, transform: "rotate(-3deg) scale(1)" }], { duration: 340, easing: EASE.spring });
      s.cancel(); stamp.style.opacity = "";
    }).catch((err) => Shell.error(err));
  },

  /* One envelope releases the actual material card; Keep settles it into Today. */
  async openEnvelope(root) {
    if (root._opening) return; root._opening = true;
    const btn = $(".btn.open", root); let m;
    btn.disabled = true; Bridge.busy = true;
    try { const daily = await Bridge.invoke("daily_open_material"); await Bridge.reload(); m = MAT[daily.material.id]; }
    catch(e) { Bridge.busy = false; btn.disabled = false; root._opening = false; Shell.error(e); return; }
    S.dayState = "opened"; Shell.renderNav(); Desktop.hideArrival();
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
