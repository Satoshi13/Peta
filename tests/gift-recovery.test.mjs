import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../src/app/js/ceremony.js',import.meta.url),'utf8');
function fixture({metadataFails=false,reloadFails=false,laterFails=false}={}) {
  const nodes=new Map(),calls=[],toasts=[];let closed=false,reveal;
  const element=selector=>{const events=new Map();const el={style:{setProperty(){}},classList:{add(){},toggle(){}},append(){},getBoundingClientRect:()=>({left:0,top:0,width:100}),addEventListener:(type,fn)=>events.set(type,fn),fire:type=>events.get(type)?.()};nodes.set(selector,el);return el;};
  const gift={id:'gift-id',from:'Friend',opened:false};const cer={stage:{clientWidth:600,clientHeight:500,append(){},getBoundingClientRect:()=>({left:0,top:0,width:600,height:500})},root:{},hint(){},close:async()=>{closed=true;}};
  const context=vm.createContext({gift,S:{gifts:[gift]},overlay:()=>cer,h:element,img(){},A:{arrGift:'gift.png'},$:()=>element('part'),anim:async()=>{},fix(){},sleep:async()=>{},EASE:{out:'ease',spring:'ease'},Snd:{paperMotion:()=>()=>{},crack(){},swoosh(){},crinkle(){},tap(){}},Haptic:{tap(){}},drag(){},Bridge:{busy:false,invoke:async(cmd)=>{calls.push(cmd);if(laterFails&&cmd==='print_later')throw Error('later');return 'sticker-id';},entry:async()=>{if(metadataFails)throw Error('metadata');return {id:'sticker-id'};},reload:async()=>{if(reloadFails)throw Error('refresh');}},Shell:{refresh(){},renderNav(){},toast:s=>toasts.push(s),error:e=>toasts.push(String(e))},Desktop:{print:async()=>{}},
    deskFor:()=>({lamp(){}}),packSheet:()=>({slot:element('sheet-slot'),place(){},fill:async()=>{}}),rarityOf:()=>'common',DESK:{common:{light:'255,247,232'}},clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
    peelAndReveal:async options=>{reveal=options;}});
  vm.runInContext(source.slice(source.indexOf('async function closeCommittedPreview'),source.indexOf('const Cer =')),context);
  vm.runInContext(source.slice(source.indexOf('  async function openGift('),source.indexOf('  async function openPack(')),context);
  return {gift,calls,toasts,context,open:()=>vm.runInContext('openGift(gift)',context),crack:()=>nodes.get('div.wax').fire('click'),pull:()=>nodes.get('sheet-slot').fire('dblclick'),later:()=>reveal.onLater(),get closed(){return closed;}};
}
for(const failure of ['metadataFails','reloadFails']) test(`Gift ownership stays received after ${failure}`,async()=>{
  const f=fixture({[failure]:true});await f.open();await f.crack();
  assert.equal(f.gift.opened,true);assert.equal(f.closed,true);assert.equal(f.context.Bridge.busy,false);
  assert.deepEqual(f.calls,['gift_open']);assert.match(f.toasts.at(-1),/opened and saved/);
});
test('a failed Later leaves the received Gift saved and clears the ceremony, with no duplicate action',async()=>{
  const f=fixture({laterFails:true});await f.open();await f.crack();await f.pull();await f.later();await f.later();
  assert.equal(f.gift.opened,true);assert.equal(f.closed,true);assert.equal(f.context.Bridge.busy,false);
  assert.deepEqual(f.calls,['gift_open','print_later']);assert.match(f.toasts.at(-1),/Gift saved/);
});
