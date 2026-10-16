import { $, el, api, action } from "./ui.js";
const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
const day = seconds => new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const scraps = milli => (milli / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
/* One measure per chart, one hue, bars from a shared baseline; each day's column carries its own tooltip. */
function bars(rows, value, unit) {
  const W = 600, H = 132, top = 14, bottom = 22, left = 4, step = (W - left) / rows.length, bw = Math.max(4, step - 4), max = Math.max(1, ...rows.map(value)), base = H - bottom;
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `${unit} per day, last ${rows.length} days, highest ${max}` });
  chart.append(svg("line", { x1: 0, x2: W, y1: top, y2: top, class: "grid" }));
  const label = svg("text", { x: W, y: top - 4, "text-anchor": "end" }); label.textContent = `${max.toLocaleString()} ${unit}`; chart.append(label);
  rows.forEach((r, i) => {
    const v = value(r), h = v ? Math.max(2, (v / max) * (base - top)) : 0, x = left + i * step + (step - bw) / 2, y = base - h, rad = Math.min(4, h / 2, bw / 2);
    const col = svg("g", { class: "col" }), tip = svg("title");
    tip.textContent = `${day(r.day)} · ${v.toLocaleString()} ${unit}`;
    col.append(tip, svg("rect", { x: left + i * step, y: top, width: step, height: base - top, class: "hit" }));
    if (h) col.append(svg("path", { class: "bar", d: `M${x},${base}V${y + rad}Q${x},${y} ${x + rad},${y}H${x + bw - rad}Q${x + bw},${y} ${x + bw},${y + rad}V${base}Z` }));
    chart.append(col);
  });
  chart.append(svg("line", { x1: 0, x2: W, y1: base, y2: base, class: "base" }));
  for (const [i, anchor] of [[0, "start"], [rows.length - 1, "end"]]) { const t = svg("text", { x: anchor === "start" ? left : W, y: H - 6, "text-anchor": anchor }); t.textContent = day(rows[i].day); chart.append(t); }
  return chart;
}
export async function loadMarket() {
  const d = await api("/api/market"), root = $("market-content"), month = d.daily.reduce((s, r) => ({ pulls: s.pulls + r.pulls, scraps: s.scraps + r.scraps, sellerMilli: s.sellerMilli + r.sellerMilli }), { pulls: 0, scraps: 0, sellerMilli: 0 });
  const tiles = el("div", undefined, "stat-grid");
  for (const [value, label] of [[d.openListings, "Packs out now"], [d.sellers, "Friends selling"], [month.pulls, "Pulls, 30 days"], [month.scraps, "Scraps spent, 30 days"]]) {
    const tile = el("div", undefined, "stat"); tile.append(el("strong", value.toLocaleString()), el("span", label)); tiles.append(tile);
  }
  const table = el("table", undefined, "market-table"), head = el("tr");
  for (const h of ["Day (UTC)", "Pulls", "Scraps spent", "To sellers"]) head.append(el("th", h));
  table.append(head);
  for (const r of [...d.daily].reverse()) { const row = el("tr"); for (const v of [day(r.day), r.pulls.toLocaleString(), r.scraps.toLocaleString(), scraps(r.sellerMilli)]) row.append(el("td", v)); table.append(row); }
  const details = el("details"); details.append(el("summary", "Show the numbers as a table"), table);
  root.replaceChildren(tiles,
    el("p", `Sellers have received ${scraps(d.allTime.sellerMilli)} Scraps in all (${scraps(month.sellerMilli)} in the last 30 days), from ${d.allTime.pulls.toLocaleString()} pulls.`),
    el("h3", "Pulls per day"), bars(d.daily, r => r.pulls, "pulls"),
    el("h3", "Scraps spent per day"), bars(d.daily, r => r.scraps, "Scraps"),
    el("p", "Days are counted in UTC. Scraps spent are what friends paid; sellers receive their share of it.", "hint"), details);
}
export function setupMarket() { $("refresh-market").onclick = () => action($("refresh-market"), loadMarket); }
