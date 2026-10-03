/* Ceremonies: opening a Pack (tear -> pull out -> unwrap -> reveal), opening a Gift (break the seal -> ...), sealing a gift.
   The point: every step is something you do with your hand, and the last one is yours to play with (tilt the sticker). */
const fix = (el, tf) => { el.getAnimations().forEach((a) => a.cancel()); el.style.transform = tf; };
const Cer = (() => {
  const RAR_FX = { common: { n: 0, chime: 1 }, uncommon: { n: 16, chime: 3 }, rare: { n: 46, chime: 6 }, special: { n: 60, chime: 7 }, archive: { n: 30, chime: 4 } };

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

  /* One tearable wrapper, used by Packs (the sticker comes out) and by Today's material (the card comes out).
     `content` sits inside, behind the front of the wrapper; `onTear(rig)` runs once, the moment the top is torn off. */
  function buildRig(cer, stage, { kind, hue, content, onTear }) {
    const K = PACK_KINDS[kind] || PACK_KINDS.holo, PW = Math.min(310, innerHeight * .4), PH = PW * 4 / 3, CUT = K.cut;
    const jag = jagged(26, CUT), tint = K.foil && hue ? ".tinted" : "";
    const mk = (cls, clip) => h("div.pk-layer." + cls + tint, { style: { clipPath: clip, webkitClipPath: clip, "--hue": (hue || 0) + "deg" } }, K.foil ? h("i.sheen") : null);
    const body = mk("pk-body", polyBody(jag)), topStrip = mk("pk-top", polyTop(jag)), inside = h("div.pk-inside");
    const tab = h("i.pk-tab", h("b", "tear")), line = h("i.pk-line");
    const pouch = h("div.pouch", { data: { kind: kind || "holo" }, style: { width: PW + "px", height: PH + "px", "--pk": packVar(kind) } }, inside, content, body, topStrip, line, tab);
    line.style.top = CUT + "%"; tab.style.top = CUT - 3.6 + "%";
    const wrapper = h("div.pk-wrap", pouch); stage.append(wrapper);
    anim(wrapper, [{ opacity: 0, transform: "translateY(60px) rotate(8deg) scale(.86)" }, { opacity: 1, transform: "none" }], { duration: 720, easing: EASE.spring });
    const xL = PW * K.xl, xR = PW * K.xr, cutY = PH * CUT / 100, span = xR - xL;
    const rig = { K, PW, PH, cutY, xL, xR, pouch, wrapper, topStrip, inside, content, done: false, prog: 0 };
    const setProg = (p) => {
      rig.prog = clamp(p, 0, 1); const th = rig.prog * 30 * Math.PI / 180, deg = -rig.prog * 30;
      topStrip.style.transformOrigin = `${xR}px ${cutY}px`; topStrip.style.transform = `rotate(${deg}deg) translate(${rig.prog * 5}px, ${-rig.prog * 6}px)`;
      const bx = xR - span * Math.cos(th), by = cutY - span * Math.sin(th);
      inside.style.clipPath = `polygon(${xL}px ${cutY - 3}px, ${xR}px ${cutY - 3}px, ${bx}px ${by}px)`; inside.style.opacity = rig.prog > .01 ? 1 : 0;
      line.style.opacity = rig.prog > .02 ? 0 : 1; tab.style.opacity = rig.prog > .02 ? 0 : 1;
      content.style.transform = `translateY(${-rig.prog * PH * .06}px)`;
    };
    setProg(0);
    // the foil / paper catches the light wherever the pointer is on the stage
    stage.addEventListener("pointermove", (e) => { const r = pouch.getBoundingClientRect(); pouch.style.setProperty("--sx", (1 - clamp((e.clientX - r.left) / r.width, 0, 1)) * 100 + "%"); pouch.style.setProperty("--sy", (1 - clamp((e.clientY - r.top) / r.height, 0, 1)) * 100 + "%"); });
    let lastSnd = 0;
    drag(pouch, {
      down: (e) => { if (rig.done) return false; const r = pouch.getBoundingClientRect(); if ((e.clientY - r.top) / r.height > .42) return false; pouch.classList.add("pulling"); },
      move: (dx) => {
        if (rig.done) return;
        setProg(dx / (span * .9));
        const j = Math.sin(performance.now() / 28) * rig.prog * 1.6; wrapper.style.transform = `translate(${j}px, ${Math.cos(performance.now() / 33) * rig.prog * 1.1}px) rotate(${j * .08}deg)`;
        const now = performance.now(); if (now - lastSnd > 70 && rig.prog < 1) { lastSnd = now; Snd.crinkle(2, .06); }
        if (rig.prog >= 1) finish();
      },
      up: () => { pouch.classList.remove("pulling"); wrapper.style.transform = ""; if (!rig.done && rig.prog < 1) springBack(); },
    });
    const springBack = async () => { const from = rig.prog, t0 = performance.now(); Snd.tap(); await new Promise((res) => { (function f(now) { const t = clamp((now - t0) / 380, 0, 1), e = 1 - Math.pow(1 - t, 3); setProg(from * (1 - e) * (1 + Math.sin(t * 9) * .08 * (1 - t))); t < 1 ? requestAnimationFrame(f) : res(); })(t0); }); setProg(0); };
    const autoTear = async () => { if (rig.done) return; const t0 = performance.now(); await new Promise((res) => { (function f(now) { const t = clamp((now - t0) / 620, 0, 1); setProg(t); Snd.crinkle(1, .05); t < 1 ? requestAnimationFrame(f) : res(); })(t0); }); finish(); };
    pouch.tabIndex = 0; pouch.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && autoTear()); pouch.addEventListener("dblclick", autoTear);
    const finish = async () => {
      if (rig.done) return; rig.done = true; pouch.classList.remove("pulling"); pouch.classList.add("torn"); wrapper.style.transform = ""; Snd.tear(); cer.hint("");
      anim(topStrip, [{ transform: topStrip.style.transform, opacity: 1 }, { transform: `translate(${PW * .6}px, ${-PH * .55}px) rotate(-85deg)`, opacity: 0 }], { duration: 760, easing: "cubic-bezier(.3,.1,.6,1)", composite: "replace" });
      inside.style.clipPath = `polygon(${xL}px ${cutY - 3}px, ${xR}px ${cutY - 3}px, ${xR}px ${cutY - PH * .035}px, ${xL}px ${cutY - PH * .035}px)`;
      await sleep(180); Snd.swoosh(); await onTear(rig);
    };
    rig.focus = () => pouch.focus({ preventScroll: true });
    /** The emptied wrapper stays on the table, crumpled to one side. It is part of the picture, not something that disappears. */
    rig.linger = () => anim(pouch, [{ transform: "none" }, { transform: `translate(${-PW * .9}px, ${PH * .34}px) rotate(-13deg) scale(.72)` }], { duration: 850, easing: EASE.inOut, delay: 100 });
    /** Pull gesture for whatever comes out of the mouth. */
    rig.pullable = (el, { rise = .3, need = .34, onPull }) => {
      let pulled = false; const base = `translateY(${-PH * rise}px) rotate(-1.5deg)`;
      drag(el, {
        down: () => { if (pulled) return false; el.style.zIndex = 5; },
        move: (dx, dy) => { const up = clamp(-dy, 0, PH * .8), rb = up > PH * .5 ? PH * .5 + (up - PH * .5) * .3 : up; el.style.transform = `translateY(${-PH * rise - rb}px) rotate(${-1.5 + dx * .03}deg)`; Snd.crinkle(1, .03); if (up > PH * need && !pulled) go(); },
        up: () => { if (!pulled) anim(el, [{ transform: el.style.transform }, { transform: base }], { duration: 300, easing: EASE.spring }).then(() => fix(el, base)); },
      });
      const go = () => { if (pulled) return; pulled = true; el.style.cursor = "default"; onPull(); };
      el.addEventListener("dblclick", go); el.tabIndex = 0; el.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && go());
      return base;
    };
    return rig;
  }

  /* ------------------------------------------------------------------ TODAY'S MATERIAL: the card comes out of its own wrapper */
  const MAT_WRAP = { holographic: { kind: "holo", hue: 0 }, kraft: { kind: "kraft", hue: 0 }, matte: { kind: "matte", hue: 0 }, gold: { kind: "holo", hue: 48 }, riso: { kind: "matte", hue: 0 }, vintage: { kind: "kraft", hue: 0 } };
  /** Resolves when the person keeps the card: { rect, node, close } so the page can fly it into place. */
  function openMaterial(m) {
    return new Promise((resolve) => {
      const cer = overlay("pack"), stage = cer.stage; cer.hint("Tear it open.");
      const w = MAT_WRAP[m.id] || MAT_WRAP.matte, fx = RAR_FX[m.rarity] || RAR_FX.common;
      const card = h("div.mcard.big.in-wrap", { data: { m: m.id }, vars: { "--w": "216px" } }, h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)));
      const rig = buildRig(cer, stage, { kind: w.kind, hue: w.hue, content: card, onTear: async (rig) => {
        card.style.cssText += `;position:absolute;left:${rig.PW * .14}px;top:${rig.cutY - 216 * .38 * .1}px`;
        await anim(card, [{ transform: card.style.transform || "none" }, { transform: `translateY(${-rig.PH * .28}px) rotate(-2deg)` }], { duration: 760, easing: EASE.out });
        fix(card, `translateY(${-rig.PH * .28}px) rotate(-2deg)`); card.classList.add("out"); cer.hint("Pull it out.");
        rig.pullable(card, { rise: .28, need: .3, onPull: async () => {
          rig.linger(); Snd.swoosh();
          const r = card.getBoundingClientRect(), sr = stage.getBoundingClientRect();
          stage.append(card); card.style.cssText = `position:absolute;left:${r.left - sr.left}px;top:${r.top - sr.top}px;width:${r.width}px;z-index:8;transform:none;--w:${r.width}px;`;
          const W = stage.clientWidth, Hh = stage.clientHeight, st = stage.getBoundingClientRect();
          const dx = st.left + W / 2 - (r.left + r.width / 2), dy = st.top + Hh * .42 - (r.top + r.height / 2), k = 300 / r.width;
          const glow = h("i.rv-glow", { data: { m: m.id === "gold" ? "kraft" : m.id } }), rays = h("i.rv-rays", { data: { m: m.id } }); stage.append(glow, rays);
          anim(glow, [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)" }], { duration: 900, easing: EASE.out });
          if (m.id !== "matte") anim(rays, [{ opacity: 0, transform: "scale(.5) rotate(0)" }, { opacity: .85, transform: "scale(1) rotate(40deg)" }], { duration: 1200, easing: EASE.out });
          await anim(card, [{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${k * 1.08}) rotate(-3deg)`, offset: .7 }, { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(-2deg)` }], { duration: 820, easing: EASE.out });
          fix(card, `translate(${dx}px, ${dy}px) scale(${k}) rotate(-2deg)`);
          if (fx.n) sparkBurst(stage, fx.n, { cx: .5, cy: .42, power: m.rarity === "rare" ? 1.5 : 1, colors: m.id === "kraft" ? ["#f2d9a8", "#fff", "#e8bf80"] : undefined }); Snd.chime(fx.chime, 880);
          cer.hint("Tilt it — it catches the light."); Stk.tilt(card, { max: 12, scale: 1.02 });
          const info = h("div.rv-info", h("p.eyebrow", "Today's Material"), h("h2", m.name), h("div.rv-meta", h("span.seal.stamp-in", { data: { rarity: m.rarity } }, m.rarity), h("span.no", m.recipe)),
            h("div.rv-btns", h("button.btn.keep", { on: { click: async () => {
              Snd.tap(); const rect = card.getBoundingClientRect(), node = card.cloneNode(true); node.classList.remove("in-wrap", "big", "out"); node.getAnimations?.().forEach((a) => a.cancel());
              resolve({ rect, node, close: () => cer.close() });
            } } }, "Keep it")));
          stage.append(info); anim(info, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: EASE.out });
          await sleep(260); Snd.seal(); anim($(".seal", info), [{ opacity: 0, transform: "scale(2.4) rotate(-14deg)" }, { opacity: 1, transform: "scale(1) rotate(-2.5deg)" }], { duration: 360, easing: EASE.spring });
        } });
      } });
      card.style.cssText = `position:absolute;left:${rig.PW * .14}px;top:${rig.cutY - 216 * .38 * .1}px;--w:216px`;
      rig.focus(); cer.root._esc = () => {};
    });
  }

  return { openMaterial };
})();
