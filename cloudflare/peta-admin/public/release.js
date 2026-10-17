import { $, el, api, date, action } from "./ui.js";
export async function loadRelease() {
  const data = await api("/api/release"); $("latest-release").replaceChildren(); $("release-list").replaceChildren();
  if (data.latest) {
    const r = data.latest, card = el("article", undefined, "card"), facts = el("div", undefined, "release-grid");
    card.append(el("p", "最新のリリース", "eyebrow"), el("h3", `Peta ${r.version}`));
    for (const [value, label] of [[`${(r.size / 1024 / 1024).toFixed(1)} MB`, "ディスクイメージ"], [new Date(r.publishedAt).toLocaleDateString("ja-JP",{timeZone:"Asia/Tokyo"}), "公開日"], [`macOS ${r.minimumSystemVersion}+`, r.architectures.join(" / ")]]) { const fact = el("div"); fact.append(el("strong", value), el("span", label, "hint")); facts.append(fact); }
    card.append(facts); $("latest-release").append(card);
  } else $("latest-release").append(el("p", "現在利用できるリリースはありません。", "empty"));
  if (!data.downloads.length && !data.updates?.length) $("release-list").append(el("p", "ダウンロード記録はまだありません。", "empty"));
  const versions=[...new Set([...data.downloads,...(data.updates||[])].map(r=>r.version))];
  for (const version of versions) {
    const page=data.downloads.find(r=>r.version===version),update=data.updates?.find(r=>r.version===version),card=el("article",undefined,"card");
    card.append(el("h3",version),el("p",`ダウンロードページ：${page?.people||0} 人 · ${page?.downloads||0} 回`),el("p",`アプリ内更新：${update?.devices||0} 台 · ${update?.downloads||0} 回`),el("p",`最終ダウンロード：${date(Math.max(page?.lastAt||0,update?.lastAt||0))}`,"hint"));$("release-list").append(card);
  }
}
export function setupRelease() { $("refresh-release").onclick = () => action($("refresh-release"), loadRelease); }
