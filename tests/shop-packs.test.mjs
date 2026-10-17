import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=name=>fs.readFileSync(new URL(`../src/app/js/${name}.js`,import.meta.url),'utf8');
class Element {
  constructor(tag,props,children){this.tag=tag;Object.assign(this,props);this.children=children.flat(Infinity).filter(x=>x!=null);this.classList={add(){}};this.style={setProperty(){}};this.dataset={};}
  append(...children){this.children.push(...children.flat(Infinity));}
  replaceChildren(...children){this.children=children.filter(x=>x!=null);}
  addEventListener(){}
}
function h(tag,...args){const props=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{};return new Element(tag,props,args);}
const nodes=el=>el instanceof Element?[el,...el.children.flatMap(nodes)]:[];
// What scrap_status lists for an official pack that arrived after the app shipped (peta-core shop_pack::Live).
const autumn=(over={})=>({id:'shop:autumn',packId:'autumn',version:2,title:'Autumn Walk',by:'Peta',blurb:'Leaves on the way home.',pouch:'glassine',color:null,price:12,
  items:[{key:'chestnut',name:'Chestnut',rarity:'rare'},{key:'maple',name:'Maple Leaf',rarity:'common'},{key:'acorn',name:'Acorn',rarity:'uncommon'},{key:'pine',name:'Pine',rarity:'common'}],...over});
function fixture({shopPacks=[autumn()],shop=null,owned={},builtinPacks=true}={}){
  const calls=[];
  const packs=[['tokyo',16,8],['coffee',12,6],['plants',10,5],['pixel',12,6],['cats',10,5],['night',12,6],...shopPacks.map(p=>[p.id,p.price,p.items.length])].map(([id,exchange,stickers])=>({id,exchange,stickers,onSale:true}));
  const S={page:'market',developer:false,owned,packs:[],scraps:{balance:100,packs,shop,shopPacks,builtinPacks}};
  const bag={body:[0,0,100,100],cm:9};const BAGS={kraft:bag,matte:bag,holo:bag,glassine:bag};
  const context=vm.createContext({h,Pages:{},S,BAGS,isPouch:id=>['kraft','matte','holo'].includes(id),packColor:(bag,color)=>color&&bag!=='kraft'?{id:color}:null,PACK_SEALED_CAP:100,
    Shell:{toast(){},go(){}},Snd:{tap(){}},CloseButton:()=>h('button.close'),PackPeek:keys=>h('figure.peek',{keys}),ScrapAmt:n=>`${n} Scraps`,packVar:k=>k,PackLabel:p=>h('span.label',p.title),BagPic:o=>h('div.bagpic',{bag:o.bag,color:o.color}),
    Scraps:{pack:id=>S.scraps.packs.find(p=>p.id===id),button:(kind,id,label,disabled)=>h('button.scrap',{disabled},label),badge:()=>h('span'),form:()=>null},
    Stk:{make:()=>new Promise(()=>{})},A:{},Cer:{},URL:{createObjectURL:b=>'blob:'+b.size},Blob:class{constructor(parts){this.size=parts[0].length;}},
    Bridge:{invoke:async(cmd,args)=>{calls.push([cmd,args]);if(cmd==='shop_pack_picture')return [1,2,3];return cmd==='market_friend_listings'?{enabled:false}:{};}}});
  vm.runInContext(source('packs')+';this.PackArt=PackArt;this.PackListing=PackListing;this.PackZoom=PackZoom;PackListing.visible=()=>[];',context);
  vm.runInContext(source('market')+';this.Market=Market;this.Featured=Featured;this.ShopPacks=ShopPacks;',context);
  context.Pages.market.rail=cells=>h('div.mk-rail',cells);
  return {c:context,calls};
}

