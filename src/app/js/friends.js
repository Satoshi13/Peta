/* Friends and the Gift inbox (server S2): Settings' Friends and key cards, the requests on the Gifts page, and the friend picker in
   Studio's gift seal. Nothing here shows when the build has no server (S.inbox.enabled is false). Codes and links are only ever
   pasted or opened by the person; a link never sends anything by itself. */
const Friends = {
  /** Who is where: friends, requests waiting on me, people I asked, blocked. */
  groups(list = S.inbox?.friends || []) {
    const by = (s) => list.filter((f) => f.status === s);
    return { friends: by("friend"), pending: by("pending"), requested: by("requested"), blocked: by("blocked") };
  },
  /** Requests waiting on me, for the sidebar's Gifts badge. */
  waiting() { return S.inbox?.enabled ? this.groups().pending.length : 0; },
  label(f) {
    if (f.status === "requested") {
      const days = f.addedAt ? (Date.now() - Date.parse(f.addedAt)) / 864e5 : 0;
      return days > 7 ? "No response" : "Request sent";
    }
    return { friend: "Friend", pending: "Wants to be friends", blocked: "Blocked" }[f.status] || "";
  },
  error(e) { return String(e?.message || e).replace(/^Error: /, ""); },
  async act(cmd, args, done) {
    try { await Bridge.invoke(cmd, args); await Bridge.reload(); Shell.renderNav(); Shell.refresh(); if (done) Shell.toast(done); }
    catch (e) { Shell.toast(this.error(e)); }
  },
  async copy(what) {
    const text = what === "link" ? S.inbox.myLink : S.inbox.myCode;
    try { await navigator.clipboard.writeText(text); } catch { Shell.toast("Could not copy. Select the code and copy it instead."); return; }
    Shell.toast(what === "link" ? "Link copied. Send it to a friend." : "Code copied. Send it to a friend.");
    Bridge.invoke("friend_code_copied").then(() => Bridge.reload()).catch(() => {});   // makes my mailbox so their request can reach me
  },
  /** A sheet of paper, the same as Boards' dialogs. */
  sheet(label, ...kids) {
    if (document.querySelector("dialog")) return null;
    const close = CloseButton("Close", { on: { click: () => dialog.close() } }, ".bd-x");
    const dialog = h("dialog.bd-dialog", { "aria-label": label, on: { keydown: (e) => { if (e.key === "Escape") e.stopPropagation(); }, close: () => { dialog.remove(); Bridge.dialogOpen = !!document.querySelector("dialog"); } } },
      h("div.setcard.bd-sheet", close, ...kids));
    Bridge.dialogOpen = true; document.body.append(dialog); dialog.showModal(); return dialog;
  },

  /** A yes/no question on the same paper (the app never uses the browser's confirm). */
  ask(question, yes = "Confirm") {
    return new Promise((resolve) => {
      let answer = false;
      const dialog = this.sheet(question, h("p", question), h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"),
        h("button.btn.stamp", { type: "button", on: { click: () => { answer = true; dialog.close(); } } }, yes)));
      if (!dialog) { resolve(false); return; }
      dialog.addEventListener("close", () => resolve(answer));
    });
  },
  /** Drain cold or warm OS links only after boot. Wait for another sheet instead of losing its link. */
  async openPendingLinks() {
    if (!this.linksReady || this.openingLinks) return;
    this.openingLinks = true;
    try {
      let link;
      while ((link = await Bridge.invoke("friend_link_take"))) {
        const current = document.querySelector("dialog");
        if (current) await new Promise(resolve => current.addEventListener("close", resolve, { once: true }));
        PackZoom.dispose(true);
        await Shell.open("settings");
        this.addDialog(link);
      }
    } finally { this.openingLinks = false; }
  },

  /** Paste a code or a link (or arrive from a link with it filled in), see who it is, and send a request. */
  addDialog(prefill = "") {
    if (!S.inbox?.enabled) return this.sheet("Friends", h("h2", "Friends"), h("p.small.muted", "Friends need Peta's server, which this build does not include yet."));
    const input = h("textarea.bd-input.fr-code", { rows: 3, placeholder: "PETAF1-… or a friend link", "aria-label": "Friend code or link", spellcheck: false }, prefill);
    const who = h("div.fr-who", { "aria-live": "polite" }), note = h("input.bd-input", { type: "text", maxLength: 80, placeholder: "A few words (optional)", "aria-label": "A few words" });
    const send = h("button.btn", { type: "submit", disabled: true }, "Send request");
    let preview = null, previewText = "", timer = 0, revision = 0;
    const look = async () => {
      preview = null; send.disabled = true; const text = input.value.trim(), request = ++revision;
      if (!text) { who.replaceChildren(); return; }
      try {
        const result = await Bridge.invoke("friend_preview", { code: text });
        if (request !== revision || input.value.trim() !== text) return;
        preview = result; previewText = text;
        const why = { self: "This is your own code.", blocked: "You blocked this person. Unblock them below first.", friend: "You are friends already.", requested: "You asked already. Waiting for them.", pending: "They asked you. Approve them on the Gifts page." }[preview.status];
        who.replaceChildren(h("b", preview.name || "Someone"), h("small.muted", ` · ${preview.fingerprint}`), why ? h("p.small.muted", why) : null);
        send.disabled = preview.status !== "new";
      } catch (e) { if (request === revision) who.replaceChildren(h("p.small.bd-error", this.error(e))); }
    };
    input.addEventListener("input", () => { revision++; preview = null; send.disabled = true; clearTimeout(timer); timer = setTimeout(look, 250); });
    const form = h("form.bd-form", { on: { submit: async (e) => {
      e.preventDefault(); if (!preview || preview.status !== "new" || previewText !== input.value.trim() || send.disabled) return; send.disabled = true; send.textContent = "Sending…";
      try {
        await Bridge.invoke("friend_add", { code: input.value.trim(), note: note.value.trim() || null });
        dialog.close(); await Bridge.reload(); Shell.refresh();
        Shell.toast(`Request sent to ${preview.name || "your friend"}.`);
        if (!S.inbox.backedUp) setTimeout(() => Shell.toast("Back up your Peta key in Settings, so a new Mac can keep your friends.", 4200), 2600);
      } catch (err) { who.append(h("p.small.bd-error", this.error(err))); send.disabled = false; send.textContent = "Send request"; }
    } } }, input, who, note,
      h("p.small.muted", "They see your name and these words. Gifts can be sent once they approve."),
      h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"), send));
    const dialog = this.sheet("Add a friend", h("h2", "Add a friend"), h("p.muted.small", "Paste the code or link your friend sent you."), form);
    if (!dialog) return null;
    if (prefill) look(); input.focus(); return dialog;
  },

  /** Settings: my code, adding, the list, requests, checking, and leaving. */
  settingsCard() {
    if (!S.inbox?.enabled) return null;
    const g = this.groups(), row = (f, ...actions) => h("div.fr-row", h("div.fr-name", h("b", f.name || "Someone"), h("small.muted", `${this.label(f)} · ${PetaFp(f)}`), f.note ? h("small.fr-note", `“${f.note}”`) : null), h("div.fr-acts", ...actions));
    const small = (label, fn, cls = "") => h("button.btn.paper.small" + cls, { type: "button", on: { click: fn } }, label);
    const key = (f) => ({ key: f.publicKey });
    const confirmThen = (q, fn, yes) => async () => { if (await this.ask(q, yes)) fn(); };
    return h("section.setcard.fr-card",
      h("h2", "Friends"),
      h("p.small.muted", "Share your code with people you choose. Once they approve, gifts reach their Peta without a file."),
      h("div.fr-mine", h("div", h("b", "Your friend code"), h("small.muted", S.inbox.myFingerprint)),
        h("div.fr-acts", small("Copy code", () => this.copy("code")), small("Copy link", () => this.copy("link")), h("button.btn.small", { type: "button", on: { click: () => this.addDialog() } }, "Add a friend…"))),
      g.pending.length ? h("div.fr-group", h("p.eyebrow", "Wants to be friends"), g.pending.map((f) => row(f,
        small("Approve", () => this.act("friend_approve", key(f), `You and ${f.name} are friends.`)), small("Decline", () => this.act("friend_decline", key(f))), small("Block", confirmThen(`Block ${f.name}? They can't ask again or send gifts.`, () => this.act("friend_block", key(f)), "Block"))))) : null,
      g.friends.length || g.requested.length ? h("div.fr-group", h("p.eyebrow", "Friends"), [...g.friends, ...g.requested].map((f) => row(f,
        small("Remove", confirmThen(`Remove ${f.name}? Gifts you already have stay.`, () => this.act("friend_remove", key(f)), "Remove")), small("Block", confirmThen(`Block ${f.name}?`, () => this.act("friend_block", key(f)), "Block"))))) : h("p.small.muted.fr-none", "No friends yet."),
      g.blocked.length ? h("div.fr-group", h("p.eyebrow", "Blocked"), g.blocked.map((f) => row(f, small("Unblock", () => this.act("friend_unblock", key(f)))))) : null,
      h("div.setrow", h("div", h("b", "Check for gifts"), h("small", S.inbox.lastCheck ? `Last checked ${new Date(S.inbox.lastCheck).toLocaleString()}` : "Not checked yet")),
        h("div.fr-acts", h("div.seg", [[true, "Automatically"], [false, "When I open Peta"]].map(([v, t]) => SegButton(t, { "aria-pressed": String(S.inbox.auto === v), on: { click: () => this.act("inbox_set_auto", { auto: v }) } }))),
          small("Check now", async () => { try { const r = await Bridge.invoke("inbox_check", { manual: true }); await Bridge.reload(); Shell.refresh(); Shell.toast(r.gifts || r.requests ? `${r.gifts} gift${r.gifts === 1 ? "" : "s"} and ${r.requests} request${r.requests === 1 ? "" : "s"} arrived.` : "Nothing new."); } catch (e) { Shell.toast(this.error(e)); } }))),
      h("div.fr-leave", h("button.link", { type: "button", on: { click: confirmThen("Remove your mailbox, friend lists and waiting gifts from Peta's server? Your stickers stay on this Mac. Who owns each sticker is still recorded.", () => this.act("inbox_leave", {}, "Your data was removed from Peta's server."), "Remove") } }, "Remove my data from Peta's server…")));
  },

  /** Settings: back up and restore the keys (moving to a new Mac). */
  keyCard() {
    if (!S.inbox?.enabled) return null;
    const pass = (label) => h("input.bd-input", { type: "password", minLength: 12, autocomplete: "new-password", placeholder: label, "aria-label": label });
    const backup = () => {
      const a = pass("Passphrase (12 characters or more)"), b = pass("The same passphrase again"), status = h("p.small.bd-error");
      const form = h("form.bd-form", { on: { submit: async (e) => {
        e.preventDefault();
        if (a.value.length < 12) { status.textContent = "Use 12 characters or more."; return; }
        if (a.value !== b.value) { status.textContent = "The two passphrases differ."; return; }
        try { if (await Bridge.fileDialog("identity_export", { passphrase: a.value })) { dialog.close(); await Bridge.reload(); Shell.refresh(); Shell.toast("Your key is backed up. Keep the file and the passphrase apart."); } }
        catch (err) { status.textContent = this.error(err); }
      } } }, a, b, status, h("p.small.muted", "Without the passphrase the file cannot be opened, by anyone. Peta cannot recover it."),
        h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"), h("button.btn", { type: "submit" }, "Save backup…")));
      const dialog = this.sheet("Back up your key", h("h2", "Back up your key"), form); a.focus();
    };
    const restore = () => {
      const a = pass("Passphrase of the backup"), status = h("p.small.bd-error");
      const form = h("form.bd-form", { on: { submit: async (e) => {
        e.preventDefault();
        try { if (await Bridge.fileDialog("identity_import", { passphrase: a.value })) { dialog.close(); await Bridge.reload(); Shell.refresh(); Shell.toast("Your key is restored on this Mac."); } }
        catch (err) { status.textContent = this.error(err); }
      } } }, h("p.small", "This replaces this Mac's key with the backup's. Use it when you move to a new Mac. Two Macs can't use the same key at once: the one that checks first gets each gift."), a, status,
        h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"), h("button.btn.stamp", { type: "submit" }, "Restore…")));
      const dialog = this.sheet("Restore your key", h("h2", "Restore your key"), form); a.focus();
    };
    return h("section.setcard.fr-card",
      h("h2", "Your Peta key"),
      h("p.small.muted", "Your key is who you are to friends and to Peta's record of who owns each sticker. Lose it, and the real stickers you hold can never be given again."),
      h("div.setrow", h("div", h("b", S.inbox.backedUp ? "Backed up" : "Not backed up yet"), h("small", "A file sealed with a passphrase.")),
        h("div.fr-acts", h("button.btn.paper.small", { type: "button", on: { click: backup } }, "Back up key…"), h("button.btn.paper.small", { type: "button", on: { click: restore } }, "Restore…"))));
  },

  /** The Gifts page: requests waiting on me, and the gifts friends sent (with Report). */
  giftsSection() {
    if (!S.inbox?.enabled) return null;
    const g = this.groups(), got = S.gifts.filter((x) => x.opened && x.signatureStatus === "known").slice(0, 12);
    const parts = [];
    if (g.pending.length) parts.push(h("section.fr-requests", h("h2.pk-section-title", "Friend requests"), g.pending.map((f) => h("div.fr-row", h("div.fr-name", h("b", f.name || "Someone"), h("small.muted", PetaFp(f)), f.note ? h("small.fr-note", `“${f.note}”`) : null),
      h("div.fr-acts", h("button.btn.small", { type: "button", on: { click: () => this.act("friend_approve", { key: f.publicKey }, `You and ${f.name} are friends.`) } }, "Approve"),
        h("button.btn.paper.small", { type: "button", on: { click: () => this.act("friend_decline", { key: f.publicKey }) } }, "Decline"),
        h("button.btn.paper.small", { type: "button", on: { click: async () => { if (await this.ask(`Block ${f.name}?`, "Block")) this.act("friend_block", { key: f.publicKey }); } } }, "Block"))))));
    if (got.length) parts.push(h("section.fr-received", h("p.eyebrow", "From friends"), got.map((x) => h("div.fr-row", h("div.fr-name", h("b", x.from), h("small.muted", x.note || "")),
      h("div.fr-acts", h("button.link.small", { type: "button", on: { click: () => this.report(x) } }, "Report…"))))));
    return parts.length ? h("div.fr-gifts", ...parts) : null;
  },
  report(gift) {
    const reasons = ["Hurtful or harassing", "Sexual content", "Violence or danger", "Someone else's work", "Something else"];
    let pick = reasons[0];
    const seg = h("div.fr-reasons", reasons.map((r) => h("label.fr-reason", h("input", { type: "radio", name: "reason", checked: r === pick, on: { change: () => { pick = r; } } }), r)));
    const ok = h("input", { type: "checkbox", "aria-label": "I agree" }), status = h("p.small.bd-error");
    const form = h("form.bd-form", { on: { submit: async (e) => {
      e.preventDefault(); if (!ok.checked) { status.textContent = "Agree to send the gift for review."; return; }
      try { await Bridge.invoke("inbox_report", { giftId: gift.id, reason: pick }); dialog.close(); Shell.toast("Thank you. Peta's owner will look at it."); }
      catch (err) { status.textContent = this.error(err); }
    } } }, seg, h("label.fr-agree", ok, " Send this gift and who sent it to Peta's owner. Nobody else sees it."), status,
      h("div.bd-dacts", h("button.link", { type: "button", on: { click: () => dialog.close() } }, "Cancel"), h("button.btn.stamp", { type: "submit" }, "Report")));
    const dialog = this.sheet("Report a gift", h("h2", "Report this gift"), h("p.muted.small", `From ${gift.from}. Peta can't see gifts unless you send one here.`), form);
  },

  /** Studio's gift seal: friends who accepted me, as pills. */
  picker(selected, choose) {
    const g = this.groups().friends;
    if (!g.length) return h("p.st-fine", "No friends yet. Add one in Settings → Friends.");
    return h("div.fr-pick", g.map((f) => h("button.fr-pill", { type: "button", "aria-pressed": String(selected === f.publicKey), on: { click: () => choose(f) } }, f.name || "Someone", h("small", PetaFp(f)))));
  },
};
/** A key's short fingerprint, as everywhere else in Peta. */
function PetaFp(f) { return f.fingerprint || ""; }
