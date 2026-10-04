// Layout audit: text that spills, is clipped by an ancestor, or leaves the window — for every page, shell and window size.
//   node docs/ui-proposals/app/tools/audit.mjs <outDir> [vw] [vh] [shells] [types] [WxH window size]   (server on :8766, see shoot.mjs)
// Known false positive: `spillX button.btn.paper` (the paper-label ::before bleeds 4px on purpose). Everything else should be 0.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const fs = await import("node:fs");
const out = process.argv[2] || '/tmp/peta-audit'; fs.mkdirSync(out, { recursive: true });
const exe = process.env.CHROMIUM || fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
const PAGES = ['today','create','book','packs','gifts','market','materials','settings'];
const scan = () => {
  const win = document.getElementById('win'); const res = [];
  const vp = document.querySelector('.viewport'); const page = document.querySelector('.page.current, .page:last-child') || vp;
  const root = vp.querySelector('.page') || vp; const R = vp.getBoundingClientRect();
  const sel = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\s+/).slice(0,3).join('.'); return s; };
  for (const e of vp.querySelectorAll('*')) {
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const txt = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // text clipped by own overflow
    if (txt && (e.scrollWidth > e.clientWidth + 1) && cs.overflowX !== 'visible' && e.clientWidth > 0) res.push(['clipX', sel(e), e.scrollWidth + '>' + e.clientWidth, e.textContent.trim().slice(0, 30)]);
    if (txt && (e.scrollHeight > e.clientHeight + 2) && cs.overflowY !== 'visible' && e.clientHeight > 0 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') res.push(['clipY', sel(e), e.scrollHeight + '>' + e.clientHeight, e.textContent.trim().slice(0, 30)]);
    // text overflowing its box (visible)
    if (txt && cs.overflowX === 'visible' && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && cs.display !== 'inline') res.push(['spillX', sel(e), e.scrollWidth + '>' + e.clientWidth, e.textContent.trim().slice(0, 30)]);
    // outside viewport of window
    if (txt && (r.right > R.right + 2 || r.left < R.left - 2) && !e.closest('.leaf,.pk-body,[aria-hidden=true]')) res.push(['outside', sel(e), Math.round(r.left - R.left) + ',' + Math.round(r.right - R.right) + ',' + Math.round(r.bottom - R.bottom), e.textContent.trim().slice(0, 30)]);
    if (txt && !e.closest('.leaf,.pk-body')) { let a = e.parentElement; while (a && a !== vp) { const c = getComputedStyle(a); if (c.overflowX !== 'visible') { const ar = a.getBoundingClientRect(); if (r.right > ar.right + 2 || r.left < ar.left - 2) { res.push(['ancClipX', sel(e), Math.round(r.left - ar.left) + ',' + Math.round(r.right - ar.right) + ' in ' + sel(a), e.textContent.trim().slice(0, 30)]); } break; } a = a.parentElement; } }
    // multi-line pill/button/tag that should be one line
    if (false && txt && /btn|chip|seal|price|tm-badge|cnt|tab|tag/.test(String(e.className)) && r.height > parseFloat(cs.lineHeight || 20) * 1.8 && cs.lineHeight !== 'normal') res.push(['wrapped', sel(e), Math.round(r.height), e.textContent.trim().slice(0, 30)]);
  }
  const pc = vp.scrollHeight > vp.clientHeight + 2 ? ['viewport-scroll', vp.scrollHeight + '>' + vp.clientHeight] : null; if (pc) res.push(pc);
  return res;
};
{
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await (await b.newContext({ viewport: { width: +process.argv[3] || 1440, height: +process.argv[4] || 900 }, ignoreHTTPSErrors: true })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const shells = (process.argv[5] || 'studio,notebook,desk').split(','), types = (process.argv[6] || 'current').split(',');
  for (const sh of shells) for (const ty of types) {
    await p.goto(`http://localhost:8766/docs/ui-proposals/app/index.html?shell=${sh}&type=${ty}`); await p.waitForTimeout(2200);
    // seed richer state
    await p.evaluate(() => { try { Market.get(MARKET_PACKS[1]); Market.get(MARKET_PACKS[2]); } catch (e) {} });
    if (process.argv[7]) await p.evaluate((s) => { const w = document.getElementById('win'); const [W,H] = s.split('x'); w.style.setProperty('--win-w', W+'px'); w.style.setProperty('--win-h', H+'px'); }, process.argv[7]);
    for (const pg of PAGES) {
      await p.evaluate((g) => { Shell.open(g); Shell.go(g); }, pg); await p.waitForTimeout(1500);
      const r = await p.evaluate(scan);
      await p.screenshot({ path: `${out}/au-${sh}-${ty}-${pg}.png` });
      console.log(`## ${sh}/${ty}/${pg}: ${r.length}`); for (const x of r.slice(0, 12)) console.log('  ', x.join(' | '));
    }
  }
  await b.close();
}
