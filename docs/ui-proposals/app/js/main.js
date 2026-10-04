/* Boot + the prototype's own toolbar (not part of the app). */
const MAT_POOL = [["matte", .5], ["kraft", .32], ["holographic", .18]];
function rollMat() { let r = Math.random(), a = 0; for (const [id, w] of MAT_POOL) { a += w; if (r < a) return id; } return "matte"; }

async function nextDay() {
  S.today = new Date(S.today.getTime() + 864e5); S.dayState = "arrived"; S.todayMat = rollMat(); S.chosen = S.todayMat; S.stuckToday = []; S.packsOpened = 0; S.pickMode = false;
  $("#clock").textContent = fmtDate(S.today, { weekday: "short" }) + " 10:24";
  Shell.toast("A new day — today's material has arrived.");
  if (S.windowOpen) { Pages.today && S.page === "today" ? Shell.refresh() : null; Shell.renderNav(); } else Desktop.arrive();
  if (S.windowOpen) Desktop.arrive();
}
async function resetAll() {
  await Shell.close().catch(() => {}); $("#print-layer").replaceChildren(); $("#overlay").replaceChildren(); $("#arrival").hidden = true;
  S = freshState(S); Shell.reset(); S.page = "today"; $("#clock").textContent = fmtDate(S.today, { weekday: "short" }) + " 10:24";
  await Desktop.renderAll(); Shell.renderNav(); await Shell.open("today");
}
function setType(t) {
  S.type = t; document.body.dataset.type = t; Snd.tap();
  $$("#type-switch button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.type === t)));
}
function wireToolbar() {
  $$("#shell-switch button").forEach((b) => b.addEventListener("click", () => { if (S.shell === b.dataset.shell) return; Shell.setShell(b.dataset.shell); Snd.tap(); const w = $("#win"); if (!w.hidden) anim(w, [{ filter: "brightness(1.08)" }, { filter: "none" }], { duration: 400 }); }));
  $$("#type-switch button").forEach((b) => b.addEventListener("click", () => setType(b.dataset.type)));
  $("#tb-nextday").addEventListener("click", nextDay);
  $("#tb-reset").addEventListener("click", resetAll);
  $("#tb-sound").addEventListener("click", (e) => { Snd.on = !Snd.on; S.sound = Snd.on; e.currentTarget.setAttribute("aria-pressed", String(Snd.on)); if (Snd.on) Snd.chime(2, 660); });
  $("#tb-motion").addEventListener("click", (e) => { const r = document.documentElement.dataset.motion === "reduce"; document.documentElement.dataset.motion = r ? "full" : "reduce"; S.motion = r ? "full" : "reduce"; e.currentTarget.setAttribute("aria-pressed", String(!r)); e.currentTarget.textContent = r ? "Motion ●" : "Motion ○"; });
}
async function boot() {
  Shell.applyAssetVars(); Shell.initChrome(); Menu.init(); wireToolbar(); Guide.init();
  Shell.setShell(new URLSearchParams(location.search).get("shell") || S.shell, true);
  setType(new URLSearchParams(location.search).get("type") || "current");
  $("#clock").textContent = fmtDate(S.today, { weekday: "short" }) + " 10:24";
  await Desktop.renderAll(); Shell.renderNav();
  S.lib.forEach((e) => { resOf(e, { max: 360 }); resOf(e, { max: 520 }); }); // warm the sticker cache so tiles don't pop in
  await Shell.open(new URLSearchParams(location.search).get("page") || "today");
  $("#tb-guide").classList.add("attn"); $("#tb-guide").addEventListener("click", () => $("#tb-guide").classList.remove("attn"), { once: true });
}
boot();
