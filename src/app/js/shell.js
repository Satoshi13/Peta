/* The one window: titlebar, navigation, and page transitions (a different one per design direction). */
const Pages = {}; // id -> { build(): HTMLElement, enter?(el), leave?(el) }
const Shell = (() => {
  const win = () => $("#win"), viewport = () => $("#viewport");
  let current = null, navigating = false, pos = { x: 0, y: 0 };

  function applyAssetVars() {
    const css = ":root{" + Object.keys(A).map((k) => `--a-${k}:url("${new URL(A[k], location.href).href}");`).join("") + "}";
    const st = h("style", { id: "asset-vars" }); st.textContent = css; document.head.append(st);
  }

  function toast(msg, ms = 2200) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms);
  }

  function badges() {
    const gifts = S.gifts.filter((g) => !g.opened).length;
    return { gifts, today: S.dayState === "arrived" ? 1 : 0 };
  }
  function renderNav() {
    const nav = $("#nav"), b = badges();
    const top = h("div.nav-top"), foot = h("div.nav-foot");
    NAV.forEach((n, i) => {
      const count = n.id === "gifts" ? b.gifts : 0, dot = n.id === "today" && b.today;
      if(n.group) top.append(h("span.nav-group", n.group));
      const label = n.label + (count ? `, ${count} unopened` : dot ? ", New envelope" : "");
      const button = h("button.nav-item", { data: { page: n.id }, style: { "--ti": i }, vars: { "--tab-img": `var(--a-${n.tab})`, "--tab-i": i },
        "aria-label":label, "aria-current": S.page === n.id ? "page" : null, on: { click: (e) => go(n.id, { origin: e.currentTarget }) } },
        h("span.ni-tile", h("span.ni-icon", { style: { backgroundImage: `var(--a-${n.icon})` } })),
        h("span.ni-label", n.label),
        count ? h("i.ni-badge", String(count)) : dot ? h("i.ni-dot", {"aria-label":"New envelope"}) : null,
        h("span.ni-key", {"aria-hidden":"true"}, n.id === "settings" ? "⌘," : `⌘${i+1}`));
      (n.id === "settings" ? foot : top).append(button);
    });
    const name = S.name.trim() || "You";
    foot.append(h("button.nav-account", {"aria-label":`Account: ${name}. Open Settings`,on:{click:()=>go("settings")}},
      CreatorIcon.image(), h("span", h("b", name), h("small", `${S.developer ? "Developer · " : ""}${S.lib.length} sticker${S.lib.length===1 ? "" : "s"}`))));
    nav.replaceChildren(top, foot);
  }

  function markNav() { document.body.dataset.page = S.page; $$(".nav-item").forEach((b) => b.toggleAttribute("aria-current", b.dataset.page === S.page)); $$(".nav-item[aria-current]").forEach((b) => b.setAttribute("aria-current", "page")); }

  function build(id) {
    const wrap = h("section.page", { data: { page: id, art: "page-" + id } });
    const el = Pages[id].build();
    wrap.append(el);
    if (id === "book") {
      wrap.append(
        h("div.book-paper-parts", { "aria-hidden": "true" },
          h("i.page-gutter", { data: { art: "page-gutter" } }),
          h("i.page-edge-right", { data: { art: "page-edge-right" } }),
          h("i.page-edge-bottom", { data: { art: "page-edge-bottom" } }),
          h("i.page-corner", { data: { art: "page-corner-curl" } })),
        h("div.book-binding", { "aria-hidden": "true", data: { art: "spiral-binding" } }, h("i.binding-band", h("i.binding-middle"))));
      queueMicrotask(sizeBookBinding);
    }
    return wrap;
  }
  function sizeBookBinding() {
    // Delivered 128×1000 tile: twenty cells, ring centres at 25 + 50*k.
    // End only at a cell boundary so the 64px end caps keep the same phase.
    $$(".book-binding").forEach(e => {
      const pitch = parseFloat(getComputedStyle(e).width) / 128 * 50;
      if(pitch > 0) e.firstElementChild.style.height = Math.floor(e.clientHeight / pitch) * pitch + "px";
    });
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
    if (current && S.page === id && !o.force) { PackZoom.dispose(true); return; }
    const oldIdx = NAV.findIndex((n) => n.id === S.page), newIdx = NAV.findIndex((n) => n.id === id);
    const dir = newIdx >= oldIdx ? 1 : -1;
    PackZoom.dispose();
    const prevId = S.page; S.page = id; markNav();
    Pages[prevId]?.leave?.(current);
    const next = build(id);
    if (!current || o.instant || !win() || win().hidden) {
      vp.replaceChildren(next); current = next; Pages[id].enter?.(next, o); return;
    }
    navigating = true;
    Pages[id].arrive?.(next, { ...o, dir });
    try { await TRANS[document.body.dataset.shell](vp, current, next, dir, o); } finally { navigating = false; }
    current = next; Pages[id].enter?.(next, o);
  }
  /** Rebuild the current page in place (after state changes), no transition. */
  function refresh() {
    if (!current || navigating) return;
    PackZoom.dispose();
    Pages[S.page]?.leave?.(current);
    const next = build(S.page); const st = current.querySelector(".page-in")?.scrollTop || 0;
    viewport().replaceChildren(next); current = next; Pages[S.page].enter?.(next, { refresh: true });
    const pi = next.querySelector(".page-in"); if (pi) pi.scrollTop = st; renderNav();
  }

  async function open(id, o = {}) {
    await Bridge.reload();
    win().hidden = false; S.windowOpen = true; renderNav();
    await go(id || S.page, { ...o, instant: true, force: true });
    requestAnimationFrame(() => Vibrancy.sync());
  }
  async function close() { S.windowOpen = false; Pages[S.page]?.suspend?.(); await Bridge.window.hide(); }
  function initChrome() {
    new ResizeObserver(sizeBookBinding).observe(viewport());
    $("#wc-close").addEventListener("click", close);
    $("#wc-min").addEventListener("click", () => { S.windowOpen = false; Pages[S.page]?.suspend?.(); Bridge.window.minimize(); });
    $("#wc-zoom").addEventListener("click", () => Bridge.window.toggleMaximize());
    $("#titlebar").addEventListener("mousedown", e => { if (e.button === 0 && !e.target.closest("button")) { e.preventDefault(); Bridge.window.startDragging(); } });
    $("#resize-h").addEventListener("mousedown", e => { if (e.button === 0) { e.preventDefault(); Bridge.window.startResizeDragging("SouthEast"); } });
    document.addEventListener("keydown", e => {
      if(e.defaultPrevented || !document.hasFocus()) return;
      const page = PetaMath.navShortcut(e, { input:!!e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'), dialog:Bridge.dialogOpen || !!$("dialog[open]"), busy:Bridge.busy || !!PackZoom.active, ceremony:!!$(".cer") });
      if(page) { e.preventDefault(); go(page, {via:"nav"}); }
    });
    document.addEventListener("keydown", e => { if(e.key === "Escape" && !e.defaultPrevented && !$(".cer") && !e.target.closest("input")) close(); });
  }
  function setShell(name) {
    if (!["studio", "desk"].includes(name)) return;
    S.shell = name; document.body.dataset.shell = name; Bridge.savePreferences(); Vibrancy.sync();
  }
  return { applyAssetVars, toast, renderNav, go, refresh, open, close, initChrome, setShell, get current() { return current; } };
})();
