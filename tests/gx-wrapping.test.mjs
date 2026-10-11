import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=p=>readFileSync(new URL('../src/app/js/'+p,import.meta.url),'utf8');
const source=read('gx.js');
function fixture() {
  const rendered=[];
  const h=(selector,props,...children)=>{
    if(props?.selector){children.unshift(props);props={};}
    const classes=new Set(selector.split('.').slice(1));
    const el={selector,props:props||{},style:{...(props?.style||{}),setProperty(){}},children:children.filter(Boolean),classList:{add:c=>classes.add(c),contains:c=>classes.has(c)},append(...nodes){this.children.push(...nodes);},querySelector(){return {remove(){}};},cloneNode(){return h(selector,props,...this.children);},addEventListener(){},removeEventListener(){},setAttribute(name,value){this.props[name]=value;}};
    return el;
  };
  const context=vm.createContext({h,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),lerp:(a,b,t)=>a+(b-a)*t,rng:()=>()=>.5,PACK_KINDS:{kraft:{foil:false},matte:{foil:false},holo:{foil:true}},packVar:id=>id,PackLabel:()=>h('label.original'),PackArt:{decorated:p=>p.signed},BagPic:args=>{rendered.push(args);return h('div.bagpic');},run:{later(){}},host:h('div.host'),A:new Proxy({},{get:()=>''})});
  vm.runInContext(read('catalog.js'),context);
  vm.runInContext(source.split('\n').find(line=>line.includes('const smooth =')),context);
  vm.runInContext(source.slice(source.indexOf('  const PK ='),source.indexOf('  /** The light in the tear:')),context);
  return {rendered,context,render:pack=>{context.pack=pack;return vm.runInContext("pouch(run,host,pack,{pw:250,x:480,y:330,cover:'cover.png'})",context);}};
}
test('the batch opening draws the stored cover and accents on all classic tear layers',()=>{
  const f=fixture();for(const bag of ['kraft','matte','holo']) {
    const layout={comp:'corner',cover:[70,80],accents:[{kind:'seal',x:50,y:15}]};const rig=f.render({id:bag,bag,kind:bag,signed:true,title:'Autumn',by:'Maker',layout});
    for(const layer of [rig.body,rig.topL,rig.topR]) assert.equal(layer.children.some(n=>n.classList?.contains('pk-dress')||n.selector==='div.bagpic'),true);
    assert.equal(rig.pouch.children.some(n=>n.selector==='label.original'),false);
    assert.equal(f.rendered.at(-1).layout,layout);assert.equal(f.rendered.at(-1).cover,'cover.png');assert.equal(f.rendered.at(-1).bag,bag);
  }
});
test('all five other wrappings retain their own picture and use opening rather than a foil tear',()=>{
  const f=fixture();const ids=vm.runInContext('PACK_BAG_IDS.filter(id=>BAGS[id].gen)',f.context);assert.equal(ids.length,5);
  for(const bag of ids) {const rig=f.render({id:bag,bag,kind:'kraft',signed:true,title:'Autumn',by:'Maker'});assert.equal(rig.generic,true);assert.ok(rig.PW>0&&rig.PH<=330.001);assert.equal(f.rendered.at(-1).bag,bag);assert.equal(f.rendered.at(-1).cover,'cover.png');assert.equal(rig.pouch.children[0].selector,'div.bagpic');}
});
test('a bag gesture opens once even when click, drag and keyboard overlap',async()=>{
  let gesture,activate,animations=0;const context=vm.createContext({step:(_run,fn)=>({done(){},go:fn}),dragIn:(_run,_el,options)=>gesture=options,activate:(_run,_el,fn)=>activate=fn,Sfx:{crinkleTick(){}},Hap:{fire(){}},EASE:{out:'ease'},run:{anim:async()=>{animations++;}},rig:{pouch:{setAttribute(){}}},kit:{say(){},showSkip(){}}});
  vm.runInContext(source.slice(source.indexOf('  function openBagGesture('),source.indexOf('  function tearGesture(')),context);
  const opened=vm.runInContext('openBagGesture(run,rig,kit)',context);gesture.up({},false);gesture.move(30,0);activate();await opened;assert.equal(animations,1);
});
