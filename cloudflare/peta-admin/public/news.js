import { $, el, api, date, action, confirmAction, notice } from "./ui.js";
const KINDS = { info: "Info", event: "Event", maintenance: "Maintenance" }, LINKS = { download: "The download page", discord: "The Discord invite" };
const localInput = seconds => { const d = new Date(seconds * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const seconds = value => Math.floor(new Date(value).getTime() / 1000);
function preview() {
  const text = $("news-text").value.trim();
  $("news-count").textContent = `${[...text].length} / 140`;
  $("news-preview").textContent = text ? `${KINDS[$("news-kind").value]} · ${text}${$("news-link").value ? `  ${LINKS[$("news-link").value]} →` : ""}` : "";
}
export async function loadNews() {
  const data = await api("/api/news"); $("news-list").replaceChildren();
  if (!data.news.length) $("news-list").append(el("p", "No announcements yet.", "empty"));
  for (const n of data.news) {
    const card = el("article", undefined, "card"), head = el("div", undefined, "card-head");
    head.append(el("h3", n.text), el("span", n.state, "tag"));
    card.append(head, el("p", `${KINDS[n.kind] || "Unknown"} · ${n.link ? LINKS[n.link] || "Unknown link" : "No link"}`), el("p", `${date(n.startsAt)} – ${date(n.endsAt)}`, "hint"));
    if (["live", "scheduled"].includes(n.state)) {
      const stop = el("button", "Stop", "danger"); stop.type = "button";
      stop.onclick = async () => { if (await confirmAction("Stop this announcement?", "Friends stop seeing it after Peta checks in (within about 6 hours).")) await action(stop, async () => { await api("/api/news/stop", { id: n.id }); notice("Announcement stopped."); await loadNews(); }); };
      card.append(stop);
    }
    $("news-list").append(card);
  }
}
export function setupNews() {
  const t = Math.floor(Date.now() / 1000);
  $("news-starts").value = localInput(t); $("news-ends").value = localInput(t + 7 * 86400);
  $("news-zone").textContent = `Times use ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
  for (const id of ["news-text", "news-kind", "news-link"]) $(id).oninput = preview;
  preview();
  $("news-form").onsubmit = event => {
    event.preventDefault();
    action($("save-news"), async () => {
      await api("/api/news", { text: $("news-text").value, kind: $("news-kind").value, link: $("news-link").value || null, startsAt: seconds($("news-starts").value), endsAt: seconds($("news-ends").value) });
      $("news-text").value = ""; preview(); notice("Announcement published."); await loadNews();
    });
  };
  $("refresh-news").onclick = () => action($("refresh-news"), loadNews);
}
