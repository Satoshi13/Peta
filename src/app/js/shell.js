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
  let problem = null;
  function clearProblem() { problem?.remove(); problem = null; }
  function error(cause, {retry, message} = {}) {
    if(cause?.name === "AbortError" && cause.handled) return;
    if (cause?.handled && problem && !retry && !message) return;
    if (cause?.name === "PetaLoadError") {
      retry ||= async () => { await Bridge.reload(); renderNav(); refresh(); };
      message ||= "The latest changes could not be loaded. Your current view is still available.";
    }
    clearProblem();
    const status = h("p", message || userError(cause));
    const retryButton = retry ? h("button.btn.paper.small", {type:"button", on:{click:async()=>{
      const shown = problem;
      retryButton.disabled=true; retryButton.textContent="Retrying…";
      try { await retry(); if(problem === shown)clearProblem(); }
      catch (next) { error(next, {retry, message}); }
    }}}, "Try again") : null;
    problem = h("aside.app-notice", {role:"alert", "aria-label":"Peta needs attention"}, status,
      retryButton, CloseButton("Dismiss message", {on:{click:clearProblem}}));
    $("#win").append(problem);
  }

  function badges() {
    const gifts = S.gifts.filter((g) => !g.opened).length + (typeof Friends !== "undefined" ? Friends.waiting() : 0);   // unopened gifts + friend requests waiting on me
    return { gifts, today: S.dayState === "arrived" ? 1 : 0 };
  }
  function renderNav() {
    const nav = $("#nav"), b = badges();
    const visible = NAV.filter(n=>!n.dev || S.developer);
    const structure = JSON.stringify(visible);
    const selected = requested?.id || S.page;
    const name = S.name.trim() || "You";
    const avatar = `${S.iconStickerId || ""}/${Array.from(name)[0]}`;
    if(nav.dataset.structure === structure && nav.querySelector(".nav-top")) {
      // Keep the rows alive while counts and account details update.
      for(const n of visible) {
        const button = nav.querySelector(`[data-page="${n.id}"]`);
        const count = n.id === "gifts" ? b.gifts : 0, dot = n.id === "today" && b.today;
        button.setAttribute("aria-label", n.label + (count ? `, ${count} unopened` : dot ? ", New envelope" : ""));
        if(n.id === selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
        const badge = button.querySelector(".ni-badge,.ni-dot");
        const kind = count ? "ni-badge" : dot ? "ni-dot" : null;
        if(!kind) badge?.remove();
        else if(badge?.classList.contains(kind)) { if(count)badge.textContent=String(count); }
        else {
          const next = count ? h("i.ni-badge",String(count)) : h("i.ni-dot",{"aria-label":"New envelope"});
          if(badge)badge.replaceWith(next);else button.insertBefore(next,button.querySelector(".ni-key"));
        }
      }
      const account = nav.querySelector(".nav-account");
      account.setAttribute("aria-label",`Account: ${name}. Open Settings`);
      if(selected === "settings")account.setAttribute("aria-current","page");else account.removeAttribute("aria-current");
      account.querySelector("b").textContent=name;
      account.querySelector("small").textContent=`${S.developer ? "Developer · " : ""}${S.lib.length} sticker${S.lib.length===1 ? "" : "s"}`;
      if(nav.dataset.avatar !== avatar)account.querySelector(".creator-icon").replaceWith(CreatorIcon.image());
      nav.dataset.avatar=avatar; syncNavFocus(); return;
    }
    const saved = ViewState.capture(nav);
    const home=h("button.nav-home", {type:"button",title:"Go to Today","aria-label":"Peta — Go to Today",on:{click:async()=>{
      await go("today",{via:"nav",resetScroll:true});
      if(S.page === "today")current?.querySelector(".page-in")?.scrollTo({top:0,behavior:reduced() ? "instant" : "smooth"});
    }}}, h("span.nav-wordmark",{"aria-hidden":"true"}));
    const top = h("div.nav-top"), foot = h("div.nav-foot");
    NAV.forEach((n, i) => {
      if(n.dev && !S.developer) return;
      const count = n.id === "gifts" ? b.gifts : 0, dot = n.id === "today" && b.today;
      if(n.group) top.append(h("span.nav-group", n.group));
      const label = n.label + (count ? `, ${count} unopened` : dot ? ", New envelope" : "");
      const button = h("button.nav-item", { data: { page: n.id }, style: { "--ti": i }, vars: { "--tab-img": `var(--a-${n.tab})`, "--tab-i": i },
        type:"button", title:n.label + (n.key ? ` (⌘${n.key})` : n.id === "settings" ? " (⌘,)" : ""),
        "aria-label":label, "aria-current": selected === n.id ? "page" : null, on: { click: () => go(n.id, { via: "nav" }) } },
        h("span.ni-tile", h("span.ni-icon", { style: { backgroundImage: `var(--a-${n.icon})` } })),
        h("span.ni-label", n.label),
        count ? h("i.ni-badge", String(count)) : dot ? h("i.ni-dot", {"aria-label":"New envelope"}) : null,
        n.key || n.id === "settings" ? h("span.ni-key", {"aria-hidden":"true"}, n.id === "settings" ? "⌘," : `⌘${n.key}`) : null);
      (n.id === "settings" ? foot : top).append(button);
    });
    foot.append(h("button.nav-account", {type:"button","aria-label":`Account: ${name}. Open Settings`,title:"Settings (⌘,)","aria-current":selected === "settings" ? "page" : null,on:{click:()=>go("settings",{via:"nav"})}},
      CreatorIcon.image(), h("span", h("b", name), h("small", `${S.developer ? "Developer · " : ""}${S.lib.length} sticker${S.lib.length===1 ? "" : "s"}`))));
    nav.replaceChildren(home, top, foot);
    nav.dataset.structure=structure; nav.dataset.avatar=avatar;
    ViewState.restore(nav, saved);
    syncNavFocus();
  }
  function navButtons() {
    return $$("#nav .nav-item, #nav .nav-account").filter(button=>!button.disabled && button.getClientRects().length);
  }
  // The sections share one Tab stop after the home button. Arrows browse; Enter/Space opens a section.
  function syncNavFocus() {
    const buttons=navButtons(), active=document.activeElement;
    const target=buttons.includes(active) ? active : buttons.find(button=>button.getAttribute("aria-current") === "page") || buttons[0];
    $$("#nav .nav-item, #nav .nav-account").forEach(button=>button.tabIndex=button === target ? 0 : -1);
    // Settings changes between an account row and an icon when the window narrows.
    if(active?.closest("#nav") && !active.getClientRects().length)target?.focus({preventScroll:true});
  }
  function revealNav(row=$$("#nav [aria-current='page']").find(button=>button.getClientRects().length)) {
    const list=$(".nav-top");
    if(!row || !list?.contains(row))return;
    const r=row.getBoundingClientRect(), bounds=list.getBoundingClientRect();
    if(r.top<bounds.top+8)list.scrollTop-=bounds.top+8-r.top;
    else if(r.bottom>bounds.bottom-8)list.scrollTop+=r.bottom-bounds.bottom+8;
  }
  /** Mark the current row. `id` previews another row while that page is still waiting its turn (a click during a transition). */
  function markNav(id = requested?.id || S.page) { document.body.dataset.page = S.page; $$(".nav-account").forEach((b) => b.toggleAttribute("aria-current", id === "settings")); $$(".nav-account[aria-current]").forEach((b) => b.setAttribute("aria-current", "page")); $$(".nav-item").forEach((b) => b.toggleAttribute("aria-current", b.dataset.page === id)); $$(".nav-item[aria-current]").forEach((b) => b.setAttribute("aria-current", "page")); syncNavFocus(); revealNav(); }

  const pagePositions=new Map();
  function restorePagePosition(wrap) {
    ViewState.restore(wrap,pagePositions.get(wrap._scrollKey),{focus:false});
  }
  function build(id) {
    const wrap = h("section.page", { data: { page: id, art: "page-" + id } });
    const el = Pages[id].build();
    wrap.append(el); wrap._revision = Bridge.revision;
    wrap._scrollKey=id + (id === "market" ? ":"+MK.tab : id === "book" ? ":"+S.bookView : id === "create" ? ":"+CR.stage : id === "studio" ? ":"+ST.mode : "");
    resourceLayout(wrap,id);
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
  let resourceRail = null;
  const resourceButtons = new Map();
  function resourceLayout(wrap,id) {
    const kinds=Resources.kinds(id);
    wrap.classList.toggle("has-resources", !!kinds.length);
    wrap.classList.toggle("has-resource-pair", kinds.length === 2);
  }
  function syncResources(wrap = current, id = S.page) {
    if (!wrap) return;
    resourceLayout(wrap,id);
    const next=Resources.rail(id);
    if(!next) { resourceRail?.remove(); resourceRail=null; return; }
    // Resource furniture lives beside the sheets, so page fades/zooms cannot fade it twice.
    if(!resourceRail) { resourceRail=h("aside.resource-rail",{"aria-label":"Available resources"});$("#bookbox").append(resourceRail); }
    const wanted=[];
    for(const fresh of next.children) {
      const kind=fresh.dataset.resource;
      let button=resourceButtons.get(kind);
      if(!button) { button=fresh; resourceButtons.set(kind,button); }
      else {
        for(const attr of ["aria-label","title"]) {
          if(fresh.hasAttribute(attr))button.setAttribute(attr,fresh.getAttribute(attr));else button.removeAttribute(attr);
        }
        const value=fresh.querySelector("b").textContent;
        if(button.querySelector("b").textContent!==value)button.querySelector("b").textContent=value;
      }
      wanted.push(button);
    }
    for(const button of [...resourceRail.children])if(!wanted.includes(button))button.remove();
    wanted.forEach((button,index)=>{if(resourceRail.children[index]!==button)resourceRail.insertBefore(button,resourceRail.children[index] || null);});
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
    c.inert = true; c.setAttribute("aria-hidden", "true");
    c.style.pointerEvents = "none"; c.querySelectorAll("*").forEach((e) => e.removeAttribute("tabindex"));
    return c;
  }

  /* ---------- loading that is not seen ----------
     A page is shown once its pictures are in: what is built is laid out first, and shown when every picture it holds has decoded and
     nothing has been added to it for a moment (or when `cap` ms have passed, whichever is first). */
  function settle(el, cap, stop = () => false) {
    return new Promise(resolve => {
      let quiet = 0, done = false;
      const finish = () => { if (done) return; done = true; observer.disconnect(); clearTimeout(quiet); clearTimeout(limit); resolve(); };
      const loading = () => [...el.querySelectorAll("img")].filter(i => i.src && !i.complete);
      const check = () => {
        if (done) return; if (stop()) return finish();
        const waiting = loading();
        if (waiting.length) Promise.all(waiting.map(i => i.decode().catch(() => {}))).then(arm); else arm();
      };
      const arm = () => { clearTimeout(quiet); quiet = setTimeout(check2, 48); };
      const check2 = () => { if (stop() || !loading().length) finish(); else check(); };
      const observer = new MutationObserver(arm); observer.observe(el, { subtree:true, childList:true, attributes:true, attributeFilter:["src"] });
      const limit = setTimeout(finish, cap);
      // nothing to wait for: shown on the next frame
      requestAnimationFrame(() => { if (!loading().length && !done) quiet ||= setTimeout(check2, 16); });
      check();
    });
  }
  /** One-shot entrance animations (tiles sliding in) are for arriving at a page, not for the same page being rebuilt. */
  function holdStill(el) {
    if (typeof CSSAnimation === "undefined") return;
    for (const a of el.getAnimations({ subtree:true })) if (a instanceof CSSAnimation && a.effect?.getComputedTiming().iterations !== Infinity) { try { a.finish(); } catch {} }
  }
  /* While a rebuilt page fetches its pictures, a still copy of the page as it was stays over it, so nothing blinks. */
  let cover = null;
  function dropCover() { cover?.remove(); cover = null; }
  function coverWhileLoading(prev, next, vp) {
    dropCover();
    const sel = ".page-in,.st-scroll,.st-grid,.nav-top,[data-preserve-scroll]", from = [prev, ...prev.querySelectorAll(sel)];
    const shot = cloneStatic(prev); shot.classList.add("page-cover"); Object.assign(shot.style, { zIndex: 6 });
    vp.append(shot); cover = shot;
    const to = [shot, ...shot.querySelectorAll(sel)]; from.forEach((e, i) => { if (to[i]) { to[i].scrollTop = e.scrollTop; to[i].scrollLeft = e.scrollLeft; } });
    settle(next, 450).then(async () => {
      if (cover !== shot) return;
      if (!reduced()) await shot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" }).finished.catch(() => {});
      if (cover === shot) dropCover();
    });
  }

  /* ---------- transitions ---------- */
  const pageTransitions = new Set();
  function transitionAnim(el,frames,options) {
    const animation=el.animate(frames,{duration:400,easing:EASE.out,fill:"both",...options,...(reduced() ? {duration:1,delay:0,iterations:1} : {})});
    pageTransitions.add(animation);
    return animation.finished.catch(()=>{}).then(()=>animation).finally(()=>pageTransitions.delete(animation));
  }
  const TRANS = {
    /* B · Desk: sheets of paper laid on top of each other */
    async desk(vp, cur, next, dir) {
      Snd.swoosh();
      vp.append(next); restorePagePosition(next); cur.style.zIndex = 1; next.style.zIndex = 2;
      const f = dir >= 0;
      const a = transitionAnim(next, [{ transform: `translate(${f ? 70 : -70}px, ${f ? 46 : -20}px) rotate(${f ? 2.4 : -2}deg) scale(.985)`, opacity: 0 }, { transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 }], { duration: 640, easing: EASE.out });
      transitionAnim(cur, [{ transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 }, { transform: `translate(${f ? -46 : 46}px, -14px) rotate(${f ? -1.6 : 1.6}deg) scale(.972)`, opacity: 0 }], { duration: 560, easing: EASE.inOut });
      await a; cur.remove(); next.getAnimations().forEach((x) => x.cancel()); next.style.zIndex = "";
    },
    /* C · Studio: a quiet page change; zoom belongs to objects touched inside the page. */
    async studio(vp, cur, next, dir, o = {}) {
      vp.append(next); restorePagePosition(next); cur.style.zIndex = 1; next.style.zIndex = 2;
      const r = vp.getBoundingClientRect(), t = o.originRect || o.origin?.getBoundingClientRect();
      const ox = t ? clamp(((t.left + t.width / 2 - r.left) / r.width) * 100,0,100) : 50, oy = t ? clamp(((t.top + t.height / 2 - r.top) / r.height) * 100,0,100) : 50;
      const zoom = !!t && o.via === "object";
      if(!zoom) {
        // An opaque sheet covers the old content immediately; only its contents settle.
        const content=next.querySelector(":scope > .page-in") || next;
        const animation=await transitionAnim(content,[{transform:`translateY(${dir >= 0 ? 4 : -4}px)`,opacity:.82},{transform:"none",opacity:1}],{duration:180});
        cur.remove();animation.cancel();next.style.zIndex="";
        return;
      }
      Snd.swoosh();
      next.style.transformOrigin = `${ox}% ${oy}%`; cur.style.transformOrigin = `${ox}% ${oy}%`;
      const a = transitionAnim(next,[{ transform: "scale(.96)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration:360, easing:EASE.out });
      transitionAnim(cur,[{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.025)", opacity: 0 }], { duration:280, easing:EASE.inOut });
      await a; cur.remove(); next.getAnimations().forEach((x) => x.cancel()); next.style.zIndex = ""; next.style.transformOrigin = "";
    },
  };

  const PAGE_DATA = {
    today:["daily","materials","collection"], create:["materials","collection"], book:["collection","links","profile"],
    studio:["collection","materials","links","inbox","packs","profile"], packs:["packs","collection","materials","profile"],
    gifts:["gifts","inbox","offers"], materials:["materials","scraps"], boards:["boards","collection"],
    market:["packs","scraps","materials","links","boards","inbox","profile"], settings:["profile","inbox","boards"]
  };
  let requested = null, navigationTask = null, waiters = [], refreshPending = false, fullRefresh = false;
  const refreshChanges = new Set(), refreshWaiters = [];
  const editing = () => S.page === "create" && typeof CR !== "undefined" && CR.stage !== "empty" || S.page === "studio" && typeof ST !== "undefined" && !!ST.mode;
  const blockedRefresh = () => Bridge.busy || typeof ST !== "undefined" && ST.sealing || !!document.querySelector(".cer");
  async function performNavigation(id, o) {
    const vp = viewport(), prevId = S.page, previous = current;
    if (previous && prevId === id && !o.force) { PackZoom.dispose(true); return; }
    const focusContent=previous?.contains(document.activeElement);
    if(previous)pagePositions.set(previous._scrollKey,{scroll:ViewState.capture(previous).scroll});
    const dir = NAV.findIndex(n=>n.id === id) >= NAV.findIndex(n=>n.id === prevId) ? 1 : -1;
    PackZoom.dispose(); S.page = id; markNav();
    let next;
    try { next = build(id); }
    catch (cause) { S.page = prevId; markNav(); throw cause; }
    if(o.resetScroll)pagePositions.delete(next._scrollKey);
    syncResources(next,id); dropCover();
    if (previous && !win().hidden) {
      // laid out where it will be, unseen, so its pictures are decoded before it appears (never more than a moment)
      Object.assign(next.style, { visibility:"hidden", pointerEvents:"none" }); next.setAttribute("aria-hidden", "true"); vp.append(next); restorePagePosition(next);
      await settle(next, 180, () => !!requested);
      next.style.visibility = next.style.pointerEvents = ""; next.removeAttribute("aria-hidden"); next.remove();
    }
    Pages[prevId]?.leave?.(previous);
    try {
      if (!previous || o.instant || win().hidden) {
        vp.replaceChildren(next); restorePagePosition(next); revealContent(next);
      } else {
        previous.inert=true;previous.setAttribute("aria-hidden","true");
        Pages[id].arrive?.(next, {...o, dir});
        await (TRANS[document.body.dataset.shell] || TRANS.studio)(vp, previous, next, dir, o);
      }
    } catch (cause) {
      // A cancelled animation must not leave two live pages or strand the navigation queue.
      vp.replaceChildren(next);
    }
    current = next;
    if(!requested || requested.id === id)await Pages[id].enter?.(next, o);
    if(!requested && focusContent && current === next)next.querySelector(".ph h1")?.focus({preventScroll:true});
  }
  async function drainNavigation() {
    let failure = null;
    navigating = true;
    try {
      while (requested) {
        const next = requested; requested = null;
        await performNavigation(next.id, next.o);
      }
    } catch (cause) { failure = cause; requested = null; error(cause); }
    finally {
      navigating = false;
      await flushRefresh();
      if(requested && !failure) { navigationTask = drainNavigation(); return; }
      navigationTask = null;
      const pending = waiters; waiters = [];
      for (const waiter of pending) failure ? waiter.reject(failure) : waiter.resolve();
      markNav();
    }
  }
  function go(id, o = {}) {
    if (!Pages[id] || typeof ST !== "undefined" && ST.sealing) return Promise.resolve();
    if(current && !o.force && (requested?.id || S.page) === id) {
      if(!navigating)PackZoom.dispose(true);
      return settled();
    }
    // The last destination wins, and every caller waits for that destination to be ready.
    const originRect = o.origin?.getBoundingClientRect();
    requested = {id, o:{...o, originRect}};
    if (navigating) {
      markNav(id);
      // Only page-transition handles are finished; hand-drawn circles and objects keep playing.
      for(const animation of pageTransitions)if(animation.playState === "running")animation.finish();
    }
    const done = new Promise((resolve,reject)=>waiters.push({resolve,reject}));
    if (!navigationTask) navigationTask = drainNavigation();
    return done;
  }
  /* `quiet`: rebuilt where it cannot be seen (behind a ceremony), so it settles without motion. `ifStale`: only if something changed since the page
     was last built, which after a ceremony is usually not the case: it was rebuilt behind it. */
  function refresh({changes = null, quiet = false, ifStale = false} = {}) {
    if (!current) return Promise.resolve();
    syncResources();
    if (ifStale && !refreshPending && current._revision === Bridge.revision) return Promise.resolve();
    if (changes && (current._revision === Bridge.revision || !PAGE_DATA[S.page]?.some(key=>changes.has(key)))) return Promise.resolve();
    if (navigating || changes && (blockedRefresh() || editing() || !!document.querySelector("dialog[open]"))) {
      refreshPending = true;
      if (!changes) fullRefresh = true; else for (const key of changes) refreshChanges.add(key);
      return new Promise(resolve=>refreshWaiters.push(resolve));
    }
    const saved = ViewState.capture(current), behind = quiet || !!document.querySelector(".cer"), previous = current, vp = viewport();
    PackZoom.dispose(); Pages[S.page]?.leave?.(current);
    const next = build(S.page);
    dropCover(); vp.replaceChildren(next); current = next;
    Pages[S.page].enter?.(next, {refresh:true});
    if (document.body.dataset.scene === "ceremony" && S.page === "today") Pages.today.suspend();   // still under the ceremony
    ViewState.restore(next, saved); renderNav();
    // everything that was waiting is now on the page
    refreshPending = fullRefresh = false; refreshChanges.clear(); for (const resolve of refreshWaiters.splice(0)) resolve(true);
    // Background updates keep their position and focus, and show once their pictures are in; explicit panel changes settle gently.
    if (behind || changes) holdStill(next);
    if (changes && !behind) coverWhileLoading(previous, next, vp);
    else if (!changes && !behind) revealContent(next);
    return Promise.resolve();
  }
  function flushRefresh() {
    // The same rule as refresh(): background changes wait for an edit, a dialog or a ceremony, but a page's own full refresh
    // (Create's "now cutting" / "ready") must not be dropped just because it arrived during a navigation.
    if (!refreshPending || navigating || !fullRefresh && (blockedRefresh() || editing() || document.querySelector("dialog[open]"))) return;
    const changes = fullRefresh ? null : new Set(refreshChanges);
    refreshPending = fullRefresh = false; refreshChanges.clear();
    const pending = refreshWaiters.splice(0);
    let failed = false;
    return Promise.resolve().then(()=>refresh({changes})).catch(cause=>{failed=true;error(cause);}).finally(()=>{for(const resolve of pending)resolve(!failed);});
  }
  function settled() {
    if(!navigationTask)return Promise.resolve();
    return new Promise(resolve=>waiters.push({resolve,reject:()=>resolve()}));
  }
  async function open(id, o = {}) {
    const wasOpen = !win().hidden && S.windowOpen;
    // Opening a window never waits on an invisible failing load.
    win().hidden = false; S.windowOpen = true;
    try {
      await Bridge.reload(); renderNav(); clearProblem();
      await go(id || S.page, {...o, instant:o.instant ?? !wasOpen, force:true});
      requestAnimationFrame(()=>Vibrancy.sync());
    } catch (cause) {
      if (!current) viewport().replaceChildren(h("section.page.startup-state", h("div", h("h1", "Peta"), h("p", "Your library could not be opened. Try again to load your saved stickers."))));
      error(cause, {retry:()=>open(id,o)});
      cause.handled = true;
      throw cause;
    }
  }
  async function close() { S.windowOpen = false; Pages[S.page]?.suspend?.(); await Bridge.window.hide(); }
  function initChrome() {
    new ResizeObserver(sizeBookBinding).observe(viewport()); new ResizeObserver(syncNavFocus).observe($("#nav"));
    const nav=$("#nav");
    nav.addEventListener("focusin",syncNavFocus);
    nav.addEventListener("focusout",()=>queueMicrotask(syncNavFocus));
    nav.addEventListener("keydown",e=>{
      if(e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing)return;
      const buttons=navButtons(), index=buttons.indexOf(e.target);
      if(index<0)return;
      const next=e.key === "ArrowDown" ? Math.min(index+1,buttons.length-1) : e.key === "ArrowUp" ? Math.max(index-1,0) : e.key === "Home" ? 0 : e.key === "End" ? buttons.length-1 : -1;
      if(next<0)return;
      e.preventDefault();buttons[next].focus({preventScroll:true});
      revealNav(buttons[next]);
    });
    $("#wc-close").addEventListener("click", close);
    $("#wc-min").addEventListener("click", () => { S.windowOpen = false; Pages[S.page]?.suspend?.(); Bridge.window.minimize(); });
    $("#wc-zoom").addEventListener("click", () => Bridge.window.toggleMaximize());
    $("#titlebar").addEventListener("mousedown", e => { if (e.button === 0 && !e.target.closest("button")) { e.preventDefault(); Bridge.window.startDragging(); } });
    // the sidebar's top (around the wordmark) moves the window too, where no button is
    $("#nav").addEventListener("mousedown", e => { if (e.button === 0 && e.target === e.currentTarget && e.offsetY < 92) { e.preventDefault(); Bridge.window.startDragging(); } });
    $("#resize-h").addEventListener("mousedown", e => { if (e.button === 0) { e.preventDefault(); Bridge.window.startResizeDragging("SouthEast"); } });
    document.addEventListener("keydown", e => {
      if(e.defaultPrevented || !document.hasFocus()) return;
      const page = PetaMath.navShortcut(e, { input:!!e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'), dialog:Bridge.dialogOpen || !!$("dialog[open]"), busy:Bridge.busy || !!PackZoom.active, ceremony:!!$(".cer") });
      if(page) { e.preventDefault(); go(page, {via:"nav"}); }
    });
    document.addEventListener("keydown", e => {
      if(e.key !== "Escape" || e.defaultPrevented || $(".cer") || document.querySelector("dialog[open]")) return;
      if (S.page === "book" && BK.sel) {
        const id = BK.sel; BK.sel = BK.deleteId = null; refresh();
        $(`[data-sticker=${JSON.stringify(id)}]`,current)?.focus({preventScroll:true}); e.preventDefault();
      } else if (!editing() && S.closeOutside && !e.target.closest("input,textarea,select")) close();
    });
  }
  function setShell(name) {
    if (!["studio", "desk"].includes(name)) return;
    S.shell = name; document.body.dataset.shell = name; Bridge.savePreferences(); Vibrancy.sync();
  }
  return { applyAssetVars, toast, error, clearProblem, flushRefresh, settled, get navigating(){return navigating || !!navigationTask;}, get editing(){return editing();}, renderNav, syncResources, go, refresh, open, close, initChrome, setShell, get current() { return current; } };
})();