test('a shop pack on sale joins the official packs after the built-in ones, or where the shop setting puts it', ()=>{
  let {c}=fixture();
  assert.deepEqual([...c.Market.official().map(p=>p.id)],['tokyo','coffee','pixel','cats','plants','night','shop:autumn']);
  const p=c.Market.official().at(-1);
  assert.equal(p.title,'Autumn Walk');assert.equal(p.count,4);assert.equal(p.price,'Scraps');assert.equal(p.bag,'glassine');assert.equal(p.kind,'kraft');
  assert.equal(c.Market.price(p),'12 Scraps');
  ({c}=fixture({shop:{featured:['shop:autumn'],officialFirst:true,order:['shop:autumn','tokyo'],blurbs:{'shop:autumn':'A quiet walk.'}}}));
  const listed=c.Market.official();
  assert.deepEqual([...listed.slice(0,2).map(p=>p.id)],['shop:autumn','tokyo']);assert.equal(listed[0].blurb,'A quiet walk.');
  assert.equal(c.Featured.pick(listed,()=>0).pack.id,'shop:autumn','the owner can feature it');
  ({c}=fixture({shopPacks:[]}));
  assert.equal(c.Market.official().length,6,'nothing extra once it leaves the shop');
});

test('its pictures come from the stored art, the most common first, fetched once and given the border here', async()=>{
  const {c,calls}=fixture();
  const keys=c.Market.official().at(-1).keys;
  assert.deepEqual([...keys.map(k=>k.name)],['Maple Leaf','Pine','Acorn','Chestnut']);
  assert.ok(keys.every(k=>k.raw&&!k.src));
  assert.equal(await keys[0].load(),'blob:3');await keys[0].load();await c.Market.official().at(-1).keys[0].load();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([cmd])=>cmd==='shop_pack_picture'))),[['shop_pack_picture',{packId:'shop:autumn',key:'maple'}]]);
});

test('a glassine or coloured shop pack hangs in its own wrapping; a plain pouch stays a pouch', ()=>{
  let {c}=fixture();
  const glassine=c.Market.pouch(c.Market.official().at(-1));
  assert.equal(nodes(glassine).find(n=>n.tag==='div.bagpic').bag,'glassine');
  ({c}=fixture({shopPacks:[autumn({pouch:'matte',color:'rose'})]}));
  assert.equal(nodes(c.Market.pouch(c.Market.official().at(-1))).find(n=>n.tag==='div.bagpic').color,'rose');
  ({c}=fixture({shopPacks:[autumn({pouch:'holo'})]}));
  const plain=c.Market.pouch(c.Market.official().at(-1));
  assert.ok(nodes(plain).some(n=>n.tag.startsWith('i.pk-img')));assert.ok(!nodes(plain).some(n=>n.tag==='div.bagpic'));
  assert.ok(c.PackArt.decorated({bag:'glassine',shop:true}),'on the shelf too');assert.ok(!c.PackArt.decorated({bag:'holo',shop:true}));
});

test('the card shows its pictures and the exchange, never the free button', ()=>{
  const {c}=fixture();
  const card=c.Market.card(c.Market.official().at(-1));
  assert.equal(nodes(card).find(n=>n.tag==='figure.peek').keys.length,4);
  assert.ok(!nodes(card).some(n=>n.tag==='button.btn.mkz-act'),'no "Get — Free"');
});

 test('online Market hides every built-in even when named by settings, while offline keeps all six',()=>{
 const {c}=fixture({builtinPacks:false,shop:{featured:['tokyo','cats'],order:['coffee','shop:autumn']}});
 assert.deepEqual([...c.Market.official().map(p=>p.id)],['shop:autumn']);
 assert.equal(c.Featured.pick(c.Market.official()),null);
 const empty=fixture({builtinPacks:false,shopPacks:[]}).c;
 assert.equal(empty.Market.official().length,0);assert.equal(empty.Featured.pick([]),null);
 assert.ok(nodes(empty.Pages.market.packs(()=>{})).some(n=>n.children.includes('New packs are on their way.')));
 assert.equal(fixture({shopPacks:[]}).c.Market.official().length,6);
 });

test('free signed packs stay free after ownership and become received only after the stable claim',()=>{
 const {c}=fixture({owned:{'shop:autumn':true},shopPacks:[autumn({free:true,price:0,freeClaimed:false})]});
 const p=c.Market.official().at(-1);assert.equal(c.Market.price(p),'Free');
 let button=nodes(c.Market.card(p)).find(n=>n.tag==='button.btn.mkz-act');assert.equal(button.disabled,false);
 p.freeClaimed=true;assert.equal(c.Market.price(p),'Received');
 button=nodes(c.Market.card(p)).find(n=>n.tag==='button.btn.mkz-act');assert.equal(button.disabled,true);assert.equal(button.textContent,'Received');
});
