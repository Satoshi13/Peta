/** Real app layout with isolated IPC. No native commands or user data are used.
 * Run with Playwright installed, or set PETA_PLAYWRIGHT_MODULE to its index.mjs.
 * PETA_BROWSER selects a local Chromium executable; PETA_RESPONSIVE_OUT saves evidence.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PETA_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.ttf':'font/ttf', '.woff2':'font/woff2' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { const data = await readFile(path); res.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream'}).end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const out = process.env.PETA_RESPONSIVE_OUT;
if (out) await mkdir(out, {recursive:true});
const failures = [], records = [], errors = [];
const widths = process.env.PETA_RESPONSIVE_WIDTHS?.split(',').map(Number) || [1440,1060,900,881,880,800,720,600,480];
let browser;
try {
  browser = await chromium.launch({headless:true, ...(process.env.PETA_BROWSER ? {executablePath:process.env.PETA_BROWSER} : {})});
  const page = await browser.newPage({viewport:{width:1060,height:700}});
  page.on('pageerror', e => errors.push(String(e)));
  const fixture = () => {
    // The old review fixture predates pack limits and sticker details.
    const invoke = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (cmd, args) => {
      if (cmd === 'sticker_back') return {kind:'original',material:{id:'matte',name:'Matte'},createdBy:'Review',createdOn:'2026-10-07',originalNumber:1,idCode:args.stickerId};
      const result = await invoke(cmd, args);
      if (cmd === 'pack_status') result.limits = {copiesPerDesign:30,packSlots:200,prizes:10};
      return result;
    };
  };
  await page.addInitScript({content:await readFile(resolve(root, 'scripts/ui-fixes-oct07-fixture.js'),'utf8') + '\n(' + fixture.toString() + ')();'});
  await page.goto(`http://127.0.0.1:${server.address().port}/src/app.html?page=boards`);
  await page.waitForSelector('.boardspage');
  await page.evaluate(async () => { S.motion='reduce'; Bridge.savePreferences(); await document.fonts.ready; });
  const settle = () => page.evaluate(async () => { for (let i=0;i<4;i++) await new Promise(requestAnimationFrame); });
  const check = async (shell, width, state) => {
    await settle();
    const result = await page.evaluate(() => {
      const p = document.querySelector('.page-in'), r = p.getBoundingClientRect(), nav = document.querySelector('.nav').getBoundingClientRect();
      const clipped = [...p.querySelectorAll('button,input,select,textarea,.bd-display,.bd-slook')].filter(e => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && (b.right > r.right+2 || b.left < r.left-2) && !e.closest('.cs-rail,.t-others');
      }).map(e => e.className || e.tagName);
      const overflow = [...p.querySelectorAll('.bd-desk,.st-panel,.mk-tool,.cs-top,.cs-dock,.cs-rail,.setrow,.bk-filter')].filter(e => e.scrollWidth > e.clientWidth+2).map(e => [e.className,e.scrollWidth-e.clientWidth]);
      const chooser = p.querySelector('.bd-desk');
      return {pageOverflow:p.scrollWidth-p.clientWidth,clipped,overflow,sideNav:nav.right <= r.left+1 && nav.height > nav.width,
        chooserOverflow:chooser ? chooser.scrollWidth-chooser.clientWidth : null};
    });
    const record = {shell,width,state,...result}; records.push(record);
    if (result.pageOverflow > 2 || result.clipped.length || result.overflow.length || !result.sideNav || result.chooserOverflow > 2) failures.push(record);
  };
  const shot = async (name) => { if (out) await page.screenshot({path:resolve(out,name+'.png')}); };
  for (const shell of ['studio','desk']) {
    for (const width of widths) {
      await page.setViewportSize({width,height:width>=900 ? 700 : 520});
      await page.evaluate(s => { Shell.setShell(s); ST.mode=null; CR.stage='empty'; BK.sel=null; S.bookView='list'; }, shell);
      for (const route of ['boards','today','create','studio','book','packs','gifts','materials','market','settings']) {
        await page.evaluate(async id => Shell.open(id), route);
        await check(shell,width,route);
        if (route==='boards' && [1060,900,720].includes(width)) await shot(`${shell}-${width}-boards`);
      }
      for (const tab of ['materials','tools','creators']) {
        await page.evaluate(async t => { MK.tab=t; await Shell.open('market'); },tab);
        await check(shell,width,'market-'+tab);
      }
      for (const mode of ['pack','gift']) for (const step of [1,2,3]) {
        await page.evaluate(async ({mode,step}) => {
          ST.mode=mode; const d=ST[mode]; d.step=step;
          d.sel=[{id:'review-0',copies:1},{id:'review-1',copies:1},{id:'review-2',copies:1}];
          d.sticker='review-0'; d.to='Satoshi'; d.title='Review Pack'; await Shell.open('studio');
        },{mode,step});
        await check(shell,width,`studio-${mode}-${step}`);
      }
      // Resize the same live Studio page, without rebuilding the preview.
      const before = await page.locator('.st-stage .bagpic').evaluate(e => e.getBoundingClientRect().width);
      await page.setViewportSize({width:width===1440 ? 720 : 1440,height:700}); await settle();
      await page.setViewportSize({width,height:width>=900 ? 700 : 520}); await settle();
      const restored = await page.locator('.st-stage .bagpic').evaluate(e => e.getBoundingClientRect().width);
      if (Math.abs(before-restored)>=1) failures.push({shell,width,state:'studio-resize',before,restored});
      await page.evaluate(async () => { S.bookView='list'; BK.sel=null; await Shell.open('book'); });
      await page.locator('.bk-grid .tile').first().click();
      await check(shell,width,'book-detail');
      await page.evaluate(async () => { S.bookView='calendar'; BK.sel=null; await Shell.open('book'); });
      await check(shell,width,'book-calendar');
      await page.evaluate(async () => {
        const photo=Stk.cv(24,20); photo.getContext('2d').fillRect(4,4,16,12);
        const png=new Uint8Array(await (await new Promise(r => photo.toBlob(r,'image/png'))).arrayBuffer());
        const head=new TextEncoder().encode(JSON.stringify({stickerLen:png.length,width:24,height:20}));
        const frame=new Uint8Array(4+head.length+png.length*2); new DataView(frame.buffer).setUint32(0,head.length);
        frame.set(head,4); frame.set(png,4+head.length); frame.set(png,4+head.length+png.length);
        if (!window.responsiveInvoke) window.responsiveInvoke=Bridge.invoke;
        Bridge.invoke=async (cmd,args) => cmd==='creator_render' ? Array.from(frame) : cmd==='creator_info' ? {phase:'idle'} : window.responsiveInvoke(cmd,args);
        CR.stage='ready'; CR.photo=photo; CR.original=photo; CR.reveal=false; await Shell.open('create');
      });
      await check(shell,width,'create-ready');
      await page.getByRole('button',{name:'Fix the cutout',exact:true}).click();
      await check(shell,width,'create-edit');
      if (width===720) await shot(`${shell}-${width}-create`);
      await page.evaluate(async () => { await Shell.open('boards'); Pages.boards.ruleDialog(Pages.boards.paint); });
      await settle();
      const dialog = page.locator('dialog[open]');
      const bounds = await dialog.evaluate(e => { const r=e.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:e.scrollWidth-e.clientWidth}; });
      if (bounds.left<0 || bounds.right>width || bounds.top<0 || bounds.bottom> (width>=900 ? 700 : 520) || bounds.overflow>2) failures.push({shell,width,state:'board-rule-dialog',bounds});
      await dialog.getByRole('button',{name:'Add rule',exact:true}).scrollIntoViewIfNeeded();
      assert.ok(await dialog.getByRole('button',{name:'Add rule',exact:true}).isVisible());
      await page.evaluate(() => document.querySelector('dialog[open]').close());
    }
  }
  // Verify the compact menu scrolls to every section and Settings remains reachable.
  await page.setViewportSize({width:720,height:520});
  await page.evaluate(() => Shell.setShell('studio'));
  for (const id of ['today','create','studio','book','boards','packs','gifts','materials','market','settings']) {
    const button=page.locator(`.nav-item[data-page="${id}"]`); await button.scrollIntoViewIfNeeded();
    const b=await button.boundingBox(); assert.ok(b && b.x>=0 && b.x+b.width<=80 && b.y>=0 && b.y+b.height<=520,id);
  }
  assert.deepEqual(errors,[], 'Browser runtime errors');
  if (out) await writeFile(resolve(out,'results.json'), JSON.stringify({records,failures,errors},null,2));
  assert.deepEqual(failures,[], 'Responsive clipping regressions');
  console.log(JSON.stringify({passed:true,pageStates:records.length,shells:2,widths:[...widths].sort((a,b)=>a-b),dialogs:widths.length*2}));
} finally {
  await browser?.close(); await new Promise(r => server.close(r));
}
