import { $, el, api, date, action, confirmAction, notice } from "./ui.js";
let urls = [];
const KINDS = { gift: "Gift", listing: "Market の出品" };
export function showCount(open) { $("reports-count").textContent = String(open); $("reports-count").hidden = !open; $("tab-reports").setAttribute("aria-label", open ? `報告、未解決 ${open} 件` : "報告"); }
/* Pictures arrive as base64 PNG data and are shown only as images, through blob: URLs typed image/png. */
function picture(p) {
  const bytes = Uint8Array.from(atob(p.png), c => c.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  urls.push(url);
  const figure = el("figure"), img = el("img"); img.src = url; img.alt = p.label || "報告された画像"; img.draggable = false;
  figure.append(img, el("figcaption", p.label)); return figure;
}
async function open(r, host, button) {
  await action(button, async () => {
    const d = await api(`/api/reports/${r.id}`); host.replaceChildren();
    if (!d.available) { host.append(el("p", d.stored ? "内容はすでに保存期間を過ぎています。" : "内容のアップロードが完了していません。他に確認することがなければ解決済みにしてください。", "empty")); return; }
    if (!d.contents.readable) host.append(el("p", "内容の一部を読み取れませんでした。", "hint"));
    const lines = el("dl", undefined, "report-lines");
    for (const l of d.contents.lines) lines.append(el("dt", l.label), el("dd", l.value));
    const pictures = el("div", undefined, "report-pictures"); for (const p of d.contents.pictures) pictures.append(picture(p));
    host.append(lines, pictures);
    button.hidden = true;
  });
}
function block(r) {
  const dialog = $("block");
  $("block-title").textContent = `送信者 ${r.sender}`; $("block-reason").value = ""; $("block-resolve").checked = r.senderOpen > 0;
  $("block-resolve").disabled = r.senderOpen < 1;
  $("block-resolve-text").textContent = r.senderOpen > 0 ? `この送信者の未解決の報告 ${r.senderOpen} 件も解決済みにする` : "この送信者の未解決の報告はありません";
  $("cancel-block").onclick = () => dialog.close();
  $("block-form").onsubmit = event => {
    event.preventDefault();
    action($("accept-block"), async () => {
      const result = await api("/api/reports/block", { id: r.id, reason: $("block-reason").value, resolveOpen: $("block-resolve").checked, confirm: true });
      dialog.close(); notice(`送信者をブロックしました。${result.resolved ? ` ${result.resolved} 件を解決済みにしました。` : ""}`); await loadReports();
    });
  };
  dialog.showModal();
}
export async function loadReports() {
  const data = await api("/api/reports"); urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
  showCount(data.open); $("report-list").replaceChildren(); $("blocked-list").replaceChildren();
  if (!data.reports.length) $("report-list").append(el("p", "報告はありません。よい知らせです。", "empty"));
  for (const r of data.reports) {
    const card = el("article", undefined, "card"), head = el("div", undefined, "card-head"), controls = el("div", undefined, "actions"), host = el("div");
    head.append(el("h3", `${KINDS[r.kind] || r.kind} · ${r.reason}`), el("span", r.resolvedAt ? "解決済み" : "未解決", r.resolvedAt ? "tag" : "tag open"));
    card.append(head,
      el("p", `受信 ${date(r.createdAt)}${r.resolvedAt ? ` · 解決 ${date(r.resolvedAt)}` : ""}`),
      el("p", `送信者 ${r.sender} · 報告 ${r.senderReports} 件${r.senderBlocked ? " · ブロック済み" : ""} · 報告した人 ${r.reporter}`, "hint"),
      el("p", `ID ${r.id}`, "hint"), host);
    const view = el("button", "内容を見る", "subtle"), resolve = el("button", "解決済みにする", "subtle"), stop = el("button", r.senderBlocked ? "送信者はブロック済み" : "送信者をブロック", "danger");
    view.type = resolve.type = stop.type = "button"; resolve.hidden = !!r.resolvedAt; stop.disabled = r.senderBlocked;
    view.onclick = () => open(r, host, view);
    resolve.onclick = async () => {
      if (!await confirmAction("この報告を解決済みにしますか？", "未解決の一覧から外れ、内容は30日後に削除されます。")) return;
      await action(resolve, async () => { await api("/api/reports/resolve", { id: r.id, confirm: true }); notice("報告を解決済みにしました。"); await loadReports(); });
    };
    stop.onclick = () => block(r);
    controls.append(view, resolve, stop); card.append(controls); $("report-list").append(card);
  }
  if (!data.blocked.length) $("blocked-list").append(el("p", "ブロック中の送信者はいません。", "empty"));
  for (const b of data.blocked) {
    const card = el("article", undefined, "card"), unblock = el("button", "ブロックを解除", "subtle");
    unblock.type = "button";
    card.append(el("h3", `送信者 ${b.key}`), el("p", b.reason || "理由は記録されていません。"), el("p", `ブロック ${date(b.at)} · 報告 ${b.reports} 件`, "hint"), unblock);
    unblock.onclick = async () => {
      if (!await confirmAction("この送信者のブロックを解除しますか？", "この鍵で Peta のオンライン機能を再び使えるようになります。")) return;
      await action(unblock, async () => { await api("/api/reports/unblock", { key: b.key, confirm: true }); notice("送信者のブロックを解除しました。"); await loadReports(); });
    };
    $("blocked-list").append(card);
  }
}
export function setupReports() { $("refresh-reports").onclick = () => action($("refresh-reports"), loadReports); }
