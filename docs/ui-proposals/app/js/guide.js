/* A small "what to touch" panel for people evaluating the prototype. Not part of the app. */
const Guide = (() => {
  const DIR = {
    notebook: ["A · Notebook", "The whole app is one spiral notebook. Pages turn over the binding; sections are index tabs on the edge."],
    desk: ["B · Desk", "The window is the cutting mat. Pages are sheets of paper laid on top of each other; sections are objects in a tray on the left."],
    studio: ["C · Studio", "Quiet and modern. A sidebar of little objects; pages zoom open from the thing you touched."],
  };
  const TASKS = [
    ["Open today's envelope", "Today → Open. Watch the card settle into the tray.", () => { S.dayState === "arrived" ? Shell.open("today") : Shell.toast("Today's envelope is already open — press “Next day” for a new one."); }],
    ["Tear a Pack", "Packs → Open one. Drag across the top, then pull the sleeve out. Tilt the sticker.", () => Shell.open("packs")],
    ["Make a Peta", "Create → pick a sample (or drop your own image) → paint with Erase / Restore → Make this Peta.", () => Shell.open("create")],
    ["Stick it on the desktop", "After any of these, a sheet prints from the top. Drag the sticker anywhere — peta!", () => Shell.toast("Make or open something first, then grab the printed sticker.")],
    ["Turn a sticker over", "Book → tap a sticker → Turn over. Gift… seals it in an envelope.", () => Shell.open("book")],
    ["Break a gift's seal", "Gifts → Open. Click the wax seal.", () => Shell.open("gifts")],
    ["Come back from the menu bar", "Close the window (red dot), then use the Peta icon at the top right. Double-click a desktop sticker to flip it.", () => Menu.open()],
    ["Switch direction", "A / B / C below — same app, three ways of moving through it.", () => Shell.toast("Use the A · B · C switch in the bar below.")],
  ];
  function render() {
    const g = $("#guide"), d = DIR[S.shell];
    g.replaceChildren(
      h("button.gx", { "aria-label": "Close guide", on: { click: () => toggle(false) } }, "✕"),
      h("p.eyebrow", "Prototype guide"), h("h3", d[0]), h("p.gd", d[1]),
      h("p.eyebrow", { style: { marginTop: "14px" } }, "Things to touch"),
      h("ol", TASKS.map((t, i) => h("li", h("button", { on: { click: t[2] } }, h("b", t[0]), h("small", t[1]))))),
      h("p.fine", "Everything is mocked in the browser: no files are written, “cut out” runs on a few samples, and sounds are synthesized (toggle in the bar)."));
  }
  function toggle(force) { const g = $("#guide"); const on = force ?? g.hidden; if (on) render(); g.hidden = !on; $("#tb-guide").setAttribute("aria-pressed", String(on)); if (on) anim(g, [{ opacity: 0, transform: "translateX(-14px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: EASE.out }); }
  function init() { $("#tb-guide").addEventListener("click", () => toggle()); $("#shell-switch").addEventListener("click", () => { if (!$("#guide").hidden) setTimeout(render, 0); }); }
  return { init, toggle, render };
})();
