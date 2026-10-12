import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=name=>fs.readFileSync(new URL(`../src/app/js/${name}.js`,import.meta.url),'utf8');
class Element {
  constructor(tag,props,children){this.tag=tag;Object.assign(this,props);this.children=children.flat(Infinity).filter(x=>x!=null);this.classList={add(){}};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
}
function h(tag,...args){const props=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{};return new Element(tag,props,args);}
function nodes(el){return el instanceof Element?[el,...el.children.flatMap(nodes)]:[];}
function text(el){return el instanceof Element?(el.textContent||el.children.map(text).join('')):String(el??'');}
function fixture({fail=false,refreshFails=false,hold=false}={}){
  const pack={id:'own-id',title:'Autumn',by:'Maker',left:Array(8).fill(null),total:8,own:true,canList:true,listed:false},calls=[],toasts=[];
  let release,refreshes=0;
  const context=vm.createContext({h,Pages:{},S:{packs:[pack]},Shell:{toast:t=>toasts.push(t),refresh:()=>refreshes++},Snd:{tap(){}},CloseButton:()=>h('button.close'),PackPeek:()=>null,
    Bridge:{busy:false,invoke:async(cmd,args)=>{calls.push({cmd,args});if(hold)await new Promise(r=>release=r);if(fail)throw Error('native failure');return args.listed;},reload:async()=>{assert.equal(pack.listed,calls.at(-1).args.listed);if(refreshFails)throw Error('refresh');}}});
  vm.runInContext(source('packs')+';this.PackListing=PackListing;this.PackZoom=PackZoom;PackArt.peek=async()=>[];',context);
  vm.runInContext(source('market')+';this.Market=Market;',context);
  context.PackZoom.current={pack};
  const control=context.PackListing.control(pack),button=nodes(control).find(n=>n.tag.startsWith('button'));
  return {context,pack,calls,toasts,control,button,release:()=>release(),refreshes:()=>refreshes};
}
test('listing success is recorded before a failed refresh, and repeated actions toggle the same pack',async()=>{
  const f=fixture({refreshFails:true});await f.button.on.click();
  assert.equal(f.pack.listed,true);assert.equal(f.button.textContent,'Take down from Market');assert.equal(f.context.Bridge.busy,false);assert.equal(f.pack.left.length,8);assert.equal(f.context.PackZoom.current.stale,true);
  assert.equal(f.calls[0].cmd,'creator_pack_set_listed');assert.equal(f.calls[0].args.packId,'own-id');assert.equal(f.calls[0].args.listed,true);assert.match(f.toasts[0],/Saved the listing/);
  await f.button.on.click();assert.equal(f.pack.listed,false);assert.equal(f.button.textContent,'List in Market');assert.equal(f.calls[1].args.packId,'own-id');assert.equal(f.calls[1].args.listed,false);
});
test('a failed listing keeps its old visibility and a pending click cannot issue a second command',async()=>{
  const failed=fixture({fail:true});await failed.button.on.click();assert.equal(failed.pack.listed,false);assert.equal(failed.button.disabled,false);assert.match(failed.toasts[0],/native failure/);
  const pending=fixture({hold:true});const first=pending.button.on.click();assert.equal(pending.button.disabled,true);await pending.button.on.click();assert.equal(pending.calls.length,1);pending.release();await first;assert.equal(pending.pack.listed,true);
});
test('closing the pack while the listing is pending refreshes the underlying page after commit',async()=>{
  const f=fixture({hold:true});const save=f.button.on.click();f.context.PackZoom.current=null;f.release();await save;assert.equal(f.pack.listed,true);assert.equal(f.refreshes(),1);
});
test('local Market includes only listed own packs with the same ID and decoration',()=>{
  const f=fixture();f.pack.listed=true;f.pack.layout={comp:'corner'};f.pack.deco='clip';f.pack.cover='flower';
  f.context.S.packs.push({...f.pack,id:'stored',listed:false},{...f.pack,id:'friend',own:false});
  const visible=f.context.PackListing.visible();assert.deepEqual(Array.from(visible,p=>p.id),['own-id']);assert.equal(visible[0].local,true);assert.equal(visible[0].layout,f.pack.layout);assert.equal(visible[0].cover,'flower');assert.equal(visible[0].deco,'clip');
  let displayed;f.context.Pages.packs.shelf=p=>{displayed=p;return h('div.shelf');};const section=f.context.Pages.market.localPacks();assert.equal(displayed[0].id,'own-id');assert.match(text(section),/On this Mac/);
  f.pack.listed=false;assert.equal(f.context.Pages.market.localPacks(),null);
});
test('local Market cards reuse the own-pack card and never offer purchases or opening',async()=>{
  const f=fixture();f.pack.listed=true;const local=f.context.PackListing.visible()[0];
  f.context.Market.buyBox=()=>{throw Error('buy path');};f.context.Market.exchange=()=>{throw Error('exchange path');};
  const card=f.context.Market.card(local),buttons=nodes(card).filter(n=>n.tag.startsWith('button')).map(text);
  assert.ok(buttons.includes('Take down from Market'));assert.ok(buttons.includes('Save file…'));assert.ok(!buttons.some(t=>/Open|Buy|Get|Exchange/.test(t)));
  await f.context.Market.get(local);assert.equal(f.calls.length,0);
  assert.equal(f.context.PackListing.control({...local,own:false}),null);assert.equal(f.context.PackListing.control({...local,listed:false,canList:false}),null);
});
