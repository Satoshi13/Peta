import { $, el, api, date, action } from "./ui.js";
export async function loadRelease() {
  const data = await api("/api/release"); $("latest-release").replaceChildren(); $("release-list").replaceChildren();
  if (data.latest) {
    const r = data.latest, card = el("article", undefined, "card"), facts = el("div", undefined, "release-grid");
    card.append(el("p", "LATEST RELEASE", "eyebrow"), el("h3", `Peta ${r.version}`));
    for (const [value, label] of [[`${(r.size / 1024 / 1024).toFixed(1)} MB`, "Disk image"], [new Date(r.publishedAt).toLocaleDateString(), "Published"], [`macOS ${r.minimumSystemVersion}+`, r.architectures.join(" / ")]]) { const fact = el("div"); fact.append(el("strong", value), el("span", label, "hint")); facts.append(fact); }
    card.append(facts); $("latest-release").append(card);
  } else $("latest-release").append(el("p", "No current release is available yet.", "empty"));
  if (!data.downloads.length && !data.updates?.length) $("release-list").append(el("p", "No downloads recorded yet.", "empty"));
  const versions=[...new Set([...data.downloads,...(data.updates||[])].map(r=>r.version))];
  for (const version of versions) {
    const page=data.downloads.find(r=>r.version===version),update=data.updates?.find(r=>r.version===version),card=el("article",undefined,"card");
    card.append(el("h3",version),el("p",`Download page: ${page?.people||0} friends · ${page?.downloads||0} downloads`),el("p",`In-app update: ${update?.devices||0} Macs · ${update?.downloads||0} downloads`),el("p",`Last download: ${date(Math.max(page?.lastAt||0,update?.lastAt||0))}`,"hint"));$("release-list").append(card);
  }
}
export function setupRelease() { $("refresh-release").onclick = () => action($("refresh-release"), loadRelease); }
