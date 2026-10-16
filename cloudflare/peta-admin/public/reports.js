import { $, el, api, date, action, confirmAction, notice } from "./ui.js";
let urls = [];
const KINDS = { gift: "Gift", listing: "Market listing" };
export function showCount(open) { $("reports-count").textContent = String(open); $("reports-count").hidden = !open; $("tab-reports").setAttribute("aria-label", open ? `Reports, ${open} open` : "Reports"); }
/* Pictures arrive as base64 PNG data and are shown only as images, through blob: URLs typed image/png. */
function picture(p) {
  const bytes = Uint8Array.from(atob(p.png), c => c.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  urls.push(url);
  const figure = el("figure"), img = el("img"); img.src = url; img.alt = p.label || "Reported picture"; img.draggable = false;
  figure.append(img, el("figcaption", p.label)); return figure;
}
async function open(r, host, button) {
  await action(button, async () => {
    const d = await api(`/api/reports/${r.id}`); host.replaceChildren();
    if (!d.available) { host.append(el("p", d.stored ? "The contents are no longer stored." : "The contents never finished uploading. Resolve it if nothing else is needed.", "empty")); return; }
    if (!d.contents.readable) host.append(el("p", "Peta couldn't read every part of these contents.", "hint"));
    const lines = el("dl", undefined, "report-lines");
    for (const l of d.contents.lines) lines.append(el("dt", l.label), el("dd", l.value));
    const pictures = el("div", undefined, "report-pictures"); for (const p of d.contents.pictures) pictures.append(picture(p));
    host.append(lines, pictures);
    button.hidden = true;
  });
}
function block(r) {
  const dialog = $("block");
  $("block-title").textContent = `Sender ${r.sender}`; $("block-reason").value = ""; $("block-resolve").checked = r.senderOpen > 0;
  $("block-resolve").disabled = r.senderOpen < 1;
  $("block-resolve-text").textContent = r.senderOpen > 0 ? `Also resolve this sender's ${r.senderOpen} open ${r.senderOpen === 1 ? "report" : "reports"}` : "This sender has no open reports";
  $("cancel-block").onclick = () => dialog.close();
  $("block-form").onsubmit = event => {
    event.preventDefault();
    action($("accept-block"), async () => {
      const result = await api("/api/reports/block", { id: r.id, reason: $("block-reason").value, resolveOpen: $("block-resolve").checked, confirm: true });
      dialog.close(); notice(`Sender blocked.${result.resolved ? ` ${result.resolved} ${result.resolved === 1 ? "report" : "reports"} resolved.` : ""}`); await loadReports();
    });
  };
  dialog.showModal();
}
export async function loadReports() {
  const data = await api("/api/reports"); urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
  showCount(data.open); $("report-list").replaceChildren(); $("blocked-list").replaceChildren();
  if (!data.reports.length) $("report-list").append(el("p", "No reports. That's good news.", "empty"));
  for (const r of data.reports) {
    const card = el("article", undefined, "card"), head = el("div", undefined, "card-head"), controls = el("div", undefined, "actions"), host = el("div");
    head.append(el("h3", `${KINDS[r.kind] || r.kind} · ${r.reason}`), el("span", r.resolvedAt ? "resolved" : "open", r.resolvedAt ? "tag" : "tag open"));
    card.append(head,
      el("p", `Received ${date(r.createdAt)}${r.resolvedAt ? ` · Resolved ${date(r.resolvedAt)}` : ""}`),
      el("p", `Sender ${r.sender} · ${r.senderReports} ${r.senderReports === 1 ? "report" : "reports"}${r.senderBlocked ? " · blocked" : ""} · Reported by ${r.reporter}`, "hint"),
      el("p", `ID ${r.id}`, "hint"), host);
    const view = el("button", "View contents", "subtle"), resolve = el("button", "Resolve", "subtle"), stop = el("button", r.senderBlocked ? "Sender blocked" : "Block sender", "danger");
    view.type = resolve.type = stop.type = "button"; resolve.hidden = !!r.resolvedAt; stop.disabled = r.senderBlocked;
    view.onclick = () => open(r, host, view);
    resolve.onclick = async () => {
      if (!await confirmAction("Resolve this report?", "It leaves the open list. Its contents are deleted 30 days from now.")) return;
      await action(resolve, async () => { await api("/api/reports/resolve", { id: r.id, confirm: true }); notice("Report resolved."); await loadReports(); });
    };
    stop.onclick = () => block(r);
    controls.append(view, resolve, stop); card.append(controls); $("report-list").append(card);
  }
  if (!data.blocked.length) $("blocked-list").append(el("p", "No one is blocked.", "empty"));
  for (const b of data.blocked) {
    const card = el("article", undefined, "card"), unblock = el("button", "Unblock", "subtle");
    unblock.type = "button";
    card.append(el("h3", `Sender ${b.key}`), el("p", b.reason || "No reason recorded."), el("p", `Blocked ${date(b.at)} · ${b.reports} ${b.reports === 1 ? "report" : "reports"}`, "hint"), unblock);
    unblock.onclick = async () => {
      if (!await confirmAction("Unblock this sender?", "Their key can use Peta's online features again.")) return;
      await action(unblock, async () => { await api("/api/reports/unblock", { key: b.key, confirm: true }); notice("Sender unblocked."); await loadReports(); });
    };
    $("blocked-list").append(card);
  }
}
export function setupReports() { $("refresh-reports").onclick = () => action($("refresh-reports"), loadReports); }
