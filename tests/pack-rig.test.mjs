import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// The desk's pouch and wrapping rigs (ceremony.js buildRig / buildBagRig), run without a page: what each layer carries, and that opening happens once.
const read=p=>readFileSync(new URL('../src/app/js/'+p,import.meta.url),'utf8');
const source=read('ceremony.js');
function fixture() {
  const rendered=[],torn=[];let gesture=null;
  const h=(selector,props,...children)=>{
    if(props?.selector||props===null){if(props)children.unshift(props);props={};}
    const classes=new Set(selector.split('.').slice(1)),handlers=new Map();
    const el={selector,props:props||{},style:{...(props?.style||{}),setProperty(k,v){this[k]=v;}},children:children.flat().filter(Boolean),
      classList:{add:c=>classes.add(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)},
      append(...nodes){this.children.push(...nodes);},prepend(...nodes){this.children.unshift(...nodes);},querySelector(){return {remove(){}};},
      cloneNode(){return h(selector,props,...this.children);},addEventListener:(type,fn)=>handlers.set(type,fn),fire:(type,e)=>handlers.get(type)?.(e),
      setAttribute(name,value){this.props[name]=value;},focus(){},getBoundingClientRect:()=>({left:0,top:0,width:200,height:260}),animate:()=>({finished:Promise.resolve()})};
    return el;
  };
  const stage=h('div.cer-stage');Object.assign(stage,{clientWidth:760,clientHeight:520});
  const cer={stage,root:h('div.cer'),hint(){},wait:()=>Promise.resolve(),skipped:false};
  const context=vm.createContext({h,img:()=>h('img'),$:()=>null,$$:()=>[],A:new Proxy({},{get:()=>''}),clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),lerp:(a,b,t)=>a+(b-a)*t,rand:()=>.5,
    reduced:()=>false,anim:async()=>({}),fix(){},sleep:async()=>{},EASE:{out:'ease',inOut:'ease',spring:'ease'},packVar:k=>'var(--a-'+k+')',PackPaper:()=>null,
    BagPic:args=>{rendered.push(args);const pic=h('div.bagpic');pic.animate=()=>({finished:Promise.resolve()});return pic;},
    Snd:{crinkle(){},land(){},swoosh(){},grain(){},rip(){},paperMotion:()=>()=>{}},Haptic:{tap(){}},onPointerFollow(){},
    drag:(_el,options)=>{gesture=options;},performance:{now:()=>0},requestAnimationFrame(){},MAT:{},cer,stage});
  vm.runInContext(read('catalog.js'),context);
  vm.runInContext(source.slice(source.indexOf('  const DESK = {'),source.indexOf('  /* What is inside a pack:')),context);
  vm.runInContext('frames=()=>{};deskFor=()=>({lamp(){},flecks(){},bloom(){},tilt:{}});',context);
  const layers=rig=>rig.pouch.children.filter(n=>n.classList?.contains('pk-layer'));
  return {rendered,context,layers,get gesture(){return gesture;},
    pouch:(pack,decoration=null)=>{context.pack=pack;context.decoration=decoration;return vm.runInContext("buildRig(cer,stage,{kind:pack.kind,hue:pack.hue,color:pack.color,content:h('div.pk-sheet-slot'),label:null,decoration,onTear:()=>{}})",context);},
    bag:(pack,onTear)=>{context.pack=pack;context.onTear=onTear;return vm.runInContext("buildBagRig(cer,stage,{pack,content:h('div.pk-sheet-slot'),cover:'cover.png',onTear})",context);}};
}

test('a decorated pouch shows its cover and accents on both the body and the part of the top still attached',()=>{
  const f=fixture();
  for(const kind of ['kraft','matte','holo']) {
    const deco=f.context.h('div.bagpic.pk-dress'),rig=f.pouch({id:kind,kind,title:'Autumn',by:'Maker'},deco);
    const [body,attached]=f.layers(rig);
    assert.ok(body.classList.contains('pk-body')&&attached.classList.contains('pk-attached'));
    for(const layer of [body,attached]) assert.equal(layer.children.some(n=>n.selector==='div.bagpic.pk-dress'),true);
  }
});

test('a coloured pouch keeps its colour on every layer, without tinting what is drawn on it',()=>{
  const f=fixture();
  for(const kind of ['matte','holo']) for(const color of ['rose','mint','blue','lavender']) {
    const rig=f.pouch({id:kind+color,kind,color,hue:120,title:'Paper stories',by:'Maker'});
    for(const layer of f.layers(rig)) {
      assert.equal(layer.classList.contains('pack-colored'),true);assert.equal(layer.classList.contains('tinted'),false);
      assert.notEqual(layer.style['--pack-filter'],'none');assert.equal(layer.style.filter,undefined);
    }
  }
});

test('the other wrappings keep their own picture and open rather than tear',()=>{
  const f=fixture();const ids=vm.runInContext('PACK_BAG_COMPAT_IDS.filter(id=>BAGS[id].gen)',f.context);assert.equal(ids.length,5);
  for(const bag of ids) {
    const rig=f.bag({id:bag,bag,kind:'kraft',signed:true,title:'Autumn',by:'Maker'},()=>{});
    assert.ok(rig.PW>0&&rig.PH>0);assert.equal(f.rendered.at(-1).bag,bag);assert.equal(f.rendered.at(-1).cover,'cover.png');
    assert.equal(rig.pouch.children.some(n=>n.selector==='div.bagpic'),true);
    assert.ok(rig.sheetW>0&&rig.sheetTop+rig.sheetW*1.24<=rig.PH+1e-9,'the sheet stays inside the wrapping');
  }
});

test('a wrapping opens once even when a click, a drag and the keyboard overlap',async()=>{
  const f=fixture();let opened=0;
  const rig=f.bag({id:'airmail',bag:'airmail',kind:'kraft',signed:true,title:'Autumn',by:'Maker'},()=>{opened++;});
  f.gesture.up({},false);f.gesture.move(30,0);rig.pouch.fire('keydown',{key:'Enter'});
  await new Promise(r=>setImmediate(r));assert.equal(opened,1);
});
