/** Owner desk, Packs tab: drafts, pictures, preview, ready-to-sign, signed contents and periods, against stubbed APIs
 * (no Worker, no real data). Set PETA_PLAYWRIGHT_MODULE and optionally PETA_BROWSER; PETA_SHOTS for screenshots.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'), shots=process.env.PETA_SHOTS || join(tmpdir(),'peta-admin-packs');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')) return res.writeHead(403).end();
  try {const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream'}).end(data);}
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,8+data.length)),8+data.length);return out;};
function png(w,h,alpha=true){
  const ch=alpha?4:3,raw=Buffer.alloc(h*(1+w*ch));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=y*(1+w*ch)+1+x*ch,inside=(x-w/2)**2+(y-h/2)**2<(Math.min(w,h)/3)**2;raw.set(alpha?[190,100,60,inside?255:0]:[190,100,60],at);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=alpha?6:2;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const contract=JSON.parse(await readFile(resolve(root,'cloudflare/shared/shop-pack-contract.json'),'utf8'));
const {shopCatalog}=JSON.parse(await readFile(resolve(root,'cloudflare/peta-admin/test/config-vector.json'),'utf8'));
const items=[{key:'maple',name:'Maple Leaf',rarity:'common',weight:null},{key:'acorn',name:'Acorn',rarity:'uncommon',weight:null},{key:'chestnut',name:'<b>Chestnut</b>',rarity:'rare',weight:null}];
const manifest={packId:'autumn',version:2,title:'Autumn Walk',by:'Peta',blurb:'Leaves on the way home.',pouch:'matte',color:'rose',price:12,items};
const draft={draftId:'d-0123456789abcdef',packId:'autumn',version:2,state:'draft',manifest,pictures:items.map(i=>({key:i.key,size:900})),updatedAt:1760000000,command:null};
const ready={...draft,draftId:'d-fedcba9876543210',packId:'winter',version:1,state:'ready',manifest:{...manifest,packId:'winter',version:1,title:'Winter Light'},command:'bash scripts/sign-pack.sh d-fedcba9876543210 prod'};
const packs=[{packId:'autumn',version:1,title:'Autumn Walk',price:12,size:4200,sha256:'ab'.repeat(32),keyId:'k2',startsAt:1760000000,endsAt:null,stoppedAt:null,removedAt:null,createdAt:1760000000,state:'on sale'},
  {packId:'spring',version:1,title:'Spring',price:8,size:3000,sha256:'cd'.repeat(32),keyId:'k2',startsAt:null,endsAt:null,stoppedAt:null,removedAt:null,createdAt:1760000000,state:'signed'}];
// A signed file as the page reads it: header JSON, then the pictures. The signature is not checked here (the app checks it).
function signedFile(){
  const pics=items.map(()=>png(40,40));
  const header={eventId:'shop-autumn-v1',kind:'shop_pack',issuedAt:'2026-10-16T00:00:00Z',notBefore:null,notAfter:null,title:'Autumn Walk',message:'',payload:{...manifest,version:1,title:'<i>Autumn</i> Walk'},signer:{kind:'official',keyId:'k2'},attachments:items.map((i,n)=>({key:i.key,pngLen:pics[n].length,maskLen:0}))};
  const json=Buffer.from(JSON.stringify(header)),len=Buffer.alloc(4);len.writeUInt32BE(json.length);
  return Buffer.concat([Buffer.from('PETAEVNT'),Buffer.from([1]),len,json,...pics,Buffer.alloc(64)]);
}
const posts=[],puts=[];
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER ? {executablePath:process.env.PETA_BROWSER} : {})});
  const page=await browser.newPage({viewport:{width:1060,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    if(method==='PUT'){puts.push(path);return route.fulfill({json:{saved:true}});}
    if(method==='POST'){posts.push([path,route.request().postDataJSON()]);return route.fulfill({json:path==='/api/packs/drafts'?{draftId:draft.draftId}:{ok:true,command:ready.command}});}
    if(path.startsWith('/api/packs/drafts/')&&path.includes('/pictures/'))return route.fulfill({body:png(48,48),contentType:'image/png'});
    if(path==='/api/packs/file/autumn/1')return route.fulfill({body:signedFile(),contentType:'application/octet-stream'});
    const data={'/api/me':{email:'owner@example.test'},'/api/friends':{friends:[],revision:'1',downloadPage:''},'/api/reports':{open:0,reports:[],blocked:[]},
      '/api/packs':{contract,maxLive:24,drafts:[draft,ready],packs,storage:{objects:9,bytes:52000,truncated:false}},
      '/api/shop':{catalog:{...shopCatalog,packs:[...shopCatalog.packs,{id:'shop:autumn',title:'Autumn Walk',price:12,free:false,shop:true}]},configs:[]}}[path];
    await route.fulfill(data?{json:data}:{status:404,json:{error:'not_found',message:'Not here.'}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/cloudflare/peta-admin/public/index.html`);
  await mkdir(shots,{recursive:true});
  await page.locator(".wordmark").evaluate(img=>img.decode());
  assert.ok(await page.locator(".wordmark").evaluate(img=>img.naturalWidth>0));

  await page.getByRole('tab',{name:"パック"}).click();
  await page.getByText("Mac での署名待ち").waitFor();
  assert.equal(await page.locator('.pk-command').textContent(),ready.command);
  assert.equal(await page.locator('#packs-signed .tag').first().textContent(),'掲載中');
  assert.match(await page.locator('#packs-storage').textContent(),/9 ファイル · 51 KB/);

  // Edit: the preview tells the chances; an opaque picture is refused here, a transparent one goes up and the draft is saved.
  await page.getByRole('button',{name:"編集"}).click();await page.locator('.pk-editor').waitFor();
  await page.locator('.pk-free input').check();assert.equal(await page.locator('.pk-editor input[type=number]').first().isDisabled(),true);await page.locator('.pk-free input').uncheck();
  assert.match(await page.locator('.pk-preview .hint').textContent(),/通常 57% · ときどき 29% · レア 14%/);
  assert.equal(await page.locator('.pk-stickers figcaption b').count(),0,'names are plain text');
  const dir=join(tmpdir(),`peta-packs-${process.pid}`);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'opaque.png'),png(30,30,false));await writeFile(join(dir,'pine-cone.png'),png(1600,800));
  await page.locator('.pk-file').setInputFiles(join(dir,'opaque.png'));
  await page.waitForFunction(()=>document.querySelector('.pk-editor .daily-error').textContent.includes("背景が透明ではありません"));
  assert.equal(puts.length,0);
  await page.locator('.pk-file').setInputFiles(join(dir,'pine-cone.png'));
  await page.waitForFunction(()=>document.querySelectorAll('.pk-items li').length===4);
  assert.deepEqual(puts,['/api/packs/drafts/d-0123456789abcdef/pictures/pine-cone']);
  const saved=posts.filter(p=>p[0]==='/api/packs/drafts/save').at(-1)[1];
  assert.equal(saved.manifest.items.at(-1).key,'pine-cone');assert.equal(saved.manifest.items.at(-1).name,'pine cone');
  await page.locator('.pk-items li').nth(3).locator('select').selectOption('rare');
  assert.match(await page.locator('.pk-preview .hint').textContent(),/レア 25%/);
  await page.screenshot({path:join(shots,'packs-editor-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:"署名の準備をする"}).click();await page.locator('#accept-confirm').click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('コマンドをコピー'));
  assert.deepEqual(posts.slice(-2).map(p=>p[0]),['/api/packs/drafts/save','/api/packs/drafts/ready']);

  // A signed pack's contents: plain text and blob: pictures. Then put another on sale for a period.
  await page.getByRole('button',{name:"内容を見る"}).first().click();await page.locator('.pk-contents img').first().waitFor();
  assert.match(await page.locator('.pk-contents img').first().getAttribute('src'),/^blob:/);
  assert.equal(await page.locator('.pk-contents i').count(),0);assert.match(await page.locator('.pk-contents').textContent(),/<i>Autumn<\/i> Walk · 作り手 Peta · 12 Scraps · マット（ローズ） · 署名鍵 k2/);
  await page.getByRole('button',{name:"ショップに並べる"}).click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('保存しました'));
  const publish=posts.find(p=>p[0]==='/api/packs/publish')[1];
  assert.equal(publish.packId,'spring');assert.ok(Number.isInteger(publish.startsAt) && Number.isInteger(publish.endsAt));

  // The shop setting can feature the new pack.
  await page.getByRole('tab',{name:"ショップ"}).click();await page.locator('#shop-featured').getByText('Autumn Walk').waitFor();

  // Phone width: nothing wider than the screen.
  await page.setViewportSize({width:375,height:800});
  await page.getByRole('tab',{name:"パック"}).click();await page.getByRole('button',{name:"編集"}).click();await page.locator('.pk-editor').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scrolling at 375px');
  await page.screenshot({path:join(shots,'packs-editor-375.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(`Packs tab: drafts, transparent-only pictures, chances, ready to sign, signed contents as plain text and blob: images, periods, shop featuring and 375px: PASS (${shots})`);
} finally {await browser?.close();server.close();}
