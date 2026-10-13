/* Reusable linen boards backed by the local library. */
const BD_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BD = {
  screens: [], boards: [], rules: [], stock: 0, owned: 2, limit: 12, target: null, undo: null,
  load(snapshot) {
    Object.assign(this, BoardState.project(snapshot));
    if(!this.screen()?.connected) this.target=this.screens.find(s=>s.primary && s.connected)?.id || this.screens.find(s=>s.connected)?.id;
  },
  screen(id = this.target) { return this.screens.find((s) => s.id === id); },
  board(id) { return this.boards.find((b) => b.id === id); },
  same(a, b) { return BoardState.same(a,b); },
  /** The board a screen shows, if it still matches it exactly. */
  showing(s) { const b = s && this.board(s.board); return b && this.same(b.items, s.items) ? b : null; },
  /** Why a sticker on a board cannot go on this screen (one sticker can only be in one place), or "". */
  blocked(it, s) { return BoardState.blocked(it,s); },
  when(r, short = false) {
    if (r.type === "place") return r.wifi;
    const d = r.days.join() === "Mon,Tue,Wed,Thu,Fri" ? "Weekdays" : r.days.join() === "Sat,Sun" ? "Weekends" : r.days.join(" ");
    const t = (v) => short ? String(Number(v.slice(0, 2))) + (v.endsWith(":00") ? "" : v.slice(2)) : v;
    return `${d} ${t(r.start)}–${t(r.end)}`;
  },
};

