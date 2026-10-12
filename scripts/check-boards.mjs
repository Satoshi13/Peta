/** Real UI with isolated IPC. Requires Playwright (or PETA_PLAYWRIGHT_MODULE).
 * PETA_BROWSER chooses Chromium; PETA_BOARDS_OUT saves screenshots. Never opens the user's library.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const data=await readFile(path);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.ttf':'font/ttf'})[extname(path)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/src/app.html`,out=process.env.PETA_BOARDS_OUT;
if(out)await mkdir(out,{recursive:true});
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER?{executablePath:process.env.PETA_BROWSER}:{})});
  const page=await browser.newPage({viewport:{width:1060,height:700}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript({path:resolve(root,'scripts/ui-fixes-oct07-fixture.js')});
  await page.addInitScript(()=>{
    window.reviewDeveloper=false;window.reviewBalance=60;
    const original=window.__TAURI__.core.invoke;let n=0;
    window.__TAURI__.core.invoke=async(cmd,args)=>{
      const data=window.reviewBoards,target=id=>data.screens.find(s=>s.id===id);
      if(cmd.startsWith('boards_') && cmd!=='boards_status' && cmd!=='boards_take_notes' || cmd.startsWith('board_rule_') || cmd==='scrap_trade'){
        window.reviewCalls.push({cmd,args});
        if(window.reviewBoardError===cmd)throw Error('Could not save this board.');
        if(cmd==='boards_location_request'){data.location.prompted=true;return data.location;}
        if(cmd==='boards_save'){const id='saved-'+(++n);const items=structuredClone(target(args.displayId).items);data.boards.push({id,name:args.name,items,stickers:items});data.stock.available--;return {id};}
        if(cmd==='boards_rename'){data.boards.find(b=>b.id===args.boardId).name=args.name;return;}
        if(cmd==='boards_update'){const b=data.boards.find(b=>b.id===args.boardId);b.items=b.stickers=structuredClone(target(args.displayId).items);return;}
        if(cmd==='boards_delete'){data.boards=data.boards.filter(b=>b.id!==args.boardId);data.rules=data.rules.filter(r=>r.boardId!==args.boardId);data.stock.available++;return;}
        if(cmd==='boards_put'){
          const screen=target(args.displayId),board=data.boards.find(b=>b.id===args.boardId);
          data.undo={displayId:screen.id,items:structuredClone(screen.items),at:'switch-'+(++n)};
          const skipped=board.stickers.filter(it=>it.state!=='held'||it.onDisplay&&it.onDisplay!==screen.id).map(it=>({stickerId:it.stickerId,reason:it.state!=='held'?'not_yours':'on_another_screen'}));
          screen.items=structuredClone(board.stickers.filter(it=>!skipped.some(s=>s.stickerId===it.stickerId)));return {displayId:screen.id,placed:screen.items.length,skipped};
        }
        if(cmd==='boards_undo'){target(data.undo.displayId).items=data.undo.items;data.undo=null;return {skipped:[]};}
        if(cmd==='boards_bring_here'){const from=target(args.fromDisplay),to=target(args.toDisplay);to.items.push(...from.items.map(it=>({...it,onDisplay:to.id})));from.items=[];return 1;}
        if(cmd==='board_rule_save'){const rule={...args.rule,id:args.rule.id||'rule-'+(++n)};data.rules=data.rules.filter(r=>r.id!==rule.id);data.rules.push(rule);return rule;}
        if(cmd==='board_rule_delete'){data.rules=data.rules.filter(r=>r.id!==args.ruleId);return;}
        if(cmd==='board_rule_toggle'){const r=data.rules.find(r=>r.id===args.ruleId);r.enabled=!r.enabled;return;}
        if(cmd==='board_rule_move')return;
        if(cmd==='scrap_trade'){
          const receipt=window.reviewReceipts?.[args.requestId];if(receipt)return receipt;
          data.stock.owned++;data.stock.available++;window.reviewBalance-=12;
          const result={balance:window.reviewBalance};(window.reviewReceipts||={})[args.requestId]=result;
          if(window.reviewLostReceipt){window.reviewLostReceipt=false;throw Error('Response lost');}return result;
        }
        throw Error('Unexpected board fixture command: '+cmd);
      }
      const result=await original(cmd,args);if(cmd==='pack_status')result.limits={copiesPerDesign:30,packSlots:200,prizes:10};return result;
    };
  });
  await page.goto(url+'?page=boards');await page.waitForSelector('.boardspage');
  assert.ok(await page.locator('#nav [data-page="boards"]').isVisible());
  assert.equal(await page.locator('[data-board="one"] .bd-ghost').count(),2);
  await page.waitForFunction(()=>document.querySelector('.bd-stk')?.naturalWidth>0);
  await page.getByRole('button',{name:'Put Work on MacBook Pro',exact:true}).click();
  await page.waitForFunction(()=>!Pages.boards.busy && !!S.boards.undo);
  assert.match(await page.locator('#toast').textContent(),/2 skipped/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!Pages.boards.busy&&!S.boards.undo);
  await page.getByRole('button',{name:'Save this screen…',exact:true}).click();await page.getByRole('textbox',{name:'Board name'}).fill('Kept');
  await page.evaluate(()=>window.reviewBoardError='boards_save');await page.getByRole('button',{name:'Keep on a board',exact:true}).click();
  await page.waitForFunction(()=>!Pages.boards.busy);assert.ok(await page.locator('dialog[open]').isVisible());assert.match(await page.locator('dialog .bd-error').textContent(),/Could not change/);
  await page.evaluate(()=>window.reviewBoardError=null);await page.getByRole('button',{name:'Keep on a board',exact:true}).click();await page.waitForSelector('dialog',{state:'detached'});assert.equal(await page.evaluate(()=>BD.stock),0);
  await page.getByRole('button',{name:'More for Kept',exact:true}).click();await page.getByRole('menuitem',{name:'Rename…',exact:true}).click();await page.getByRole('textbox',{name:'Board name'}).fill('Renamed');await page.getByRole('button',{name:'Rename',exact:true}).click();await page.waitForSelector('dialog',{state:'detached'});
  await page.getByRole('button',{name:'More for Renamed',exact:true}).click();await page.getByRole('menuitem',{name:'Update with MacBook Pro',exact:true}).click();await page.waitForFunction(()=>!Pages.boards.busy);assert.equal(await page.evaluate(()=>BD.stock),0);
  await page.getByRole('button',{name:'Bring them here',exact:true}).click();await page.waitForFunction(()=>!Pages.boards.busy);assert.equal(await page.evaluate(()=>reviewCalls.find(c=>c.cmd==='boards_bring_here').args.toDisplay),'main');
  await page.getByRole('button',{name:'More for Renamed',exact:true}).click();await page.getByRole('menuitem',{name:'Delete…',exact:true}).click();await page.getByRole('button',{name:'Delete look',exact:true}).click();await page.waitForSelector('dialog',{state:'detached'});assert.equal(await page.evaluate(()=>BD.stock),1);
  await page.getByRole('button',{name:'Add a rule…',exact:true}).click();await page.getByRole('button',{name:'Place',exact:true}).click();assert.equal(await page.evaluate(()=>reviewCalls.filter(c=>c.cmd==='boards_location_request').length),0);
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('textbox',{name:'Wi‑Fi name'}).fill('Chosen');assert.ok(await page.getByText('Location is off for Peta.',{exact:false}).isVisible());await page.getByRole('button',{name:'Add rule',exact:true}).click();await page.waitForSelector('dialog',{state:'detached'});assert.equal(await page.evaluate(()=>S.boards.rules[0].wifi),'Chosen');
  await page.getByRole('switch').click();await page.waitForFunction(()=>!Pages.boards.busy);assert.equal(await page.getByRole('switch').getAttribute('aria-checked'),'false');
  await page.evaluate(async()=>{BD.target='second';await window.__TAURI__.event.emit('app-page','boards-save');});assert.equal(await page.evaluate(()=>BD.target),'main');await page.waitForSelector('dialog[open]');await page.evaluate(()=>document.querySelector('dialog').close());
  await page.evaluate(async()=>{MK.tab='tools';await Shell.open('market');});let card=page.locator('.mk-tool').filter({has:page.getByRole('heading',{name:'Board ×1',exact:true})});assert.ok(await card.isVisible());assert.match(await card.locator('.mk-tool-price').textContent(),/12/);
  await page.evaluate(()=>window.reviewLostReceipt=true);await card.getByRole('button',{name:'Get a board',exact:true}).click();await page.waitForFunction(()=>!Pages.market.boardBusy);await card.getByRole('button',{name:'Retry board purchase',exact:true}).click();await page.waitForFunction(()=>!Pages.market.boardBusy);assert.equal(await page.evaluate(()=>S.boards.stock.owned),4);assert.equal(await page.evaluate(()=>reviewBalance),48);
  const buys=await page.evaluate(()=>reviewCalls.filter(c=>c.cmd==='scrap_trade'));assert.equal(buys[0].args.requestId,buys[1].args.requestId);
  await page.evaluate(async()=>{reviewBoards.stock={owned:12,available:9,limit:12};await Shell.open('market');});assert.ok(await card.getByRole('button',{name:'You have all 12 boards.',exact:true}).isDisabled());
  await page.evaluate(async()=>{reviewBoards.stock={owned:4,available:1,limit:12};reviewBalance=0;await Shell.open('market');});assert.ok(await card.getByRole('button',{name:'Not enough Scraps',exact:true}).isDisabled());
  await page.goto(url+'?page=boards-save');await page.waitForSelector('dialog[open]');assert.equal(await page.evaluate(()=>BD.target),'main');await page.evaluate(()=>document.querySelector('dialog').close());
  for(const shell of ['studio','desk'])for(const width of [1060,900,720,480]){
    await page.setViewportSize({width,height:width>=900?700:520});await page.evaluate(async s=>{Shell.setShell(s);S.motion='reduce';Bridge.savePreferences();await Shell.open('boards');},shell);await page.evaluate(async()=>{await document.fonts.ready;for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);});
    const overflow=await page.evaluate(()=>{const p=document.querySelector('.boardspage');return p.scrollWidth-p.clientWidth;});assert.ok(overflow<=2,`${shell}/${width} overflow ${overflow}`);
    if(out)await page.screenshot({path:resolve(out,`${shell}-${width}.png`)});
  }
  assert.deepEqual(errors,[]);console.log('Boards release UI, ghosts, put/undo, save/update/rename/delete/errors/bring, Place, tray routes, receipt retry, prices/cap, responsive: PASS');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
