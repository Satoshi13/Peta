import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as PetaMath from '../src/ui-math.js';
const read=name=>readFileSync(new URL('../src/app/js/'+name+'.js',import.meta.url),'utf8');
function fixture(){
  const h=(tag,...args)=>{
    const props=args[0]&&typeof args[0]==='object'&&!args[0].tag&&!Array.isArray(args[0])?args.shift():{};
    const style={...props.style,setProperty(k,v){this[k]=v;}};
    return {tag,...props,dataset:props.data || {},style,children:args.flat().filter(Boolean),append(...children){this.children.push(...children);}};
  };
  const ctx=vm.createContext({h,PetaMath,A:new Proxy({},{get:()=>''})});
  vm.runInContext(read('catalog')+';this.palette=PACK_COLORS;this.picker=PACK_BAG_IDS;this.compat=PACK_BAG_COMPAT_IDS;this.color=packColor;this.filter=packColorFilter;',ctx);
  return ctx;
}
const nodes=el=>[el,...(el.children || []).filter(x=>typeof x==='object').flatMap(nodes)];
test('new packs offer four paper wrappings while all eight legacy wrappings remain readable',()=>{
  const f=fixture();assert.deepEqual(Array.from(f.picker),['kraft','matte','holo','glassine']);assert.equal(f.compat.length,8);
  for(const bag of f.picker)assert.ok(f.compat.includes(bag));
});
test('the finite palette accepts colors only for Matte/Holo and safely defaults unknown values',()=>{
  const f=fixture();
  for(const bag of ['matte','holo']){
    assert.deepEqual(Array.from(f.palette[bag],c=>c.id),[null,'rose','mint','blue','lavender']);
    for(const c of f.palette[bag]){assert.equal(f.color(bag,c.id).id,c.id);assert.equal(f.filter(bag,c.id)==='none',!c.id);}
    assert.equal(f.color(bag,'url(evil)').id,null);
  }
  for(const bag of ['kraft','glassine','cotton','drawer','pocket','missing'])assert.equal(f.filter(bag,'mint'),'none');
});
test('body tint and the original paper label are separate from text, cover stickers and accents',()=>{
  const f=fixture();vm.runInContext(read('bagpic')+';this.render=BagPic;',f);
  const bag=f.render({bag:'matte',color:'mint',title:'Paper stories',cover:'sticker.png',deco:'clip'}),all=nodes(bag);
  assert.notEqual(all.find(n=>n.tag==='div.bp-art').style.filter,'none');
  assert.ok(all.some(n=>n.tag==='i.pack-paper-label'));
  for(const n of all.filter(n=>n.tag==='div.bp-lbl'||n.tag?.startsWith('div.bp-deco')))assert.equal(n.style.filter,undefined);
  assert.equal(nodes(f.render({bag:'matte',color:null})).some(n=>n.tag==='i.pack-paper-label'),false);
});
test('draft reload keeps a chosen color and a legacy bag, normalizing incompatible colors',()=>{
  const f=fixture();let saved;
  f.localStorage={setItem:(_key,value)=>saved=value,getItem:()=>saved};f.S={lib:[],packLimits:{prizes:10,packSlots:200}};
  const studio=read('studio');vm.runInContext(studio.slice(0,studio.indexOf('/** Dress step:')),f);
  const run=code=>vm.runInContext(code,f);
  run("ST.pack.bag='holo';ST.pack.color='blue';stSave();ST.pack.color=null;stLoad()");assert.equal(run('ST.pack.color'),'blue');
  run("ST.pack.bag='drawer';ST.pack.color='mint';stSave();ST.pack.bag='kraft';stLoad()");assert.equal(run('ST.pack.bag'),'drawer');assert.equal(run('ST.pack.color'),null);
});
