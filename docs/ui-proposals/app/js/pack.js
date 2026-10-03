/* Ceremonies: opening a Pack (tear -> pull out -> unwrap -> reveal), opening a Gift (break the seal -> ...), sealing a gift.
   The point: every step is something you do with your hand, and the last one is yours to play with (tilt the sticker). */
const fix = (el, tf) => { el.getAnimations().forEach((a) => a.cancel()); el.style.transform = tf; };
const Cer = (() => {
  const RAR_FX = { common: { n: 0, chime: 1 }, uncommon: { n: 16, chime: 3 }, rare: { n: 46, chime: 6 }, special: { n: 60, chime: 7 }, archive: { n: 30, chime: 4 } };
  function rollMaterial() { const r = Math.random(); return r < .5 ? "matte" : r < .82 ? "kraft" : "holographic"; }

  function overlay(kind) {
    const root = h("div.cer", { data: { kind }, tabindex: -1 }), stage = h("div.cer-stage"), top = h("p.cer-hint");
    root.append(h("i.cer-bg"), top, stage); $("#overlay").append(root);
    anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 420 });
    const close = async () => { await anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 320 }); root.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") root._esc && root._esc(); };
    document.addEventListener("keydown", onKey);
    return { root, stage, close, hint: (t) => { if (top.textContent === t) return; top.textContent = t; anim(top, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 400 }); } };
  }

  /* After the sleeve is pulled out: unwrap it, reveal the sticker, let the person play with it. */
  async function unwrapAndReveal({ cer, stage, sleeve, entry, source, onKeep, onLater }) {
    const res = await resOf(entry, { max: 560 }), mat = MAT[entry.material], fx = RAR_FX[mat.rarity];
    cer.hint("");
    const W = stage.clientWidth, Hh = stage.clientHeight;
    const holder = h("div.rv-holder");
    const sw = Math.min(280, (res.aspect >= 1 ? 1 : res.aspect) * 280);
    const stk = Stk.el(res, res.aspect >= 1 ? 280 : sw); holder.append(stk);
    const glow = h("i.rv-glow", { data: { m: entry.material } }), rays = h("i.rv-rays", { data: { m: entry.material } });
    stage.append(glow, rays, holder); holder.style.opacity = 0;
    // sleeve glides to the middle and gets a little crumpled
    const sr = sleeve.getBoundingClientRect(), st = stage.getBoundingClientRect();
    const cx = st.left + W * .5, cy = st.top + Hh * .44;
    const dx = cx - (sr.left + sr.width / 2), dy = cy - (sr.top + sr.height / 2);
    Snd.swoosh();
    await anim(sleeve, [{ transform: sleeve.style.transform || "none" }, { transform: `translate(${dx}px, ${dy}px) scale(1.1)` }], { duration: 560, easing: EASE.inOut, composite: "replace" });
    Snd.crinkle(18, .55);
    await anim(sleeve, [{ transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(0)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(-3deg)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(3deg)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(-2deg)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(0)` }], { duration: 480, easing: "ease-in-out" });
    // pop
    Snd.chime(fx.chime, 880);
    anim(sleeve, [{ opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1.1)` }, { opacity: 0, transform: `translate(${dx}px, ${dy - 20}px) scale(1.42) rotate(6deg)` }], { duration: 480, easing: EASE.out });
    anim(glow, [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)" }], { duration: 900, easing: EASE.out });
    if (entry.material !== "matte") anim(rays, [{ opacity: 0, transform: "scale(.5) rotate(0)" }, { opacity: .9, transform: "scale(1) rotate(40deg)" }], { duration: 1200, easing: EASE.out });
    if (fx.n) sparkBurst(stage, fx.n, { cx: .5, cy: .44, power: mat.rarity === "rare" ? 1.5 : 1, colors: entry.material === "kraft" ? ["#f2d9a8", "#fff", "#e8bf80"] : undefined });
    await anim(holder, [{ opacity: 0, transform: "scale(.5) rotate(-12deg)" }, { opacity: 1, transform: "scale(1.06) rotate(2deg)", offset: .6 }, { opacity: 1, transform: "scale(1) rotate(0)" }], { duration: 760, easing: EASE.out });
    sleeve.remove();
    holder.style.opacity = 1; holder.getAnimations().forEach((a) => a.cancel());
    // alive: tilt + sheen
    const tilter = h("div.rv-tilt", stk); holder.append(tilter); Stk.tilt(tilter, { max: 14, scale: 1.05 });
    anim(tilter, [{ transform: "translateY(0)" }, { transform: "translateY(-7px)" }, { transform: "translateY(0)" }], { duration: 4200, iterations: Infinity, easing: "ease-in-out", composite: "add" });
    cer.hint("Tilt it — it catches the light.");
    // who/what is it
    const info = h("div.rv-info", h("p.eyebrow", source), h("h2", titleOf(entry)),
      h("div.rv-meta", h("span.seal.stamp-in", { data: { rarity: mat.rarity } }, mat.name + " · " + mat.rarity), h("span.no", entry.kind === "received" ? `Edition #${pad4(entry.edition)}` : "")),
      h("div.rv-btns", h("button.btn.keep", { on: { click: () => { Snd.tap(); onKeep(); } } }, "Stick it"), h("button.btn.paper", { on: { click: onLater } }, "Later")));
    stage.append(info);
    anim(info, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: EASE.out });
    const seal = $(".seal", info); await sleep(260); Snd.seal();
    await anim(seal, [{ opacity: 0, transform: "scale(2.4) rotate(-14deg)" }, { opacity: 1, transform: "scale(1) rotate(-2.5deg)" }], { duration: 360, easing: EASE.spring });
  }

  /* ------------------------------------------------------------------ PACK */
  function jagged(n = 26, base = 21, amp = .8) { const pts = []; for (let i = 0; i <= n; i++) pts.push([+(i * 100 / n).toFixed(2), +(base + rand(-amp, amp)).toFixed(2)]); return pts; }
  const polyTop = (j) => `polygon(0 0, 100% 0, ${[...j].reverse().map((p) => `${p[0]}% ${p[1]}%`).join(", ")})`;
  const polyBody = (j) => `polygon(${j.map((p) => `${p[0]}% ${p[1]}%`).join(", ")}, 100% 100%, 0 100%)`;

  async function openPack(pack) {
    if (!pack.left.length) return;
    const cer = overlay("pack"), stage = cer.stage; cer.hint("Tear along the top.");
    const PW = Math.min(310, innerHeight * .4), PH = PW * 4 / 3, CUT = 21;
    const jag = jagged();
    const tint = pack.hue ? ".tinted" : "";
    const mk = (cls, clip) => h("div.pk-layer." + cls + tint, { style: { clipPath: clip, webkitClipPath: clip, "--hue": (pack.hue || 0) + "deg" } }, h("i.sheen"));
    const body = mk("pk-body", polyBody(jag)), topStrip = mk("pk-top", polyTop(jag)), inside = h("div.pk-inside");
    const sleeve = h("div.pk-sleeve", img("mystery"));
    const tab = h("i.pk-tab", h("b", "tear")), line = h("i.pk-line");
    const pouch = h("div.pouch", { style: { width: PW + "px", height: PH + "px" } }, inside, sleeve, body, topStrip, line, tab);
    const wrapper = h("div.pk-wrap", pouch); stage.append(wrapper);
    anim(wrapper, [{ opacity: 0, transform: "translateY(60px) rotate(8deg) scale(.86)" }, { opacity: 1, transform: "none" }], { duration: 720, easing: EASE.spring });
    const xL = PW * .115, xR = PW * .875, cutY = PH * CUT / 100, span = xR - xL;
    sleeve.style.cssText = `width:${PW * .72}px;left:${PW * .14}px;top:${cutY - PW * .72 * .12}px`;
    // tear state
    let prog = 0, done = false;
    const setProg = (p) => {
      prog = clamp(p, 0, 1); const th = prog * 30 * Math.PI / 180, deg = -prog * 30;
      topStrip.style.transformOrigin = `${xR}px ${cutY}px`; topStrip.style.transform = `rotate(${deg}deg) translate(${prog * 5}px, ${-prog * 6}px)`;
      const bx = xR - span * Math.cos(th), by = cutY - span * Math.sin(th);
      inside.style.clipPath = `polygon(${xL}px ${cutY - 3}px, ${xR}px ${cutY - 3}px, ${bx}px ${by}px)`; inside.style.opacity = prog > .01 ? 1 : 0;
      line.style.opacity = prog > .02 ? 0 : 1; tab.style.opacity = prog > .02 ? 0 : 1;
      sleeve.style.transform = `translateY(${-prog * PH * .06}px)`;
    };
    setProg(0);
    // sheen follows the pointer over the foil
    onPointerFollow(pouch, (x, y) => { pouch.style.setProperty("--sx", (1 - x) * 100 + "%"); pouch.style.setProperty("--sy", (1 - y) * 100 + "%"); });
    let lastSnd = 0;
    drag(pouch, {
      down: (e) => { if (done) return false; const r = pouch.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; if (y > .42) return false; pouch.classList.add("pulling"); },
      move: (dx, dy) => {
        if (done) return;
        setProg(dx / (span * .9));
        const j = Math.sin(performance.now() / 28) * prog * 1.6; wrapper.style.transform = `translate(${j}px, ${Math.cos(performance.now() / 33) * prog * 1.1}px) rotate(${j * .08}deg)`;
        const now = performance.now(); if (now - lastSnd > 70 && prog < 1) { lastSnd = now; Snd.crinkle(2, .06); }
        if (prog >= 1 && !done) finishTear();
      },
      up: () => { pouch.classList.remove("pulling"); wrapper.style.transform = ""; if (!done && prog < 1) springBack(); },
    });
    const springBack = async () => { const from = prog, t0 = performance.now(); Snd.tap(); await new Promise((res) => { (function f(now) { const t = clamp((now - t0) / 380, 0, 1), e = 1 - Math.pow(1 - t, 3); setProg(from * (1 - e) * (1 + Math.sin(t * 9) * .08 * (1 - t))); t < 1 ? requestAnimationFrame(f) : res(); })(t0); }); setProg(0); };
    pouch.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") autoTear(); }); pouch.tabIndex = 0;
    $(".pk-tab", pouch).addEventListener("dblclick", autoTear); pouch.addEventListener("dblclick", autoTear);
    async function autoTear() { if (done) return; const t0 = performance.now(); await new Promise((res) => { (function f(now) { const t = clamp((now - t0) / 620, 0, 1); setProg(t); Snd.crinkle(1, .05); t < 1 ? requestAnimationFrame(f) : res(); })(t0); }); finishTear(); }

    // the point of no return
    let idx = -1, entry = null;
    async function finishTear() {
      if (done) return; done = true; pouch.classList.remove("pulling"); pouch.classList.add("torn"); wrapper.style.transform = "";
      idx = Math.floor(Math.random() * pack.left.length); const src = pack.left.splice(idx, 1)[0];
      entry = { id: "L" + pad4(S.nextNo).slice(1), src, material: rollMaterial(), kind: "received", from: pack.by, edition: Math.floor(rand(8, 240)), no: null, date: S.today };
      S.nextNo++; S.packsOpened++; Snd.tear(); cer.hint(""); Shell.renderNav();
      anim(topStrip, [{ transform: topStrip.style.transform, opacity: 1 }, { transform: `translate(${PW * .6}px, ${-PH * .55}px) rotate(-85deg)`, opacity: 0 }], { duration: 760, easing: "cubic-bezier(.3,.1,.6,1)", composite: "replace" });
      // the mouth stays open
      inside.style.clipPath = `polygon(${xL}px ${cutY - 3}px, ${xR}px ${cutY - 3}px, ${xR}px ${cutY - PH * .035}px, ${xL}px ${cutY - PH * .035}px)`;
      await sleep(180); Snd.swoosh();
      await anim(sleeve, [{ transform: sleeve.style.transform }, { transform: `translateY(${-PH * .3}px) rotate(-1.5deg)` }], { duration: 760, easing: EASE.out });
      fix(sleeve, `translateY(${-PH * .3}px) rotate(-1.5deg)`);
      sleeve.classList.add("out"); cer.hint("Pull it out.");
      let pulled = false;
      const toBase = sleeve.style.transform;
      drag(sleeve, {
        down: () => { if (pulled) return false; sleeve.style.zIndex = 5; },
        move: (dx, dy) => { const up = clamp(-dy, 0, PH * .8), rb = up > PH * .5 ? PH * .5 + (up - PH * .5) * .3 : up; sleeve.style.transform = `translateY(${-PH * .3 - rb}px) rotate(${-1.5 + dx * .03}deg)`; Snd.crinkle(1, .03); if (up > PH * .34 && !pulled) pull(); },
        up: () => { if (!pulled) anim(sleeve, [{ transform: sleeve.style.transform }, { transform: toBase }], { duration: 300, easing: EASE.spring }).then(() => fix(sleeve, toBase)); },
      });
      sleeve.addEventListener("dblclick", () => !pulled && pull()); sleeve.tabIndex = 0; sleeve.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && !pulled && pull());
      async function pull() {
        pulled = true; sleeve.style.cursor = "default";
        sleeve.style.transform = sleeve.style.transform; // freeze
        anim(wrapper.querySelector(".pouch"), [{ transform: "translateY(0) rotate(0)", opacity: 1 }, { transform: `translateY(${PH * .5}px) rotate(7deg)`, opacity: 0 }], { duration: 700, easing: "cubic-bezier(.5,0,.8,.4)", delay: 120 });
        // lift the sleeve out of the pouch's stacking context so it can go to the middle
        const r = sleeve.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        stage.append(sleeve); sleeve.style.cssText = `position:absolute;left:${r.left - sr.left}px;top:${r.top - sr.top}px;width:${r.width}px;z-index:8;transform:none;`;
        await unwrapAndReveal({ cer, stage, sleeve, entry, source: `${pack.title} · ${pack.left.length} left`,
          onKeep: () => keep(), onLater: () => later() });
      }
    }
    const keep = async () => { await cer.close(); Shell.toast("It's yours."); await Desktop.print(entry); };
    const later = async () => { S.pending = { entry }; await cer.close(); Shell.toast("Waiting at the print slot — open the Peta menu."); Shell.renderNav(); Shell.close(); };
    cer.root._esc = () => { if (!done) cer.close(); else if (entry && $(".rv-info")) later(); };
    pouch.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ GIFT (open) */
  async function openGift(gift) {
    const cer = overlay("gift"), stage = cer.stage; cer.hint("Break the seal.");
    const EW = Math.min(420, innerWidth * .6), EH = EW * 340 / 480;
    const flapPoly = "polygon(10% 14%, 90% 14%, 50% 57%)", bodyPoly = "polygon(0 0, 10% 14%, 50% 57%, 90% 14%, 100% 0, 100% 100%, 0 100%)";
    const hole = `radial-gradient(circle at 50% 54.5%, transparent 0, transparent ${EW * .066}px, #000 ${EW * .074}px)`;
    const mk = (cls, clip, extra = {}) => h("img.ev-layer." + cls, { src: A.arrGift, alt: "", style: { clipPath: clip, webkitMaskImage: hole, maskImage: hole, ...extra } });
    const inside = h("i.ev-inside"), body = mk("ev-body", bodyPoly), flap = mk("ev-flap", flapPoly);
    const wax = h("div.wax", { style: { width: EW * .17 + "px", left: "50%", top: "54.5%" } }, img("waxSeal", "w-full"), img("waxL", "w-l"), img("waxR", "w-r"));
    const note = h("div.ev-note", { style: { width: EW * .86 + "px" } }, img("noteBlank"), h("p.hand", h("small", "from"), h("b", gift.from), gift.note ? h("span", "“" + gift.note + "”") : null));
    const sleeve = h("div.pk-sleeve.gsleeve", { style: { width: EW * .5 + "px" } }, img("mystery"));
    const env = h("div.env-wrap", { style: { width: EW + "px", height: EH + "px", "--ew": EW + "px" } }, inside, sleeve, note, body, flap, wax);
    const sc = h("div.gift-scene", env); stage.append(sc);
    anim(sc, [{ opacity: 0, transform: "translateY(50px) rotate(-6deg) scale(.88)" }, { opacity: 1, transform: "none" }], { duration: 700, easing: EASE.spring });
    let opened = false, entry = null;
    const crack = async () => {
      if (opened) return; opened = true; cer.hint(""); Snd.crack();
      wax.classList.add("cracked");
      anim($(".w-l", wax), [{ transform: "none", opacity: 1 }, { transform: "translate(-34px, 70px) rotate(-28deg)", opacity: 0 }], { duration: 760, easing: "cubic-bezier(.3,0,.7,.6)" });
      anim($(".w-r", wax), [{ transform: "none", opacity: 1 }, { transform: "translate(40px, 84px) rotate(32deg)", opacity: 0 }], { duration: 820, easing: "cubic-bezier(.3,0,.7,.6)" });
      anim($(".w-full", wax), [{ opacity: 1 }, { opacity: 0 }], { duration: 40 });
      await sleep(260); Snd.swoosh();
      flap.style.transformOrigin = "50% 14%"; inside.style.opacity = 1;
      await anim(flap, [{ transform: "rotateX(0)" }, { transform: "rotateX(180deg)", filter: "brightness(.92)" }], { duration: 640, easing: EASE.out });
      fix(flap, "rotateX(180deg)"); flap.style.zIndex = 0;
      // the note comes out first
      Snd.crinkle(6, .3);
      await anim(note, [{ transform: "translate(-50%, 10%) rotate(0)", opacity: 1 }, { transform: `translate(-62%, -${EH * .78}px) rotate(-6deg)`, opacity: 1 }], { duration: 760, easing: EASE.out });
      fix(note, `translate(-62%, -${EH * .78}px) rotate(-6deg)`);
      cer.hint("Pull the sticker out.");
      sleeve.classList.add("out");
      await anim(sleeve, [{ transform: "translateY(0)" }, { transform: `translateY(-${EH * .34}px) rotate(1.5deg)` }], { duration: 640, easing: EASE.out });
      fix(sleeve, `translateY(-${EH * .34}px) rotate(1.5deg)`);
      entry = { id: "L" + pad4(S.nextNo).slice(1), src: gift.src, material: gift.material, kind: "received", from: gift.from, edition: gift.edition, no: null, date: S.today };
      let pulled = false; const base = sleeve.style.transform;
      drag(sleeve, {
        down: () => !pulled,
        move: (dx, dy) => { const up = clamp(-dy, 0, 300); sleeve.style.transform = `translateY(${-EH * .34 - up}px) rotate(${1.5 + dx * .03}deg)`; Snd.crinkle(1, .03); if (up > 110 && !pulled) pull(); },
        up: () => { if (!pulled) { anim(sleeve, [{ transform: sleeve.style.transform }, { transform: base }], { duration: 300, easing: EASE.spring }).then(() => fix(sleeve, base)); } },
      });
      sleeve.addEventListener("dblclick", () => !pulled && pull()); sleeve.tabIndex = 0; sleeve.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && !pulled && pull());
      async function pull() {
        pulled = true; gift.opened = true; S.nextNo++; Shell.renderNav();
        anim(note, [{ opacity: 1 }, { opacity: 0, transform: note.style.transform + " translateY(-30px)" }], { duration: 500, delay: 100 });
        anim(env, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(200px) rotate(4deg)", opacity: 0 }], { duration: 700, easing: "cubic-bezier(.5,0,.8,.4)", delay: 120 });
        const r = sleeve.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        stage.append(sleeve); sleeve.style.cssText = `position:absolute;left:${r.left - sr.left}px;top:${r.top - sr.top}px;width:${r.width}px;z-index:8;transform:none;`;
        await unwrapAndReveal({ cer, stage, sleeve, entry, source: `Gift from ${gift.from}`, onKeep: keep, onLater: later });
      }
    };
    const keep = async () => { await cer.close(); Shell.toast("A gift from " + gift.from + "."); await Desktop.print(entry); };
    const later = async () => { S.pending = { entry }; await cer.close(); Shell.toast("Waiting at the print slot — open the Peta menu."); Shell.renderNav(); Shell.close(); };
    wax.addEventListener("click", crack); wax.addEventListener("pointerdown", () => Snd.tap()); wax.tabIndex = 0; wax.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && crack());
    wax.style.cursor = "pointer"; cer.root._esc = () => { if (!opened) cer.close(); };
  }

  /* ------------------------------------------------------------------ GIFT (seal and save) */
  async function sealGift(entry, to, note) {
    const cer = overlay("seal"), stage = cer.stage; cer.hint("");
    const EW = Math.min(400, innerWidth * .58), EH = EW * 2 / 3;
    const res = await resOf(entry, { max: 420 });
    const stk = Stk.el(res, res.aspect >= 1 ? EW * .42 : EW * .42 * res.aspect);
    const back = img("envBack", "ev-layer"), pocket = h("span.ev-layer.pk", img("envPocket"), h("span.env-label", "To", h("br"), to)), flap = img("envFlap", "ev-layer flap");
    const wax = h("div.wax.one", { style: { width: EW * .2 + "px", left: "50%", top: "40%", opacity: 0 } }, img("waxSeal", "w-full"));
    const env = h("div.env-wrap.send", { style: { width: EW + "px", height: EH + "px" } }, back, h("div.slide-stk", stk), pocket, flap, wax);
    stage.append(h("div.gift-scene", env));
    anim(env, [{ opacity: 0, transform: "translateY(40px) scale(.9)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: EASE.spring });
    flap.style.transformOrigin = "50% 12.5%"; await anim(flap, [{ transform: "rotateX(0)" }, { transform: "rotateX(-172deg)" }], { duration: 480, easing: EASE.out, delay: 300 }); fix(flap, "rotateX(-172deg)");
    const holder = $(".slide-stk", env); Snd.swoosh();
    await anim(holder, [{ transform: `translateY(-${EH * .75}px) rotate(-8deg) scale(1.1)`, opacity: 0 }, { transform: `translateY(-${EH * .45}px) rotate(-3deg) scale(1)`, opacity: 1, offset: .4 }, { transform: `translateY(${EH * .08}px) rotate(0) scale(.7)`, opacity: 1 }], { duration: 900, easing: EASE.inOut });
    await anim(flap, [{ transform: "rotateX(-172deg)" }, { transform: "rotateX(0)" }], { duration: 480, easing: EASE.out }); fix(flap, "rotateX(0)");
    await sleep(120);
    wax.style.opacity = 1; Snd.seal();
    await anim(wax, [{ transform: "translate(-50%,-50%) scale(2.2)", opacity: 0 }, { transform: "translate(-50%,-50%) scale(.9)", opacity: 1, offset: .6 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 1 }], { duration: 420, easing: "ease-out" });
    fix(wax, "translate(-50%,-50%)");
    cer.hint(`Sealed. ${to}.peta is saved.`); await sleep(900);
    await anim(env, [{ transform: "none", opacity: 1 }, { transform: "translateY(-260px) rotate(-5deg) scale(.9)", opacity: 0 }], { duration: 900, easing: "cubic-bezier(.5,0,.9,.4)" });
    await cer.close(); Shell.toast(`Saved “${to}.peta” — your own sticker stays in the Book.`);
  }
  return { openPack, openGift, sealGift };
})();
const GiftSeal = (e, to, note) => Cer.sealGift(e, to, note);
