import { state, $, el, api, date, action, confirmAction, notice } from "./ui.js";
const KINDS = { info: "情報", event: "イベント", maintenance: "メンテナンス" }, LINKS = { download: "ダウンロードページ", discord: "Discord招待" };
const localInput = seconds => { const d = new Date(seconds * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const seconds = value => Math.floor(new Date(value).getTime() / 1000);
function preview() {
  const text = $("news-text").value.trim();
  $("news-count").textContent = `${[...text].length} / 140`;
  $("news-preview").textContent = text ? `${KINDS[$("news-kind").value]} · ${text}${$("news-link").value ? `  ${LINKS[$("news-link").value]} →` : ""}` : "";
}
export async function loadNews() {
  const data = await api("/api/news"); $("news-list").replaceChildren();
  if (!data.news.length) $("news-list").append(el("p", "お知らせはまだありません。", "empty"));
  for (const n of data.news) {
    const card = el("article", undefined, "card"), head = el("div", undefined, "card-head");
    head.append(el("h3", n.text), el("span", state(n.state), "tag"));
    card.append(head, el("p", `${KINDS[n.kind] || "不明"} · ${n.link ? LINKS[n.link] || "不明なリンク" : "リンクなし"}`), el("p", `${date(n.startsAt)} – ${date(n.endsAt)}`, "hint"));
    if (["live", "scheduled"].includes(n.state)) {
      const stop = el("button", "停止", "danger"); stop.type = "button";
      stop.onclick = async () => { if (await confirmAction("このお知らせを停止しますか？", "友達の次回の取得後に表示されなくなります（通常6時間以内）。")) await action(stop, async () => { await api("/api/news/stop", { id: n.id }); notice("お知らせを停止しました。"); await loadNews(); }); };
      card.append(stop);
    }
    $("news-list").append(card);
  }
}
export function setupNews() {
  const t = Math.floor(Date.now() / 1000);
  $("news-starts").value = localInput(t); $("news-ends").value = localInput(t + 7 * 86400);
  $("news-zone").textContent = `入力時刻：${Intl.DateTimeFormat().resolvedOptions().timeZone}。表示日時は日本時間です。`;
  for (const id of ["news-text", "news-kind", "news-link"]) $(id).oninput = preview;
  preview();
  $("news-form").onsubmit = event => {
    event.preventDefault();
    action($("save-news"), async () => {
      await api("/api/news", { text: $("news-text").value, kind: $("news-kind").value, link: $("news-link").value || null, startsAt: seconds($("news-starts").value), endsAt: seconds($("news-ends").value) });
      $("news-text").value = ""; preview(); notice("お知らせを公開しました。"); await loadNews();
    });
  };
  $("refresh-news").onclick = () => action($("refresh-news"), loadNews);
}
