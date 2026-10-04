/* The desktop around the window: stickers stuck on it, the arrival envelope, and Print -> Grab -> Paste. */
const srcOf = (e) => e.cutout || A[e.src];
const resOf = (e, o = {}) => Stk.make(srcOf(e), { border: e.border ?? 14, material: e.material, max: 520, ...o });

const Desktop = (() => {
  const layer = () => $("#desk-stickers");
  const stkWidth = (res, maxDim = 190) => (res.aspect >= 1 ? maxDim : maxDim * res.aspect);

  async function mount(d) {
    const entry = S.lib.find((x) => x.id === d.id); if (!entry) return null;
    const res = await resOf(entry, { max: 420 });
    const stk = Stk.el(res, stkWidth(res));
    const flipper = h("div.flipper", stk);
    const node = h("div.desk-stk", { data: { id: d.id }, vars: { "--rot": d.rot + "deg" }, style: { left: d.x * 100 + "%", top: d.y * 100 + "%" } }, flipper);
    layer().append(node);
    drag(node, {
      down: () => { node.classList.add("lifted"); node.style.zIndex = 20 + (++Desktop.z); },
      move: (dx, dy, ev) => { const r = layer().getBoundingClientRect(); d.x = clamp((ev.clientX - r.left) / r.width, .02, .98); d.y = clamp((ev.clientY - r.top) / r.height, .03, .97); node.style.left = d.x * 100 + "%"; node.style.top = d.y * 100 + "%"; },
      up: () => node.classList.remove("lifted"),
    });
    node.addEventListener("dblclick", () => flip(node, flipper, stk, entry));
    return node;
  }
  async function flip(node, flipper, stk, entry) {
    if (node._busy) return; node._busy = true; Snd.flip();
    const back = node._back || (node._back = BackCard(entry)); const showing = flipper.contains(back);
    await anim(flipper, [{ transform: "rotateY(0)" }, { transform: "rotateY(90deg)" }], { duration: 170, easing: "ease-in" });
    if (showing) { back.remove(); stk.style.display = ""; } else { stk.style.display = "none"; back.style.width = "170px"; back.style.position = "relative"; flipper.append(back); }
    await anim(flipper, [{ transform: "rotateY(-90deg)" }, { transform: "rotateY(0)" }], { duration: 210, easing: "ease-out" });
    flipper.getAnimations().forEach((a) => a.cancel()); node._busy = false;
  }
  async function renderAll() { layer().replaceChildren(); for (const d of S.desk) await mount(d); }

  /* ---------- arrival: a small envelope in the corner ---------- */
  async function arrive() {
    const a = $("#arrival"); a.hidden = false; a.replaceChildren(img("arrMaterial"), h("span.arr-note", "Today's Material"));
    Snd.chime(2, 660);
    await anim(a, [{ transform: "translateY(60px) rotate(6deg) scale(.7)", opacity: 0 }, { transform: "translateY(-10px) rotate(-2deg) scale(1.04)", opacity: 1, offset: .7 }, { transform: "none", opacity: 1 }], { duration: 760, easing: EASE.out });
    a.getAnimations().forEach((x) => x.cancel());
    a.onclick = () => { a.hidden = true; Shell.open("today"); };
    Shell.renderNav();
  }
  function hideArrival() { $("#arrival").hidden = true; }

  /* ---------- print -> grab -> paste ---------- */
  let printing = false;
  async function print(entry) {
    S.pending = { entry };
    await Shell.close();
    await showPrint();
  }
  async function showPrint() {
    if (printing || !S.pending) return; printing = true;
    const { entry } = S.pending;
    const res = await resOf(entry, { max: 520 });
    const root = $("#print-layer"); root.replaceChildren();
    const slot = h("div.print-slot", h("i.slot-glow"), h("i.slot-bar"));
    const stage = h("div.print-stage");
    const sheetW = Math.min(250, innerHeight * 0.34);
    const maxD = sheetW * .74, stk = Stk.el(res, res.aspect >= 1 ? maxD : maxD * res.aspect);
    const sheet = h("div.print-sheet", { style: { width: sheetW + "px" } }, h("div.sheet-stk", stk));
    stage.append(sheet);
    const hint = h("div.print-hint", h("span", h("b", "Printed."), " Grab the sticker and stick it anywhere on your desktop."),
      h("button.btn.paper.small", { on: { click: later } }, "Later"));
    root.append(stage, slot, hint);
    hint.hidden = true;
    Snd.feed(16, 2.2);
    anim(slot.querySelector(".slot-glow"), [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: 2400, easing: "linear" });
    await anim(sheet, [{ transform: "translateY(-102%)" }, { transform: "translateY(0)" }], { duration: 2400, easing: "steps(22, jump-end)" });
    await anim(sheet, [{ transform: "translateY(0)" }, { transform: "translateY(5px)" }, { transform: "translateY(0)" }], { duration: 260, easing: EASE.out });
    hint.hidden = false; anim(hint, [{ opacity: 0, transform: "translate(-50%, 10px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 400 });
    sheet.classList.add("ready");
    wireGrab(sheet, stk, res, entry);
    printing = false;
  }
  function wireGrab(sheet, stk, res, entry) {
    const holder = stk.parentElement; let float = null, off = { x: 0, y: 0 };
    drag(stk, {
      down: (e) => {
        const r = stk.getBoundingClientRect(); off = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
        float = Stk.el(res, r.width); float.classList.add("grab"); document.body.append(float);
        float.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;z-index:300;pointer-events:none`;
        stk.style.opacity = 0; sheet.classList.add("grabbing"); Snd.tap();
        anim(float, [{ transform: "scale(1)" }, { transform: "scale(1.08)" }], { duration: 160, easing: EASE.out });
      },
      move: (dx, dy, ev) => { float.style.left = ev.clientX - off.x - float.offsetWidth / 2 + "px"; float.style.top = ev.clientY - off.y - float.offsetHeight / 2 + "px"; },
      up: async (ev, moved) => {
        const sr = sheet.getBoundingClientRect(), over = ev.clientX > sr.left && ev.clientX < sr.right && ev.clientY > sr.top && ev.clientY < sr.bottom;
        sheet.classList.remove("grabbing");
        if (!moved || over) { // put it back on the sheet
          const r = holder.getBoundingClientRect();
          await anim(float, [{ left: float.style.left, top: float.style.top }, { left: r.left + (r.width - float.offsetWidth) / 2 + "px", top: r.top + (r.height - float.offsetHeight) / 2 + "px", transform: "scale(1)" }], { duration: 260, easing: EASE.out });
          float.remove(); stk.style.opacity = 1; return;
        }
        paste(float, ev, entry, res, sheet);
      },
    });
  }
  async function paste(float, ev, entry, res, sheet) {
    const lr = layer().getBoundingClientRect(), x = clamp((ev.clientX - lr.left) / lr.width, .06, .94), y = clamp((ev.clientY - lr.top) / lr.height, .08, .94);
    const rot = Math.round(rand(-7, 7));
    float.remove();
    // the new Peta belongs to the library and the desktop
    if (!S.lib.find((l) => l.id === entry.id)) S.lib.unshift(entry);
    const d = S.desk.find((q) => q.id === entry.id) || (S.desk.push({ id: entry.id, x, y, rot }), S.desk[S.desk.length - 1]);
    Object.assign(d, { x, y, rot });
    S.pending = null; if (!S.stuckToday.includes(entry.id)) S.stuckToday.push(entry.id);
    $$(".desk-stk").filter((n) => n.dataset.id === entry.id).forEach((n) => n.remove());
    const node = await mount(d); node.style.zIndex = 20 + (++Desktop.z);
    Snd.peta();
    anim(node.querySelector(".stk"), [{ transform: "scale(1.14)" }, { transform: "scale(.96)", offset: .45 }, { transform: "scale(1.02)", offset: .75 }, { transform: "scale(1)" }], { duration: 340, easing: "ease-out" });
    const tag = pickTag(); tag.style.left = node.style.left; tag.style.top = node.style.top; layer().append(tag);
    anim(tag, [{ opacity: 0, transform: "translate(-10%, -150%) rotate(-8deg) scale(.6)" }, { opacity: 1, transform: "translate(8%, -170%) rotate(-5deg) scale(1)", offset: .25 }, { opacity: 1, transform: "translate(8%, -170%) rotate(-5deg) scale(1)", offset: .8 }, { opacity: 0, transform: "translate(8%, -190%) rotate(-5deg) scale(1)" }], { duration: 1300, easing: "ease-out" }).then(() => tag.remove());
    hideHint(); await sleep(450);
    await retract(sheet);
    Shell.renderNav(); Shell.toast(S.stuckToday.length > 1 ? `Stuck. ${S.stuckToday.length} today.` : "Stuck.");
  }
  function hideHint() { const hnt = $(".print-hint"); if (hnt) anim(hnt, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }); }
  async function retract(sheet) {
    Snd.feed(8, .8);
    await anim(sheet, [{ transform: "translateY(0)" }, { transform: "translateY(-104%)" }], { duration: 900, easing: "steps(12, jump-end)" });
    $("#print-layer").replaceChildren(); printing = false;
  }
  async function later() {
    const sheet = $(".print-sheet"); if (!sheet) return; hideHint();
    await retract(sheet); Shell.toast("Waiting at the print slot — open the Peta menu to get it back.");
    Shell.renderNav();
  }
  /* "Peta!" tags that pop up when you stick something. Add a variant by pushing another function. */
  const TAGS = [
    () => h("img.peta-tag", { src: A.tagEn, alt: "" }),
    () => h("div.peta-tag.v-pill", h("i.wm")),
    () => h("div.peta-tag.v-holo", h("i.wm")),
    () => h("div.peta-tag.v-stamp", h("i.wm")),
  ];
  let lastTag = -1;
  const pickTag = () => { let i; do i = Math.floor(Math.random() * TAGS.length); while (i === lastTag && TAGS.length > 1); lastTag = i; return TAGS[i](); };
  return { z: 0, TAGS, mount, renderAll, arrive, hideArrival, print, showPrint, later };
})();
