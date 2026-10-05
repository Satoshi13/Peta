/* Ceremonies: opening a Pack (tear -> pull out -> unwrap -> reveal), opening a Gift (break the seal -> ...), sealing a gift.
   The point: every step is something you do with your hand, and the last one is yours to play with (tilt the sticker). */
const fix = (el, tf) => { el.getAnimations().forEach((a) => a.cancel()); el.style.transform = tf; };
const Cer = (() => {
  const RAR_FX = { common: { n: 0, chime: 1 }, uncommon: { n: 16, chime: 3 }, rare: { n: 46, chime: 6 }, special: { n: 60, chime: 7 }, archive: { n: 30, chime: 4 } };

  function overlay(kind) {
    Bridge.enterCeremony();
    const root = h("div.cer", { data: { kind }, tabindex: -1 }), stage = h("div.cer-stage"), top = h("p.cer-hint");
    root.append(h("i.cer-bg"), top, stage); $("#overlay").append(root);
    anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 420 });
    const close = async ({keepScene=false} = {}) => { await anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 320 }); root.remove(); if(!keepScene) await Bridge.leaveCeremony(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") root._esc && root._esc(); };
    document.addEventListener("keydown", onKey);
    return { root, stage, close, hint: (t) => { if (top.textContent === t) return; top.textContent = t; anim(top, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 400 }); } };
  }

  /* After the sleeve is pulled out: unwrap it, reveal the sticker, let the person play with it. */
  async function unwrapAndReveal({ cer, stage, sleeve, entry, source, onKeep, onLater }) {
    cer.hint("Tilt it to catch the light.");
    const res = await resOf(entry, { max: 560 }), mat = MAT[entry.material], fx = RAR_FX[entry.rarity || mat.rarity];
    const W = stage.clientWidth, Hh = stage.clientHeight;
    const holder = h("div.rv-holder");
    const max = Math.min(280, W * .45, Hh * .4);
    const sw = max * Math.min(1, res.aspect);
    const stk = Stk.el(res, sw); holder.append(stk);
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
    if (fx.n) sparkBurst(stage, fx.n, { cx: .5, cy: .44, power: (entry.rarity || mat.rarity) === "rare" ? 1.5 : 1, colors: entry.material === "kraft" ? ["#f2d9a8", "#fff", "#e8bf80"] : undefined });
    await anim(holder, [{ opacity: 0, transform: "scale(.5) rotate(-12deg)" }, { opacity: 1, transform: "scale(1.06) rotate(2deg)", offset: .6 }, { opacity: 1, transform: "scale(1) rotate(0)" }], { duration: 760, easing: EASE.out });
    sleeve.remove();
    holder.style.opacity = 1; holder.getAnimations().forEach((a) => a.cancel());
    // alive: tilt + sheen
    const tilter = h("div.rv-tilt", stk); holder.append(tilter); Stk.tilt(tilter, { max:5, scale:1.015, trigger:holder });
    cer.hint("Tilt it to catch the light.");
    // who/what is it
    const info = h("div.rv-info", h("p.eyebrow", source), h("h2", titleOf(entry)),
      h("div.rv-meta", h("span.seal.stamp-in", { data: { rarity: entry.rarity || mat.rarity } }, mat.name + " · " + (entry.rarity || mat.rarity)), h("span.no", entry.kind === "received" && entry.edition != null ? `Edition #${pad4(entry.edition)}` : "")),
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
    const K = PACK_KINDS[kind] || PACK_KINDS.holo, PW = Math.min(310, stage.clientHeight * .48, stage.clientWidth * .55), PH = PW * 4 / 3, CUT = K.cut;
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
    onPointerFollow(stage, (x,y,e,amount) => { pouch.style.setProperty("--sx",lerp(30,(1-x)*100,amount)+"%"); pouch.style.setProperty("--sy",lerp(30,(1-y)*100,amount)+"%"); }, () => { pouch.style.setProperty("--sx","30%"); pouch.style.setProperty("--sy","30%"); });
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
    const springBack = async () => { if(reduced()) { setProg(0); return; } const from = rig.prog, t0 = performance.now(); Snd.tap(); await new Promise((res) => { (function f(now) { const t = clamp((now - t0) / 380, 0, 1), e = 1 - Math.pow(1 - t, 3); setProg(from * (1 - e) * (1 + Math.sin(t * 9) * .08 * (1 - t))); t < 1 ? requestAnimationFrame(f) : res(); })(t0); }); setProg(0); };
    const autoTear = async () => { if (rig.done) return; if(reduced()) { setProg(1); finish(); return; } const t0 = performance.now(); await new Promise((res) => { (function f(now) { const t = clamp((now - t0) / 620, 0, 1); setProg(t); Snd.crinkle(1, .05); t < 1 ? requestAnimationFrame(f) : res(); })(t0); }); finish(); };
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

  /* ------------------------------------------------------------------ TODAY'S MATERIAL: one envelope, one card */
  /** Resolves when the person keeps the card; the daily receipt is committed by Today only once. */
  function openMaterial(m) {
    return new Promise(resolve => {
      const cer=overlay("material"), stage=cer.stage, envelope=EnvelopeScene();
      const fx=RAR_FX[m.rarity] || RAR_FX.common;
      envelope.classList.add("material-envelope");
      for (const name of ["role","tabindex","aria-label"]) envelope.removeAttribute(name);
      const openedFlap=img("envFlap","layer flap-open"); openedFlap.style.opacity=0;
      $(".env-float",envelope).append(openedFlap);
      const card=h("div.mcard.big", {data:{concealed:"true"},role:"button",tabindex:-1,"aria-label":"Pull out the material card"}, h("i.art"),h("span.lab"));
      $(".card",envelope).replaceWith(h("div.material-card-slot",card)); stage.append(envelope);
      const envelopeSize=new ResizeObserver(()=>card.style.setProperty("--w",envelope.clientWidth*.48+"px"));
      envelopeSize.observe(envelope); card.style.setProperty("--w",envelope.clientWidth*.48+"px");
      let opened=false, pulled=false;
      const base="translateY(-92%) rotate(-2deg)";
      const pull=async () => {
        if (!opened || pulled) return; pulled=true; envelopeSize.disconnect();
        for (const name of ["role","tabindex","aria-label"]) card.removeAttribute(name);
        cer.hint("Tilt it to catch the light."); Snd.swoosh();
        anim(envelope,[{opacity:1},{opacity:0}],{duration:280}).then(()=>envelope.remove());
        const r = card.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        const position = h("div.material-card-position", {style:{position:"absolute",left:r.left-sr.left+"px",top:r.top-sr.top+"px",width:r.width+"px",zIndex:8}});
        stage.append(position); position.append(card);
        delete card.dataset.concealed; card.dataset.m=m.id;
        $(".lab",card).append(h("b",m.name),h("small",m.rarity));
        card.style.cssText = `position:relative;transform:none;--w:${r.width}px;`;
        const {width,height} = card.getBoundingClientRect();
        let resize;
        let kept=false;
        const info = h("div.rv-info", {style:{opacity:0,pointerEvents:"none"}}, h("p.eyebrow", "Today's Material"), h("h2", m.name), h("div.rv-meta", h("span.seal.stamp-in", { data: { rarity: m.rarity } }, m.rarity), h("span.no", m.recipe)),
          h("div.rv-btns", h("button.btn.keep", { disabled:true, on: { click: async e => {
            if (kept) return; kept=true; e.currentTarget.disabled=true; resize?.disconnect(); Snd.tap(); const rect = card.getBoundingClientRect(), node = card.cloneNode(true); node.classList.remove("in-wrap", "big", "out"); node.getAnimations?.().forEach((a) => a.cancel());
            resolve({ rect, node, close: opts => cer.close(opts) });
          } } }, "Keep it")));
        stage.append(info);
        const hint = $(".cer-hint", cer.root);
        const layout = () => {
          const st = stage.getBoundingClientRect(), hr = hint.getBoundingClientRect();
          const fit = PetaMath.fitMaterialCard({stageWidth:stage.clientWidth,stageHeight:stage.clientHeight,cardWidth:width,cardHeight:height,hintBottom:hr.bottom-st.top,infoTop:stage.clientHeight-info.offsetHeight});
          return {dx:fit.cx-(position.offsetLeft+width/2),dy:fit.cy-(position.offsetTop+height/2),k:fit.scale,cy:fit.cy};
        };
        const target = ({dx,dy,k}) => `translate(${dx}px, ${dy}px) scale(${k})`;
        const snap = fit => {
          const w = width * fit.k;
          position.style.left = stage.clientWidth/2-w/2+"px"; position.style.top = fit.cy-height*fit.k/2+"px";
          position.style.width = w+"px"; card.style.setProperty("--w",w+"px");
          fix(position,"none"); // Render the final size crisply instead of enlarging a small GPU surface.
        };
        const fit = layout();
        await anim(position, [{transform:"none"},{transform:target(fit)}], {duration:520,easing:EASE.out});
        snap(fit); fix(card,"rotate(-2deg)"); Snd.chime(fx.chime,880);
        Stk.tilt(card, { max:4, scale:1.01, baseTransform:"rotate(-2deg)", trigger:position });
        resize = new ResizeObserver(() => { const fit = layout(); snap(fit); });
        resize.observe(stage); resize.observe(info); resize.observe(hint);
        info.style.opacity = 1; info.style.pointerEvents = "";
        anim(info, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: EASE.out });
        const keep=$(".keep",info); keep.disabled=false; keep.focus({preventScroll:true});
      };
      drag(card, {
        down:()=> { if (!opened || pulled) return false; fix(card,base); },
        move:(dx,dy)=> {
          if (pulled) return;
          const up=clamp(-dy,0,envelope.clientHeight*.6);
          card.style.transform=`translateY(calc(-92% - ${up}px)) rotate(-2deg)`;
          if (up>envelope.clientHeight*.22) pull();
        },
        up:()=> { if (!pulled) anim(card,[{transform:card.style.transform},{transform:base}],{duration:240,easing:EASE.out}).then(()=>{if(!pulled)fix(card,base);}); },
      });
      card.addEventListener("dblclick",pull);
      card.addEventListener("keydown",e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();pull();}});
      const show=async () => {
        cer.hint("Opening your envelope."); Snd.crinkle(4,.2);
        const back=anim(openedFlap,[{opacity:0,transform:"scaleY(0)"},{opacity:0,transform:"scaleY(0)",offset:.5},{opacity:1,transform:"scaleY(-1)"}],{duration:420,easing:EASE.inOut});
        await anim($(".flap",envelope),[{transform:"rotateX(0)"},{transform:"rotateX(-172deg)"}],{duration:420,easing:EASE.inOut});
        await back;
        await anim(card,[{transform:"none"},{transform:base}],{duration:360,easing:EASE.out});
        fix(card,base); opened=true;
        cer.hint("Pull it out."); card.tabIndex=0; card.focus({preventScroll:true});
      };
      show(); cer.root._esc=()=>{};
    });
  }

  /* ------------------------------------------------------------------ GIFT (open) */
  async function openGift(gift) {
    const cer = overlay("gift"), stage = cer.stage; cer.hint("Break the seal.");
    const EW = Math.min(420, stage.clientWidth * .6, stage.clientHeight * .75), EH = EW * 340 / 480;
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
      if (opened) return; opened = true; cer.hint(""); Snd.crack(); Haptic.tap("seal");
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
      try { Bridge.busy = true; const id=await Bridge.invoke("gift_open", {giftId:gift.id}); entry=await Bridge.entry(id); await Bridge.reload(); }
      catch(e) { Bridge.busy=false; await cer.close(); Shell.toast(String(e)); return; }
      let pulled = false; const base = sleeve.style.transform;
      drag(sleeve, {
        down: () => !pulled,
        move: (dx, dy) => { const up = clamp(-dy, 0, 300); sleeve.style.transform = `translateY(${-EH * .34 - up}px) rotate(${1.5 + dx * .03}deg)`; Snd.crinkle(1, .03); if (up > 110 && !pulled) pull(); },
        up: () => { if (!pulled) { anim(sleeve, [{ transform: sleeve.style.transform }, { transform: base }], { duration: 300, easing: EASE.spring }).then(() => fix(sleeve, base)); } },
      });
      sleeve.addEventListener("dblclick", () => !pulled && pull()); sleeve.tabIndex = 0; sleeve.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && !pulled && pull());
      async function pull() {
        pulled = true; gift.opened = true; Shell.renderNav();
        anim(note, [{ opacity: 1 }, { opacity: 0, transform: note.style.transform + " translateY(-30px)" }], { duration: 500, delay: 100 });
        anim(env, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(200px) rotate(4deg)", opacity: 0 }], { duration: 700, easing: "cubic-bezier(.5,0,.8,.4)", delay: 120 });
        const r = sleeve.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        stage.append(sleeve); sleeve.style.cssText = `position:absolute;left:${r.left - sr.left}px;top:${r.top - sr.top}px;width:${r.width}px;z-index:8;transform:none;`;
        await unwrapAndReveal({ cer, stage, sleeve, entry, source: `Gift from ${gift.from}`, onKeep: keep, onLater: later });
      }
    };
    const keep = async () => { Bridge.busy=false; await cer.close(); Shell.refresh(); Shell.toast("A gift from " + gift.from + "."); await Desktop.print(entry); };
    const later = async () => { Bridge.busy=false; await Bridge.invoke("print_later"); await cer.close(); Shell.refresh(); Shell.toast("Waiting at the print slot — open the Peta menu."); Shell.renderNav(); };
    wax.addEventListener("click", crack); wax.addEventListener("pointerdown", () => Snd.tap()); wax.tabIndex = 0; wax.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && crack());
    wax.style.cursor = "pointer"; cer.root._esc = () => { if (!opened) cer.close(); };
  }

  /* ------------------------------------------------------------------ GIFT (seal and save) */
  async function sealGift(entry, to, note) {
    Bridge.dialogOpen = true;
    let saved;
    try { saved=await Bridge.invoke("gift_send", {stickerId:entry.id, to, note}); }
    catch(e) { Shell.toast(String(e)); return; } finally { Bridge.dialogOpen=false; }
    if (!saved) return;
    const cer = overlay("seal"), stage = cer.stage; cer.hint("");
    const EW = Math.min(400, stage.clientWidth * .58, stage.clientHeight * .68), EH = EW * 2 / 3;
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
    await cer.close(); Shell.toast(`Saved “${to}.peta” — your own sticker stays in the Collection.`);
  }
  async function openPack(pack) {
    if (!packOpenable(pack)) return;
    const cer = overlay("pack"), stage = cer.stage; cer.hint("Tear along the top.");
    const sleeve = h("div.pk-sleeve", img("mystery")); let entry = null;
    const rig = buildRig(cer, stage, { kind: pack.kind, hue: pack.hue, content: sleeve, onTear: async (rig) => {
      try { Bridge.busy = true; const opened=await Bridge.invoke("pack_open", {packId:pack.id}); entry=await Bridge.entry(opened.stickerId); entry.rarity=opened.rarity; entry.title=opened.name || entry.title; pack.left=Array(opened.remaining).fill(null); await Bridge.reload(); Shell.renderNav(); }
      catch(e) { Bridge.busy=false; await cer.close(); Shell.toast(String(e)); return; }
      await anim(sleeve, [{ transform: sleeve.style.transform }, { transform: `translateY(${-rig.PH * .3}px) rotate(-1.5deg)` }], { duration: 760, easing: EASE.out });
      fix(sleeve, `translateY(${-rig.PH * .3}px) rotate(-1.5deg)`); sleeve.classList.add("out"); cer.hint("Pull it out.");
      rig.pullable(sleeve, { onPull: async () => {
        rig.linger();
        const r = sleeve.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        stage.append(sleeve); sleeve.style.cssText = `position:absolute;left:${r.left - sr.left}px;top:${r.top - sr.top}px;width:${r.width}px;z-index:8;transform:none;`;
        await unwrapAndReveal({ cer, stage, sleeve, entry, source: `${pack.title} · ${pack.left.length} left`, onKeep: keep, onLater: later });
      } });
    } });
    sleeve.style.cssText = `width:${rig.PW * .72}px;left:${rig.PW * .14}px;top:${rig.cutY - rig.PW * .72 * .12}px`;
    const keep = async () => { Bridge.busy=false; await cer.close(); Shell.refresh(); Shell.toast("It's yours."); await Desktop.print(entry); };
    const later = async () => { Bridge.busy=false; await Bridge.invoke("print_later"); await cer.close(); Shell.refresh(); Shell.toast("Waiting at the print slot — open the Peta menu."); Shell.renderNav(); };
    cer.root._esc = () => { if (!rig.done) cer.close(); else if (entry && $(".rv-info")) later(); };
    rig.focus();
  }

  return { openMaterial, openGift, sealGift, openPack };
})();

const GiftSeal = (e,to,note) => Cer.sealGift(e,to,note);
