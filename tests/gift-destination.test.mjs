import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync(new URL('../src/app/js/studio.js',import.meta.url),'utf8');
class Element {
  constructor(tag,props,kids){this.tag=tag;this.value='';Object.assign(this,props);this.children=kids.flat(Infinity).filter(v=>v!=null&&v!==false);}
  append(...kids){this.children.push(...kids);} setAttribute(key,value){this[key]=value;}
}
const h=(tag,...args)=>new Element(tag,args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{},args);
const nodes=el=>el instanceof Element?[el,...el.children.flatMap(nodes)]:Array.isArray(el)?el.flatMap(nodes):[];
const text=el=>el instanceof Element?(el.textContent||el.children.map(text).join('')):Array.isArray(el)?el.map(text).join(''):String(el??'');
function fixture({enabled=true,friends=[{publicKey:'friend-key',name:'Nao',status:'friend'}],draft,name='Maker'}={}) {
  const S={name,lib:[{id:'sticker',lineage:'real'}],inbox:{enabled,friends},packLimits:{copiesPerDesign:4,prizes:8,packSlots:64}},calls=[];let saved;
  const ctx=vm.createContext({S,h,Map,Set,Friends:{groups:()=>({friends:S.inbox.friends.filter(f=>f.status==='friend')})},PetaFp:()=> 'fingerprint',Snd:{tap(){}},paint(){},paintBench(){},ProfileName:{request:()=>calls.push('name')},Shell:{open:async page=>calls.push(page),toast:message=>calls.push(message)},document:{querySelector:()=>({scrollIntoView(){calls.push('scroll');}})},localStorage:{getItem:()=>draft?JSON.stringify({gift:draft}):null,setItem:(_k,value)=>saved=JSON.parse(value)},PACK_BAG_IDS:['kraft'],GIFT_BAG_IDS:['airmail'],BAGS:{airmail:{name:'Air Mail'}},heading:(label)=>h('h2',label),bagPicker:()=>h('div','Wrapping choices'),foot:(_back,button,note)=>h('footer',button,note),tagNote:()=>null,doneBlock:()=>h('div','Done'),seal:()=>calls.push('seal')});
  vm.runInContext(js.slice(0,js.indexOf('Pages.studio ='))+';this.ST=ST;',ctx);
  vm.runInContext('ST.mode="gift";ST.gift.step=2;ST.gift.sticker="sticker";const D=()=>ST.gift;',ctx);
  vm.runInContext(js.slice(js.indexOf('    const canGo ='),js.indexOf('    const VIEWS =')),ctx);
  vm.runInContext(js.slice(js.indexOf('    const stNext ='),js.indexOf('    const bagPicker =')),ctx);
  vm.runInContext(js.slice(js.indexOf('    const sealButton ='),js.indexOf('    const packSeal =')),ctx);
  vm.runInContext(js.slice(js.indexOf('    const giftDress ='),js.indexOf('    const doneBlock ='))+';this.dress=giftDress;this.confirm=giftSeal;',ctx);
  return {S,ctx,calls,get gift(){return ctx.ST.gift;},get saved(){return saved;},dress:()=>ctx.dress(),confirm:()=>ctx.confirm(),load:()=>vm.runInContext('stLoad()',ctx),save:()=>vm.runInContext('stSave()',ctx)};
}
const choice=(body,label)=>nodes(body).find(n=>n.tag==='button.fr-pill'&&text(n).startsWith(label));
const input=body=>nodes(body).find(n=>n.tag==='input'&&n['aria-label']==='Name on the envelope');
const next=body=>nodes(body).find(n=>n.tag==='button.btn'&&text(n)==='Next →');
test('choosing an accepted friend fills the actual recipient and envelope, and step 3 only confirms',()=>{
  const f=fixture(),body=f.dress();choice(body,'Nao').on.click();assert.equal(f.gift.dest,'friend');assert.equal(f.gift.friend,'friend-key');assert.equal(f.gift.to,'Nao');
  assert.equal(input(f.dress()),undefined);assert.equal(next(f.dress()).disabled,false);
  const confirm=f.confirm();assert.match(text(confirm),/For Nao · to their Peta/);assert.match(text(confirm),/Seal and send/);assert.equal(nodes(confirm).some(n=>n.tag==='button.fr-pill'||n.tag==='input'),false);
  assert.equal(f.saved.gift.dest,'friend');assert.equal(f.saved.gift.friend,'friend-key');
});
test('only Someone else shows a name field and it must be filled before proceeding',()=>{
  const f=fixture();choice(f.dress(),'Nao').on.click();choice(f.dress(),'Someone else').on.click();assert.equal(f.gift.dest,'file');assert.equal(f.gift.friend,null);
  const body=f.dress(),name=input(body);assert.ok(name);name.on.input({target:{value:' '}});assert.equal(next(body).disabled,true);assert.match(text(body),/Choose who it is for to continue/);
  const target={value:'あ'.repeat(20)};name.on.input({target});assert.equal(target.value.length,14);assert.equal(next(body).disabled,false);
  assert.match(text(f.confirm()),/saved as a file/);assert.match(text(f.confirm()),/Seal and save/);
});
test('without friends the Settings link works and only a file destination is offered',async()=>{
  const f=fixture({friends:[]}),body=f.dress();assert.match(text(body),/No friends yet\. Add one in Settings → Friends\./);assert.equal(nodes(body).filter(n=>n.tag==='button.fr-pill').length,1);
  await nodes(body).find(n=>n.tag==='button.link').on.click();assert.deepEqual(f.calls,['settings','scroll']);
});
test('the offline build has only the envelope name field',()=>{
  const f=fixture({enabled:false}),body=f.dress();assert.match(text(body),/Name on the envelope/);assert.doesNotMatch(text(body),/To \(required\)|Someone else|No friends/);assert.ok(input(body));assert.equal(nodes(body).filter(n=>n.tag==='button.fr-pill').length,0);
});
test('old drafts open as file gifts; removed or blocked friends lose their selection',()=>{
  const old=fixture({draft:{sticker:'sticker',bag:'airmail',to:'Nao',note:'Hello'}});old.load();assert.equal(old.gift.dest,'file');assert.equal(old.gift.friend,null);assert.equal(old.gift.to,'Nao');assert.equal(next(old.dress()).disabled,false);
  for(const friends of [[],[{publicKey:'friend-key',name:'Nao',status:'blocked'}]]) {
    const f=fixture({friends,draft:{sticker:'sticker',dest:'friend',friend:'friend-key',to:'Nao'}});f.load();assert.equal(f.gift.friend,null);assert.equal(f.gift.to,'');assert.equal(next(f.dress()).disabled,true);assert.equal(choice(f.dress(),'Someone else')['aria-pressed'],'false');
  }
  const f=fixture({draft:{sticker:'sticker',dest:'friend',friend:'friend-key',to:'old name'}});f.load();assert.equal(f.gift.to,'Nao');
  f.S.inbox.friends=[];assert.equal(next(f.dress()).disabled,true);assert.equal(f.gift.friend,null);
});
test('before leaving step 2, an unnamed sender is guided to Settings without sealing',()=>{
  const f=fixture({name:''});choice(f.dress(),'Nao').on.click();next(f.dress()).on.click();assert.deepEqual(f.calls,['name']);assert.equal(f.gift.step,2);assert.equal(f.ctx.ST.sealing,false);
  f.S.name='Maker';next(f.dress()).on.click();assert.equal(f.gift.step,3);
});
