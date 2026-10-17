/** Actual dev Worker integration: create a paid draft by dropping the native exported PNG.
 * Start scripts/official-packs-dev.cjs --dev first. Never connects to a production host.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
if(process.argv[2]!=='--dev')throw Error('Explicit --dev required.');
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE||'playwright');
const output=resolve('docs/official-packs-v2/dev');await mkdir(output,{recursive:true});
const cutout=process.env.PETA_TEST_CUTOUT||resolve('docs/official-packs-v2/native/exported-cut-out.png');
const pictures=await Promise.all([[cutout,'Skating Cat.png'],['src/art/samples/blue-flower.png','Blue Flower.png'],['src/art/samples/fried-egg.png','Fried Egg.png']].map(async([file,name])=>({name,bytes:[...await readFile(file)]})));
const browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER?{executablePath:process.env.PETA_BROWSER}:{})});
try{
 const page=await browser.newPage({viewport:{width:1060,height:900}});await page.goto('http://127.0.0.1:8789/');await page.getByRole('tab',{name:'パック',exact:true}).click();
 if(process.argv.includes('--resume')){
   await page.locator('#packs-drafts article').filter({hasText:'V2 Paid Test'}).getByRole('button',{name:'編集',exact:true}).click();await page.locator('.pk-editor').waitFor();
 }else{
 await page.getByLabel('新しいパックの ID',{exact:true}).fill('v2-paid-oct17');await page.getByRole('button',{name:'下書きを開始',exact:true}).click();await page.locator('.pk-editor').waitFor();
 await page.getByLabel('タイトル',{exact:true}).fill('V2 Paid Test');await page.getByLabel('Market の説明（任意）',{exact:true}).fill('A paid set for the v2 check.');await page.getByRole('combobox',{name:'袋',exact:true}).selectOption('matte');await page.getByRole('combobox',{name:'色',exact:true}).selectOption('rose');
 // A real DragEvent uses the same drop handler as dragging the saved cut-out from Finder.
 await page.evaluate(pictures=>{const dataTransfer=new DataTransfer();for(const p of pictures)dataTransfer.items.add(new File([new Uint8Array(p.bytes)],p.name,{type:'image/png'}));document.querySelector('.pk-drop').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));},pictures);
 await page.waitForFunction(()=>document.querySelectorAll('.pk-items li').length===3,{},{timeout:120000});
 }
 await page.locator('.pk-items select').nth(1).selectOption('uncommon');await page.locator('.pk-items select').nth(2).selectOption('rare');
 await page.screenshot({path:resolve(output,'paid-drop-draft.png'),fullPage:true});assert.match(await page.locator('.pk-preview').innerText(),/12 Scraps/);
 await page.getByRole('button',{name:'署名の準備をする',exact:true}).click();await page.locator('#accept-confirm').click();
 const card=page.locator('#packs-drafts article').filter({hasText:'V2 Paid Test'});await card.locator('.pk-command').waitFor({timeout:120000});
 const command=await card.locator('.pk-command').innerText();assert.match(command,/^bash scripts\/sign-pack.sh d-[a-f0-9]{16} dev$/);
 await writeFile('/tmp/peta-v2-native/paid-ready.json',JSON.stringify({command,draftId:command.split(' ')[2],packId:'v2-paid-oct17'})+'\n');
 await page.screenshot({path:resolve(output,'paid-ready.png'),fullPage:true});console.log(command);
}finally{await browser.close();}