/** A look drawn from the stickers themselves (never a screenshot). Blocked stickers become dashed outlines. */
function BoardLook(items, screen = null) {
  return h("div.bd-look", items.map((it) => {
    const why = screen ? BD.blocked(it, screen) : "", style = { left: it.x + "%", top: it.y + "%", width: it.w + "%", "--a": it.a + "deg" };
    style.zIndex=it.z; style.aspectRatio=it.aspect || 1;
    if(why) return h("span.bd-ghost", { style, title: why }, h("small", why));
    const picture=h("img.bd-stk", { alt: "", draggable: false, style });
    Bridge.thumb(it.k).then(url=>{picture.src=url;}).catch(()=>{picture.replaceWith(h("span.bd-ghost",{style,title:"Picture unavailable"}));});
    return picture;
  }));
}
const bdGlyph = (d) => { const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); p.setAttribute("d", d); s.append(p); return s; };
const BD_ICON = { time: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2", place: "M3 9.5a13 13 0 0 1 18 0M6.5 13a8 8 0 0 1 11 0M10 16.5a3 3 0 0 1 4 0M12 20h.01", check: "M5 12.5l4.5 4.5L19 7.5" };

Pages.boards = {
  build() {
    if (S.boards) BD.load(S.boards);
    const root = h("div.page-in.boardspage");
    const paint = () => { const top = root.scrollTop; root.replaceChildren(...this.parts(paint).filter(Boolean)); root.scrollTop = top; };
    this.paint = paint; paint(); return root;
  },
  leave() { this.closeMenu(); },
  traySave() {
    BD.target=BD.screens.find(s=>s.primary&&s.connected)?.id || BD.target;
    this.paint?.();
    if(!BD.screen()?.items.length) return Shell.toast("There are no stickers on the main screen to save.");
    if(!BD.stock) return Shell.toast("Get a blank board in Market first.");
    this.saveDialog(this.paint);
  },
  parts(paint) {
    const t = BD.screen();
    const save = h("button.btn", { type: "button", disabled: !BD.stock || !t?.items.length, on: { click: () => this.saveDialog(paint) } }, "Save this screen…");
    const stock = h("span.bd-stock", h("i", { "aria-hidden": "true" }), h("span", h("b", String(BD.stock)), BD.stock === 1 ? " blank board" : " blank boards"),
      BD.stock ? null : h("button.link", { type: "button", on: { click: () => { if(typeof MK !== "undefined") MK.tab = "tools"; Shell.go("market"); } } }, "Get one in Market"));
    return [
      PageHead("Boards", "Looks for each screen", stock, save),
      h("p.lede", "Each screen remembers its own look, free. Keep a favourite on a blank board, then put it on any screen."),
      BD.undo && this.dismissedUndo!==BD.undo.at ? this.slip(paint) : null,
      this.screensPart(paint),
      this.boardsPart(paint, t),
      this.autoPart(paint),
    ];
  },
  slip(paint) {
    const u = BD.undo;
    return h("div.bd-slip", { role: "status" }, h("span", u.text), h("button.link", { type: "button", on: { click: () => this.undo(paint) } }, "Undo"),
      CloseButton("Dismiss", { on: { click: () => { this.dismissedUndo=BD.undo.at; paint(); } } }, ".bd-slip-x"));
  },
  screensPart(paint) {
    return h("section.bd-section", h("div.bd-head", h("h2.pk-section-title", "Screens"), h("small.muted", "Choose where a board goes")),
      h("div.bd-desk", BD.screens.map((s) => {
        const b = BD.showing(s), stored = !s.connected;
        const screen=h("button.bd-screen", { type: "button", data: { kind: s.kind, screen: s.id }, "aria-pressed": String(s.id === BD.target), disabled: stored,
          "aria-label": `${s.name}, ${stored ? "stored" : b ? `showing ${b.name}` : "unsaved look"}`, on: { click: () => { BD.target = s.id; Snd.tap(); paint(); } } },
          h("span.bd-display", {style:{aspectRatio:s.aspect}}, h("span.bd-glass", BoardLook(s.items))), h("i.bd-stand", { "aria-hidden": "true" }),
          h("b.bd-sname", s.name), stored ? h("small.bd-slook.muted", "Stored · back when connected") : h(b ? "span.bd-slook.hand" : "span.bd-slook.muted", b ? b.name : s.items.length ? "Unsaved look" : "No stickers yet"));
        return h("div.bd-screen-wrap", screen, h("div.bd-screen-foot", stored ? h("button.link",{type:"button",disabled:!BD.target,on:{click:()=>this.run("boards_bring_here",{fromDisplay:s.id,toDisplay:BD.target},paint,()=>Shell.toast("The stickers are here."))}},"Bring them here") : null));
      })));
  },
  /* A board is the button: click it to put its look on the chosen screen. Under it, one line for the name (and its menu) and one quiet line of facts. */
  boardsPart(paint, t) {
    if(!t) return h("p.muted", "Connect a screen to use your boards.");
    const cards = BD.boards.map((b, i) => {
      const on = BD.showing(t)?.id === b.id, skip = b.items.filter((it) => BD.blocked(it, t)==="On another screen").length, gone=b.items.filter(it=>it.state!=="held").length, rules = BD.rules.filter((r) => r.board === b.id && r.on);
      const facts = [on ? h("span.bd-fact.on", bdGlyph(BD_ICON.check), `On ${t.name}`) : null,
        ...rules.map((r) => h("span.bd-fact", bdGlyph(BD_ICON[r.type]), BD.when(r, true))),
        gone ? h("span.bd-fact.warn", `${gone} no longer yours`) : null,
        skip ? h("span.bd-fact.warn", `${skip} on another screen`) : null].filter(Boolean);
      return h("article.bd-card", { data: { board: b.id }, style: { "--tilt": [-1.2, 1, -.5, 1.4][i % 4] + "deg" } },
        h("button.bd-paper", { type: "button", disabled: on, "aria-label": on ? `${b.name}, on ${t.name}` : `Put ${b.name} on ${t.name}`, on: { click: () => this.put(b.id, t.id, paint) } },
          BoardLook(b.items, t), on ? h("span.bd-on", { "aria-hidden": "true" }, bdGlyph(BD_ICON.check)) : h("span.bd-put", { "aria-hidden": "true" }, `Put on ${t.name}`)),
        h("div.bd-cap",
          h("span.bd-name.hand", b.name),
          h("button.bd-more", { type: "button", "aria-label": `More for ${b.name}`, "aria-haspopup": "menu", on: { click: (e) => this.menu(e.currentTarget, b, paint) } }, h("span", "•••")),
          facts.length ? h("span.bd-facts", facts) : null));
    });
    const blank = BD.stock && t.items.length
      ? h("article.bd-card", h("button.bd-paper.bd-blank", { type: "button", on: { click: () => this.saveDialog(paint) } }, h("span.bd-plus", "+"), h("span.hand", "Keep this look")),
          h("div.bd-cap", h("span.bd-facts", h("span.bd-fact", `Uses 1 of ${BD.stock} blank`))))
      : null;
    return h("section.bd-section", h("div.bd-head", h("h2.pk-section-title", "Boards"), h("small.muted", `${BD.boards.length} kept`)),
      BD.boards.length ? null : h("p.muted.bd-empty", "Your screens already remember their looks. Keep a favourite on a board and bring it back whenever you like."),
      h("div.bd-grid", ...cards, blank));
  },
  autoPart(paint) {
    const rows = BD.rules.map((r, i) => {
      const s = BD.screen(r.screen), b = BD.board(r.board);
      return h(r.on ? "div.bd-rule" : "div.bd-rule.off",
        h("div.bd-order", h("button", { type: "button", "aria-label": "Move up", disabled: i === 0, on: { click: () => { this.run("board_rule_move",{ruleId:r.id,direction:"up"},paint); } } }, "▲"),
          h("button", { type: "button", "aria-label": "Move down", disabled: i === BD.rules.length - 1, on: { click: () => { this.run("board_rule_move",{ruleId:r.id,direction:"down"},paint); } } }, "▼")),
        h("button.bd-when", { type: "button", on: { click: () => this.ruleDialog(paint, r) } }, bdGlyph(BD_ICON[r.type]), h("span", h("b", BD.when(r)), h("small", r.type === "time" ? "Time" : BoardState.locationOff(BD.location) ? "Location is off for Peta" : "Place"))),
        h("span.bd-to", "→"), h("span.bd-where", s?.name || r.screen, s?.connected ? null : h("small", " · stored")), h("span.bd-which.hand", b ? b.name : "—"),
        h("button.switch", { type: "button", role: "switch", "aria-checked": String(r.on), "aria-label": `${BD.when(r)} on`, on: { click: () => { this.run("board_rule_toggle",{ruleId:r.id},paint); } } }, h("i")),
        CloseButton("Remove rule", { on: { click: () => { this.run("board_rule_delete",{ruleId:r.id},paint); } } }, ".bd-rm"));
    });
    return h("section.bd-section.bd-auto", h("div.bd-head", h("h2.pk-section-title", "Auto"), h("small.muted", "A board for the right time, or the right place")),
      h("div.setcard.bd-rules", rows.length ? rows : h("p.muted.small.bd-norules", "No rules yet."),
        h("div.bd-rules-foot", h("small.muted", "Runs once when a time or place begins. If two begin together, the higher rule wins."),
          h("button.btn.paper.small", { type: "button", disabled: !BD.boards.length, on: { click: () => this.ruleDialog(paint) } }, "Add a rule…"))));
  },

  /* Commands refresh the native snapshot only after success. A failed dialog stays open. */
  async run(command,args,paint,success,error=null) {
    if(this.busy) return false;
    this.busy=true;const was=!!Bridge.busy;Bridge.busy=true;
    try {
      const result=await Bridge.invoke(command,args);await Bridge.reload();BD.load(S.boards);Snd.tap();success?.(result);paint?.();return true;
    } catch(e) { const code=String(e), messages={nothing_to_save:"There are no stickers on this screen.",no_blank_board:"Get a blank board in Market.",invalid_board_name:"Use a name of 1 to 24 letters.",screen_not_connected:"This screen is not connected.",board_not_found:"This board was removed.",rule_not_found:"This rule was removed.",screen_not_found:"Choose a screen that Peta remembers.",invalid_time_rule:"Choose at least one day and two different times.",invalid_wifi_name:"Use a Wi‑Fi name of 1 to 64 letters.",invalid_rule:"Choose Time or Place.",invalid_direction:"Choose up or down.",invalid_board_placement:"This board has an invalid sticker position.",invalid_screen:"Choose a different connected screen."}; const message=Object.entries(messages).find(([key])=>code.includes(key))?.[1]||"Could not change this board. Try again.";if(error)error.textContent=message;else Shell.toast(message);return false; }
    finally {this.busy=false;Bridge.busy=was;}
  },
  async put(boardId,screenId,paint) {
    const b=BD.board(boardId),s=BD.screen(screenId);if(!b||!s?.connected)return;
    await this.run("boards_put",{boardId,displayId:screenId},paint,r=>{this.dismissedUndo=null;Shell.toast(`Put “${b.name}” on ${s.name}${r.skipped.length?` · ${r.skipped.length} skipped`:""}`);});
  },
  undo(paint) {this.run("boards_undo",{},paint,r=>Shell.toast(r?.skipped.length?`${r.skipped.length} stickers could not be restored.`:"The previous look is back."));},
  closeMenu() { this.menuEl?.remove(); this.menuEl = null; document.removeEventListener("pointerdown", this.menuAway, true); document.removeEventListener("keydown", this.menuKey, true); },
  menu(anchor, b, paint) {
    if (this.menuEl?.dataset.board === b.id) return this.closeMenu();
    this.closeMenu();
    const t = BD.screen(), item = (label, fn, cls = "") => h("button" + cls, { type: "button", role: "menuitem", on: { click: () => { this.closeMenu(); fn(); } } }, label);
    const m = h("div.bd-menu", { role: "menu", data: { board: b.id } },
      item("Rename…", () => this.nameDialog(paint, b)),
      item(`Update with ${t.name}`, () => this.run("boards_update",{boardId:b.id,displayId:t.id},paint,()=>Shell.toast(`Updated “${b.name}”. No blank board used.`))),
      h("hr"), item("Delete…", () => this.deleteDialog(paint, b), ".danger"));
    anchor.closest(".bd-cap").append(m); this.menuEl = m; m.querySelector("button").focus();
    this.menuAway = (e) => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) this.closeMenu(); };
    this.menuKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); this.closeMenu(); anchor.focus(); } };
    document.addEventListener("pointerdown", this.menuAway, true); document.addEventListener("keydown", this.menuKey, true);
  },

  /* ---- dialogs: a sheet of paper, like Settings ---- */
  sheet(label, ...kids) {
    if (document.querySelector("dialog")) return null;
    const close = CloseButton("Close", { on: { click: () => dialog.close() } }, ".bd-x");
    const dialog = h("dialog.bd-dialog", { "aria-label": label, on: { keydown: (e) => { if (e.key === "Escape") e.stopPropagation(); }, close: () => { dialog.remove(); Bridge.dialogOpen = !!document.querySelector("dialog"); } } },
      h("div.setcard.bd-sheet", close, ...kids));
    Bridge.dialogOpen = true; document.body.append(dialog); dialog.showModal(); return dialog;
  },
  nameField(value) {
    const input = h("input.bd-input", { type: "text", maxLength: 24, required: true, value, autocomplete: "off", spellcheck: false, "aria-label": "Board name" });
    const count = h("small.muted", `${value.length} / 24`); input.addEventListener("input", () => { count.textContent = `${input.value.length} / 24`; });
    return { input, field: h("label.bd-field", h("span", "Name", count), input) };
  },
  saveDialog(paint) {
    if (!BD.stock || !BD.screen()?.items.length) return;
    const t = BD.screen(); let n = 1; while (BD.boards.some((b) => b.name === `Board ${n}`)) n++;
    const { input, field } = this.nameField(`Board ${n}`), error=h("p.bd-error",{role:"alert"});
    const form = h("form.bd-form", { on: { submit: (e) => { e.preventDefault(); const name = input.value.trim(); if (!name) return input.focus();
      this.run("boards_save",{displayId:t.id,name},paint,()=>{dialog.close();Shell.toast(`Kept “${name}”. ${BD.stock} blank left.`);},error); } } },
      h("div.bd-paper.bd-preview-paper", BoardLook(t.items)), field, error,
      h("p.small.bd-cost", `Uses 1 blank board · ${BD.stock - 1} left after this`),
      h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"), h("button.btn", { type: "submit" }, "Keep on a board")));
    const dialog = this.sheet("Save this screen", h("h2", "Save this screen"), h("p.muted.small", t.name), form);
    input.focus(); input.select();
  },
  nameDialog(paint, b) {
    const { input, field } = this.nameField(b.name),error=h("p.bd-error",{role:"alert"});
    const form = h("form.bd-form", { on: { submit: (e) => { e.preventDefault(); const name = input.value.trim(); if (!name) return input.focus(); this.run("boards_rename",{boardId:b.id,name},paint,()=>dialog.close(),error); } } },
      field, error, h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"), h("button.btn", { type: "submit" }, "Rename")));
    const dialog = this.sheet("Rename board", h("h2", "Rename board"), form); input.focus(); input.select();
  },
  deleteDialog(paint, b) {
    const n = BD.rules.filter((r) => r.board === b.id).length;
    const dialog = this.sheet(`Delete ${b.name}`, h("h2", `Delete “${b.name}”?`),
      h("p.small", "The stickers stay in your Collection, and the board comes back to you blank."), n ? h("p.small.muted", `${n} Auto rule${n === 1 ? "" : "s"} for this board will go too.`) : null,
      h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"),
        h("button.btn.stamp", { type: "button", on: { click: () => { this.run("boards_delete",{boardId:b.id},paint,()=>{dialog.close();Shell.toast(`Deleted “${b.name}”. The board is back: ${BD.stock} blank.`);}); } } }, "Delete look")));
  },
  ruleDialog(paint, rule = null) {
    if (!BD.boards.length) return;
    const d = rule ? structuredClone(rule) : { id: "", type: "time", days: BD_DAYS.slice(0, 5), start: "09:00", end: "18:00", wifi: "Home Wi‑Fi", screen: BD.target, board: BD.boards[0].id, on: true };
    const body = h("div.bd-rule-body"), error = h("p.small.bd-error", { role: "alert" });
    const select = (opts, value, label) => { const s = h("select.bd-input", { "aria-label": label }, opts.map(([v, text]) => h("option", { value: v }, text))); s.value = value; return s; };
    const screen = select(BD.screens.map((s) => [s.id, s.name + (s.connected ? "" : " (stored)")]), d.screen, "Screen");
    const board = select(BD.boards.map((b) => [b.id, b.name]), d.board, "Board");
    const locationNote=h("p.small.muted");
    const updateLocationNote=()=>{BD.location=S.boards?.location||BD.location;locationNote.textContent=BoardState.locationOff(BD.location)?"Location is off for Peta. You can save this rule; it will run when location is allowed in System Settings.":"The Wi‑Fi name stays on this Mac.";};
    const seg = h("div.seg.bd-seg"), draw = () => {
      seg.replaceChildren(...[["time", "Time"], ["place", "Place"]].map(([v, text]) => SegButton(text, { type: "button", "aria-pressed": String(d.type === v), on: { click: () => { d.type = v; Snd.tap(); draw(); } } })));
      if (d.type === "place" && !BD.location?.prompted) {
        body.replaceChildren(h("div.bd-permit", h("b", "Use your Wi‑Fi name"), h("p.small", "Peta uses the name of your Wi‑Fi to know where you are. It never leaves this Mac."),
          h("button.btn.paper.small", { type: "button", on: { click: async () => { try {await Bridge.invoke("boards_location_request");await Bridge.reload();BD.location=S.boards.location;draw();} catch(e){error.textContent="Could not request location access.";} } } }, "Continue")));
      } else if (d.type === "place") {
        const wifi = h("input.bd-input", { type: "text", maxLength: 64, value: d.wifi, "aria-label": "Wi‑Fi name", on: { input: (e) => { d.wifi = e.target.value; } } });
        body.replaceChildren(h("label.bd-field", h("span", "Wi‑Fi"), wifi), locationNote);
        updateLocationNote();
      } else {
        const day = (x) => h("button.bd-day", { type: "button", "aria-pressed": String(d.days.includes(x)), on: { click: (e) => { d.days = d.days.includes(x) ? d.days.filter((y) => y !== x) : BD_DAYS.filter((y) => d.days.includes(y) || y === x); e.currentTarget.setAttribute("aria-pressed", String(d.days.includes(x))); } } }, x.slice(0, 2));
        const time = (k, label) => h("label.bd-field", h("span", label), h("input.bd-input", { type: "time", value: d[k], on: { input: (e) => { d[k] = e.target.value; } } }));
        body.replaceChildren(h("div.bd-days", BD_DAYS.map(day)), h("div.bd-times", time("start", "From"), time("end", "Until")));
      }
    };
    draw();
    const form = h("form.bd-form", { on: { submit: (e) => { e.preventDefault();
      if (d.type === "place" && !BD.location?.prompted) { error.textContent = "Continue to use your Wi‑Fi name first."; return; }
      if (d.type === "time" && (!d.days.length || !d.start || !d.end || d.start === d.end)) { error.textContent = "Choose at least one day and two different times."; return; }
      if (d.type === "place" && !d.wifi.trim()) { error.textContent = "Enter a Wi‑Fi name."; return; }
      Object.assign(d, { screen: screen.value, board: board.value });
      this.run("board_rule_save",{rule:BoardState.toRule(d)},paint,()=>{dialog.close();Shell.toast("Auto rule saved.");},error); } } },
      seg, body, h("div.bd-pair", h("label.bd-field", h("span", "Screen"), screen), h("label.bd-field", h("span", "Board"), board)), error,
      h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"), h("button.btn", { type: "submit" }, rule ? "Save rule" : "Add rule")));
    window.addEventListener("boards-location-updated",updateLocationNote);
    const dialog = this.sheet(rule ? "Edit rule" : "Add a rule", h("h2", rule ? "Edit rule" : "Add a rule"), h("p.muted.small", "When it begins, put a board on a screen."), form);
    dialog.addEventListener("close",()=>window.removeEventListener("boards-location-updated",updateLocationNote),{once:true});
  },
};
