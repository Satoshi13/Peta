import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
  constructor(tag,props,children){this.tag=tag;this.isConnected=true;Object.assign(this,props);this.children=children.flat(Infinity).filter(v=>v!=null);}
  append(...children){this.children.push(...children);} addEventListener(){}
}
const h=(tag,...args)=>new Element(tag,args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{},args);
const nodes=el=>el instanceof Element?[el,...el.children.flatMap(nodes)]:[];
const text=el=>el instanceof Element?el.children.map(text).join(''):String(el??'');
const js=fs.readFileSync(new URL('../src/app/js/settings.js',import.meta.url),'utf8');
async function fixture(links){
  const calls=[],context=vm.createContext({h,queueMicrotask,UpdateUI:{card:()=>h("div.update-controls")},A:{},Bridge:{invoke:async(cmd,args)=>{calls.push({cmd,args});return links;}},Shell:{toast(){}}});
  vm.runInContext(js.slice(js.indexOf('const AboutPeta ='),js.indexOf('const ProfileName ='))+';this.card=AboutPeta.card();',context);
  await new Promise(resolve=>setImmediate(resolve));return {card:context.card,calls};
}
test('unset legal URLs leave their About controls hidden',async()=>{
  const f=await fixture([]);assert.equal(nodes(f.card).find(n=>n.tag==='div.row-btns').hidden,true);assert.doesNotMatch(text(f.card),/Terms of use|Privacy policy/);
});
test('configured About documents open by known ID, without passing an arbitrary URL',async()=>{
  const f=await fixture([{id:'terms',label:'Terms of use'},{id:'privacy',label:'Privacy policy'}]);assert.equal(nodes(f.card).find(n=>n.tag==='div.row-btns').hidden,false);
  await nodes(f.card).find(n=>n.tag==='button.btn.paper.small'&&text(n)==='Terms of use').on.click();assert.equal(f.calls[1].cmd,'about_open_link');assert.equal(JSON.stringify(f.calls[1].args),'{"id":"terms"}');
});
