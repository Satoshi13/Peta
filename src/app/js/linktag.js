/* Link tags: a reusable little tool that makes a sticker open an app, a website or a folder when it is clicked on the desktop.
   The tag is the owner's, not the sticker's: taking it off puts it back in stock, and sealing the sticker into a Gift or a Pack takes it off first.
   The rules live in Rust (peta_core::link_tag); this file is the picture of a tag, the attach dialog and the row in the Collection's details. */
const LT_KINDS = [["app", "App"], ["website", "Website"], ["folder", "Folder"]];
const LT_PRICE = () => S.scraps.tools?.find((t) => t.id === "link-tag")?.exchange ?? 2;
const ltTag = (id) => S.linkTags?.get(id) || null;
const ltIcons = new Map();     // sticker id -> Promise<blob url | null>

/** Small line glyphs for what a tag opens, drawn in the paper's ink. */
const LT_GLYPH = {
  website: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3.5 12h17M12 3c2.6 2.4 3.6 5.6 3.6 9s-1 6.6-3.6 9c-2.6-2.4-3.6-5.6-3.6-9s1-6.6 3.6-9z",
  folder: "M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.2h8a1.5 1.5 0 0 1 1.5 1.5v8.3a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5z",
  app: "M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z",
  open: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};
function ltGlyph(kind, cls = "") {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "lt-glyph " + cls); path.setAttribute("d", LT_GLYPH[kind] || LT_GLYPH.open); svg.append(path);
  return svg;
}
/** The picture of the app's own icon (made once by Rust from its .icns), or null. */
function ltIcon(stickerId, tag) {
  if(!tag || tag.kind !== "app") return Promise.resolve(null);
  const key = stickerId + "|" + tag.target;
  if(!ltIcons.has(key)) ltIcons.set(key, Bridge.invoke("link_tag_icon", { stickerId }).then((bytes) => (bytes && bytes.length ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" })) : null)).catch(() => null));
  return ltIcons.get(key);
}
/** What is on the tag's paper: the app's icon, or a glyph for a website or a folder. The tag art itself is blank. */
function ltFace(stickerId, tag) {
  const face = h("span.lt-face", { data: { kind: tag.kind } }, ltGlyph(tag.kind));
  ltIcon(stickerId, tag).then((url) => { if(url && face.isConnected !== false) face.replaceChildren(h("img", { src: url, alt: "" })); });
  return face;
}
/** The tag as a picture: clip, string and paper with what it opens written on it. `stickerId` null = a blank tag (stock). */
function LinkTagPic({ stickerId = null, tag = null, size = 44 } = {}) {
  const el = h("span.lt-pic", { style: { "--w": size + "px" }, role: "img", "aria-label": tag ? `Link tag: ${tag.label}` : "Link tag" });
  if(tag) el.append(ltFace(stickerId, tag));
  return el;
}

const LinkTags = {
  stock() { return S.tagStock || { owned: 0, attached: 0, available: 0 }; },
  /** Buy one with Scraps (a retry of the same request never spends twice). */
  async buy(done) {
    const price = LT_PRICE(), request = { kind: "tool", itemId: "link-tag", quantity: 1 };
    if(!S.developer && S.scraps.balance < price) { Shell.toast(`You need ${price - S.scraps.balance} more Scraps.`); return; }
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join("");
    try { await Bridge.invoke("scrap_trade", { trade: request, requestId }); await Bridge.reload(); Snd.chime(2, 740); Shell.toast("A link tag is in your stock."); done?.(); }
    catch(e) { Shell.toast(String(e)); }
  },
  async remove(e, done) {
    try { await Bridge.invoke("link_tag_remove", { stickerId: e.id }); await Bridge.reload(); Snd.tap(); Shell.toast("The tag is back in your stock."); done?.(); }
    catch(err) { Shell.toast(String(err)); }
  },
  async setShow(e, on, done) {
    try { await Bridge.invoke("link_tag_set_show", { stickerId: e.id, show: on }); await Bridge.reload(); done?.(); } catch(err) { Shell.toast(String(err)); }
  },
  /** The attach / change dialog. `existing` is the sticker's tag when it is being changed. */
  attach(e, done) {
    if(document.querySelector("dialog")) return;
    const existing = ltTag(e.id), stock = this.stock();
    if(!existing && stock.available < 1) { this.noneLeft(); return; }
    let kind = existing?.kind || "app", target = existing?.target || "", label = existing?.label || "", show = existing ? existing.show_in_collection ?? existing.showInCollection : true, pending = false;
    const body = h("div.lt-body"), status = h("p.lt-status", { role: "status" });
    const go = h("button.btn", { type: "submit" }, existing ? "Save" : "Attach tag"), cancel = h("button.btn.quiet", { type: "button", on: { click: () => dialog.close() } }, "Cancel");
    const ready = () => !!target && !!label.trim();
    const paint = () => {
      go.disabled = pending || !ready();
      const tabs = h("div.lt-tabs", { role: "tablist" }, LT_KINDS.map(([k, n]) => h("button", { type: "button", role: "tab", "aria-selected": String(kind === k), on: { click: () => { if(kind !== k) { kind = k; target = ""; label = ""; status.textContent = ""; paint(); } } } }, n)));
      let what;
      if(kind === "website") {
        const url = h("input", { type: "url", value: target, placeholder: "https://…", autocomplete: "off", spellcheck: false, "aria-label": "Web address", on: { input: (ev) => { target = ev.target.value.trim(); if(!label || label === guess) { guess = hostOf(target); label = guess; const n = $(".lt-name", body); if(n) n.value = label; } go.disabled = pending || !ready(); } } });
        let guess = ""; const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").slice(0, 40); } catch { return ""; } };
        what = h("div.lt-what", h("label", "Web address", url), h("small", "Paste a link: a page, a Spotify or Apple Music playlist, a document."));
      } else {
        const chosen = target ? h("div.lt-chosen", ltGlyph(kind), h("b", label || target.split("/").pop()), h("small", target)) : h("p.lt-none", kind === "app" ? "No app chosen yet." : "No folder chosen yet.");
        const choose = h("button.btn.paper.small", { type: "button", on: { click: async () => {
          try { const picked = await Bridge.invoke("link_tag_pick", { kind }); if(picked) { target = picked.target; label = picked.label; status.textContent = ""; paint(); } } catch(err) { status.textContent = String(err); }
        } } }, target ? "Choose another…" : kind === "app" ? "Choose app…" : "Choose folder…");
        what = h("div.lt-what", chosen, choose);
      }
      const name = h("input.lt-name", { value: label, maxLength: 40, placeholder: "Name on the tag", autocomplete: "off", "aria-label": "Name on the tag", on: { input: (ev) => { label = ev.target.value; go.disabled = pending || !ready(); } } });
      const toggle = h("label.lt-toggle", h("span", h("b", "Show in Collection"), h("small", "The tag hangs on the card. Hidden on the desktop.")), h("input", { type: "checkbox", role: "switch", checked: show, on: { change: (ev) => { show = ev.target.checked; } } }), h("i.lt-sw"));
      body.replaceChildren(tabs, what, h("label.lt-label", "Name", name), toggle);
    };
    const form = h("form.lt-card", { on: { submit: async (ev) => {
      ev.preventDefault(); if(pending || !ready()) return; pending = true; go.disabled = true; cancel.disabled = true; status.textContent = "";
      try { await Bridge.invoke("link_tag_attach", { request: { stickerId: e.id, kind, target, label: label.trim(), showInCollection: show } }); await Bridge.reload(); ltIcons.delete(e.id + "|" + target); dialog.close(); Snd.chime(2, 740); done?.(); }
      catch(err) { status.textContent = String(err).replace(/^.*?: /, ""); }
      finally { pending = false; cancel.disabled = false; go.disabled = !ready(); }
    } } },
      CloseButton("Cancel", { on: { click: () => { if(!pending) dialog.close(); } } }, ".lt-x"),
      h("div.lt-left", LinkTagPic({ size: 74 }), h("small", existing ? "This tag" : `${stock.available} tag${stock.available === 1 ? "" : "s"} available`), h("small.muted", "Reusable")),
      h("div.lt-right", h("p.eyebrow", titleOf(e)), h("h2", existing ? "Change the link" : "Attach a link tag"), h("p.lt-sub", "Choose what this sticker opens when you click it on the desktop."), body, status,
        h("small.lt-note", "It returns to you when you take it off, or seal this sticker into a gift or a pack."), h("div.lt-actions", cancel, go)));
    const dialog = h("dialog.lt-dialog", { "aria-label": "Link tag", on: { cancel: (ev) => { ev.stopPropagation(); if(pending) ev.preventDefault(); }, keydown: (ev) => { if(ev.key === "Escape") ev.stopPropagation(); }, close: () => { dialog.remove(); Bridge.dialogOpen = !!document.querySelector("dialog"); } } }, form);
    paint(); Bridge.dialogOpen = true; document.body.append(dialog); dialog.showModal();
  },
  noneLeft() {
    const dialog = h("dialog.lt-dialog.lt-small", { "aria-label": "No link tag", on: { close: () => { dialog.remove(); Bridge.dialogOpen = !!document.querySelector("dialog"); } } },
      h("div.lt-card.lt-narrow", h("div.lt-left", LinkTagPic({ size: 74 })), h("div.lt-right", h("h2", "You have no link tag"), h("p.lt-sub", "Get one in the Market. You can use it again and again."),
        h("div.lt-actions", h("button.btn.quiet", { type: "button", on: { click: () => dialog.close() } }, "Not now"), h("button.btn", { type: "button", on: { click: () => { dialog.close(); MK.tab = "tools"; Shell.go("market"); } } }, "Go to the Market")))));
    Bridge.dialogOpen = true; document.body.append(dialog); dialog.showModal();
  },
  /** The row in the Collection's details. */
  row(e, repaint) {
    const tag = ltTag(e.id), stock = this.stock();
    if(!tag) {
      return h("div.det-tag", h("button.btn.quiet.det-link.quiet2", { type: "button", on: { click: () => this.attach(e, repaint) } }, ltGlyph("open", "ico"), h("span", "Attach a link tag"), h("small", stock.available ? `${stock.available} available` : "none left")));
    }
    return h("div.det-tag.on", h("div.det-tag-head", h("span.det-tag-ico", ltFace(e.id, tag)),
      h("div", h("b", tag.label), h("small", tag.kind === "website" ? tag.target.replace(/^https?:\/\//, "") : "Click to open")),
      h("button.det-tag-go", { type: "button", "aria-label": `Open ${tag.label}`, title: "Open now", on: { click: () => Bridge.invoke("link_tag_open", { stickerId: e.id }).catch((err) => Shell.toast(String(err))) } }, ltGlyph("open"))),
      h("div.det-tag-actions", h("button.btn.quiet", { type: "button", on: { click: () => this.attach(e, repaint) } }, "Change…"), h("button.btn.quiet", { type: "button", on: { click: () => this.remove(e, repaint) } }, "Remove tag")),
      h("label.det-tag-show", h("span", "Show in Collection"), h("input", { type: "checkbox", role: "switch", checked: tag.showInCollection, on: { change: (ev) => this.setShow(e, ev.target.checked, repaint) } }), h("i.lt-sw")));
  },
};
