// Golden screenshots of the prototype — the visual spec for the port.
//   python3 -m http.server 8766 --directory <repo root> &
//   node docs/ui-proposals/app/tools/shoot.mjs [outDir] [shell]      (needs `playwright` + a chromium)
// Default out: docs/port-spec/golden, default shell: studio. 1440x900, Aa Std type. Deterministic enough to diff by eye / pixelmatch.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const out = process.argv[2] || "docs/port-spec/golden", shell = process.argv[3] || "studio";
const exe = process.env.CHROMIUM || (await import("node:fs")).readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
const base = process.env.BASE || "http://localhost:8766/docs/ui-proposals/app/index.html";
(await import("node:fs")).mkdirSync(out, { recursive: true });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })).newPage();
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (name, ms = 1400) => { await wait(ms); await p.screenshot({ path: `${out}/${shell}-${name}.jpg`, type: "jpeg", quality: 86 }); console.log("shot", name); };
const go = async (pg) => { await p.evaluate((g) => { Shell.open(g); Shell.go(g); }, pg); };
const tear = async () => { const r = await p.evaluate(() => { const e = document.querySelector(".pouch").getBoundingClientRect(); return [e.left, e.top, e.width, e.height]; }); const x0 = r[0] + r[2] * .14, y0 = r[1] + r[3] * .2; await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i <= 18; i++) { await p.mouse.move(x0 + i * r[2] * .06, y0); await wait(25); } await p.mouse.up(); };
const pull = async (sel) => { const s = await p.evaluate((q) => { const e = document.querySelector(q).getBoundingClientRect(); return [e.left, e.top, e.width]; }, sel); await p.mouse.move(s[0] + s[2] / 2, s[1] + 30); await p.mouse.down(); for (let i = 1; i <= 14; i++) { await p.mouse.move(s[0] + s[2] / 2, s[1] + 30 - i * 16); await wait(25); } await p.mouse.up(); };

await p.goto(`${base}?shell=${shell}&type=current`); await wait(2600);
await shot("01-today-envelope");
await p.click(".btn.open"); await wait(2300); await shot("02-today-pouch", 200);
await tear(); await wait(1800); await shot("03-today-pouch-torn", 100);
await pull(".mcard.in-wrap"); await wait(2800); await shot("04-today-material-reveal", 100);
await p.click(".rv-btns .btn"); await wait(3200); await shot("05-today-opened", 200);
await go("create"); await shot("06-create-empty");
await p.click(".sample >> nth=2"); await wait(3500); await shot("07-create-cutting-mat", 100);
await p.click(".btn.keep, button:has-text('Make this Peta')").catch(() => {}); await wait(3500); await shot("08-create-printed", 100);
await p.evaluate(() => Desktop.later()); await wait(1500);
await go("book"); await shot("09-book");
await p.click(".tile >> nth=0").catch(() => {}); await shot("10-book-detail", 900);
await go("packs"); await shot("11-packs-shelf");
await p.click(".pack:not(:disabled)"); await wait(1200); await shot("12-pack-ceremony", 100);
await tear(); await wait(1800); await shot("13-pack-torn", 100);
await pull(".pk-sleeve"); await wait(4200); await shot("14-pack-reveal", 100);
await p.click(".rv-btns .btn.paper"); await wait(1500);
await go("gifts"); await shot("15-gifts");
await go("market"); await shot("16-market-packs");
await p.click('text="Materials"').catch(() => {}); await shot("17-market-materials", 900);
await p.click('text="Creators"').catch(() => {}); await shot("18-market-creators", 900);
await go("materials"); await shot("19-materials");
await go("settings"); await shot("20-settings");
await b.close();
