/* The one window: titlebar, navigation, and page transitions (a different one per design direction). */
const Pages = {}; // id -> { build(): HTMLElement, enter?(el), leave?(el) }
const Shell = (() => {
  const win = () => $("#win"), viewport = () => $("#viewport");
  let current = null, navigating = false, pos = { x: 0, y: 0 };

  function applyAssetVars() {
    const GEAR = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3e6ea"/><stop offset="1" stop-color="#9aa1ab"/></linearGradient></defs><path fill="url(#g)" stroke="#6f757e" stroke-width="1.2" d="M20 4h8l1.4 5.2 4.2 1.8 4.7-2.8 5.6 5.6-2.8 4.7 1.8 4.2L48 20v8l-5.1 1.4-1.8 4.2 2.8 4.7-5.6 5.6-4.7-2.8-4.2 1.8L28 44h-8l-1.4-5.1-4.2-1.8-4.7 2.8L4.1 34.3l2.8-4.7-1.8-4.2L0 24v-4l5.1-1.4 1.8-4.2-2.8-4.7 5.6-5.6 4.7 2.8 4.2-1.8z" transform="translate(0 2) scale(.96)"/><circle cx="24" cy="24" r="7.5" fill="#f4efe4" stroke="#6f757e" stroke-width="1.2"/></svg>');
    const css = ":root{--a-gear:url(\"" + GEAR + "\");" + Object.keys(A).map((k) => `--a-${k}:url("${new URL(A[k], location.href).href}");`).join("") + "}";
    const st = h("style", { id: "asset-vars" }); st.textContent = css; document.head.append(st);
  }

  function toast(msg, ms = 2200) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms);
  }

  function badges() {
    const gifts = S.gifts.filter((g) => !g.opened).length;
    return { gifts, today: S.dayState === "done" ? 0 : 1 };
  }
  function renderNav() {
    const nav = $("#nav"), b = badges();
    nav.replaceChildren(...NAV.map((n, i) => {
      const count = n.id === "gifts" ? b.gifts : n.id === "today" ? (b.today ? "•" : 0) : 0;
      return h("button.nav-item", { data: { page: n.id }, style: { "--ti": i }, vars: { "--tab-img": `var(--a-${n.tab})`, "--tab-i": i },
        "aria-current": S.page === n.id ? "page" : null, on: { click: (e) => go(n.id, { origin: e.currentTarget }) } },
        h("span.ni-icon", { style: { backgroundImage: `var(--a-${n.icon})` } }),
        h("span.ni-label", n.label),
        count ? h("i.ni-badge", count) : null);
    }));
    $("#tray-dot").classList.toggle("on", b.gifts > 0 || S.dayState !== "done" || !!S.pending);
  }
  function markNav() { $$(".nav-item").forEach((b) => b.toggleAttribute("aria-current", b.dataset.page === S.page)); $$(".nav-item[aria-current]").forEach((b) => b.setAttribute("aria-current", "page")); }

  function build(id) {
    const wrap = h("section.page", { data: { page: id } });
    const el = Pages[id].build();
    wrap.append(el); return wrap;
  }
  function cloneStatic(node) {
    const c = node.cloneNode(true);
    const src = node.querySelectorAll("canvas"), dst = c.querySelectorAll("canvas");
    src.forEach((s, i) => { try { dst[i].width = s.width; dst[i].height = s.height; dst[i].getContext("2d").drawImage(s, 0, 0); } catch {} });
    c.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
    c.style.pointerEvents = "none"; c.querySelectorAll("*").forEach((e) => e.removeAttribute("tabindex"));
    return c;
  }

  /* ---------- transitions ---------- */
  const TRANS = {
    /* A · Notebook: the page turns over the spiral */
    async notebook(vp, cur, next, dir) {
      Snd.flip();
      const forward = dir >= 0;
      const leaf = h("div.leaf"), front = h("div.leaf-face.front"), back = h("div.leaf-face.back", h("i.back-ghost")), shade = h("i.leaf-shade"), under = h("i.under-shade");
      vp.classList.add("flipping");
      if (forward) {
        next.classList.add("under"); vp.append(next, under);
        front.append(cloneStatic(cur), shade); leaf.append(front, back); vp.append(leaf); cur.remove();
        const a = anim(leaf, [{ transform: "rotateY(0deg)" }, { transform: "rotateY(-180deg)" }], { duration: 980, easing: EASE.paper });
        anim(shade, [{ opacity: 0 }, { opacity: .55, offset: .5 }, { opacity: 0 }], { duration: 980, easing: "linear" });
        anim(under, [{ opacity: .55, transform: "translateX(0)" }, { opacity: .0, transform: "translateX(14%)" }], { duration: 980, easing: EASE.paper });
        anim(back, [{ opacity: 1 }, { opacity: 1, offset: .84 }, { opacity: 0 }], { duration: 980, easing: "linear" });
        await a;
      } else {
        const ghost = cloneStatic(next);
        cur.classList.add("under"); vp.append(cur, under);
        front.append(ghost, shade); leaf.append(front, back); vp.append(leaf);
        const a = anim(leaf, [{ transform: "rotateY(-180deg)" }, { transform: "rotateY(0deg)" }], { duration: 980, easing: EASE.paper });
        anim(shade, [{ opacity: 0 }, { opacity: .5, offset: .5 }, { opacity: 0 }], { duration: 980, easing: "linear" });
        anim(under, [{ opacity: 0, transform: "translateX(14%)" }, { opacity: .55, transform: "translateX(0)" }], { duration: 980, easing: EASE.paper });
        await a; cur.remove(); vp.append(next);
      }
      leaf.remove(); under.remove(); next.classList.remove("under"); vp.classList.remove("flipping");
      if (!next.isConnected) vp.append(next);
    },
    /* B · Desk: sheets of paper laid on top of each other */
    async desk(vp, cur, next, dir) {
      Snd.swoosh();
      vp.append(next); cur.style.zIndex = 1; next.style.zIndex = 2;
      const f = dir >= 0;
      const a = anim(next, [{ transform: `translate(${f ? 70 : -70}px, ${f ? 46 : -20}px) rotate(${f ? 2.4 : -2}deg) scale(.985)`, opacity: 0 }, { transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 }], { duration: 640, easing: EASE.out });
      anim(cur, [{ transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 }, { transform: `translate(${f ? -46 : 46}px, -14px) rotate(${f ? -1.6 : 1.6}deg) scale(.972)`, opacity: 0 }], { duration: 560, easing: EASE.inOut });
      await a; cur.remove(); next.getAnimations().forEach((x) => x.cancel()); next.style.zIndex = "";
    },
    /* C · Studio: zoom into the thing you touched */
    async studio(vp, cur, next, dir, o = {}) {
      Snd.swoosh();
      vp.append(next); cur.style.zIndex = 1; next.style.zIndex = 2;
      const r = vp.getBoundingClientRect(), t = o.origin?.getBoundingClientRect();
      const ox = t ? ((t.left + t.width / 2 - r.left) / r.width) * 100 : 50, oy = t ? ((t.top + t.height / 2 - r.top) / r.height) * 100 : 50;
      const zoom = !!t && o.via !== "nav";
      next.style.transformOrigin = `${ox}% ${oy}%`; cur.style.transformOrigin = `${ox}% ${oy}%`;
      const a = anim(next, zoom
        ? [{ transform: "scale(.9)", opacity: 0, filter: "blur(6px)" }, { transform: "scale(1)", opacity: 1, filter: "blur(0)" }]
        : [{ transform: `translateY(${dir >= 0 ? 16 : -16}px)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 560, easing: EASE.out });
      anim(cur, zoom ? [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.12)", opacity: 0, filter: "blur(4px)" }] : [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: EASE.inOut });
      await a; cur.remove(); next.getAnimations().forEach((x) => x.cancel()); next.style.zIndex = ""; next.style.transformOrigin = "";
    },
  };

  async function go(id, o = {}) {
    if (!Pages[id] || navigating) return;
    const vp = viewport();
    if (current && S.page === id && !o.force) return;
    const oldIdx = NAV.findIndex((n) => n.id === S.page), newIdx = NAV.findIndex((n) => n.id === id);
    const dir = newIdx >= oldIdx ? 1 : -1;
    const prevId = S.page; S.page = id; markNav();
    Pages[prevId]?.leave?.(current);
    const next = build(id);
    if (!current || o.instant || !win() || win().hidden) {
      vp.replaceChildren(next); current = next; Pages[id].enter?.(next, o); return;
    }
    navigating = true;
    try { await TRANS[document.body.dataset.shell](vp, current, next, dir, o); } finally { navigating = false; }
    current = next; Pages[id].enter?.(next, o);
  }
  /** Rebuild the current page in place (after state changes), no transition. */
  function refresh() {
    if (!current || navigating) return;
    const next = build(S.page); const st = current.querySelector(".page-in")?.scrollTop || 0;
    viewport().replaceChildren(next); current = next; Pages[S.page].enter?.(next, { refresh: true });
    const pi = next.querySelector(".page-in"); if (pi) pi.scrollTop = st; renderNav();
  }

  /* ---------- window ---------- */
  function placeWin() { win().style.setProperty("--dx", pos.x + "px"); win().style.setProperty("--dy", pos.y + "px"); }
  async function open(id, o = {}) {
    Menu.close();
    const w = win();
    if (!w.hidden) { if (id && id !== S.page) go(id, o); w.classList.remove("dim-out"); return; }
    w.hidden = false; S.windowOpen = true; renderNav();
    if (id) S.page = id;
    const vp = viewport(); const next = build(S.page); vp.replaceChildren(next); current = next; Pages[S.page].enter?.(next, { open: true });
    markNav();
    const tr = $("#tray").getBoundingClientRect(), wr = w.getBoundingClientRect();
    const dx = tr.left + tr.width / 2 - (wr.left + wr.width / 2), dy = tr.top - (wr.top + wr.height / 2);
    Snd.swoosh();
    await anim(w, [{ transform: `translate(calc(var(--dx,0px) + ${dx}px), calc(var(--dy,0px) + ${dy}px)) scale(.08)`, opacity: 0 }, { transform: "translate(var(--dx,0px), var(--dy,0px)) scale(1)", opacity: 1 }], { duration: 560, easing: EASE.spring });
    w.getAnimations().forEach((x) => x.cancel());
  }
  async function close() {
    const w = win(); if (w.hidden) return;
    const tr = $("#tray").getBoundingClientRect(), wr = w.getBoundingClientRect();
    const dx = tr.left + tr.width / 2 - (wr.left + wr.width / 2), dy = tr.top - (wr.top + wr.height / 2);
    Snd.swoosh();
    await anim(w, [{ transform: "translate(var(--dx,0px), var(--dy,0px)) scale(1)", opacity: 1 }, { transform: `translate(calc(var(--dx,0px) + ${dx}px), calc(var(--dy,0px) + ${dy}px)) scale(.08)`, opacity: 0 }], { duration: 380, easing: EASE.inOut });
    w.hidden = true; S.windowOpen = false; w.getAnimations().forEach((x) => x.cancel()); renderNav();
  }

  function initChrome() {
    $(".tb-logo").style.setProperty("--logo", "var(--a-logo)");
    $(".l-red").addEventListener("click", close);
    drag($("#titlebar"), {
      down: (e) => !e.target.closest("button"),
      move: (dx, dy) => { win().style.setProperty("--dx", pos.x + dx + "px"); win().style.setProperty("--dy", pos.y + dy + "px"); },
      up: (e, moved) => { if (!moved) return; const w = win(); pos = { x: parseFloat(w.style.getPropertyValue("--dx")), y: parseFloat(w.style.getPropertyValue("--dy")) }; },
    });
    $("#titlebar").addEventListener("dblclick", () => { pos = { x: 0, y: 0 }; placeWin(); });
  }
  function setShell(name, quiet) {
    S.shell = name; document.body.dataset.shell = name;
    $$("#shell-switch button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.shell === name)));
    if (!quiet && current) refresh();
  }
  return { applyAssetVars, toast, renderNav, go, refresh, open, close, initChrome, setShell, placeWin, get current() { return current; }, reset() { current = null; navigating = false; pos = { x: 0, y: 0 }; placeWin(); } };
})();

/* ---------- the menu bar's Peta menu: the way back into the one window ---------- */
const Menu = (() => {
  let openState = false;
  function items() {
    const b = badges2();
    const pend = S.pending;
    const status = S.dayState === "done" ? "Today's Peta is stuck ✓" : S.dayState === "arrived" ? "Today's Material has arrived" : "Today's Peta isn't stuck yet";
    const it = (icon, label, page, badge) => h("button", { on: { click: () => { Menu.close(); Shell.open(page); } } }, icon ? h("img", { src: A[icon] }) : null, label, badge ? h("span.tm-badge", badge) : null);
    return [
      h("div.tm-head", h("i"), h("div", h("b", "Peta"), h("small", status))),
      pend ? h("button", { on: { click: () => { Menu.close(); Desktop.showPrint(); } } }, h("img", { src: A.sheet }), "Sticker waiting at the print slot…") : null,
      it("chCreate", "Create…", "create"), it("envBack", "Today", "today"), it("chGift", "Gifts", "gifts", b.gifts || ""),
      it("chPack", "Open a Pack", "packs"), it("chCollection", "Sticker Book", "book"), it("cardHolo", "Material Book", "materials"),
      h("hr"), h("button", { on: { click: () => { Menu.close(); Shell.open(); } } }, S.windowOpen ? "Bring Peta to the front" : "Open Peta"),
    ];
  }
  const badges2 = () => ({ gifts: S.gifts.filter((g) => !g.opened).length });
  async function toggle() { openState ? close() : open(); }
  async function open() {
    const m = $("#tray-menu"); m.replaceChildren(...items().filter(Boolean)); m.hidden = false; openState = true; $("#tray").setAttribute("aria-expanded", "true");
    await anim(m, [{ opacity: 0, transform: "scale(.94) translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE.out });
  }
  function close() { if (!openState) return; openState = false; $("#tray-menu").hidden = true; $("#tray").removeAttribute("aria-expanded"); }
  function init() {
    $("#tray").addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener("pointerdown", (e) => { if (openState && !e.target.closest("#tray-menu,#tray")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }
  return { init, close, open, toggle };
})();
