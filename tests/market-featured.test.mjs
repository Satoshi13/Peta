import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=name=>fs.readFileSync(new URL(`../src/app/js/${name}.js`,import.meta.url),'utf8');
class Element {
  constructor(tag,props,children){this.tag=tag;Object.assign(this,props);this.children=children.flat(Infinity).filter(x=>x!=null);this.classList={add(){}};this.style={setProperty(){}};}
  append(...children){this.children.push(...children.flat(Infinity));}
  replaceChildren(...children){this.children=children.filter(x=>x!=null);}
  addEventListener(){}
}
function h(tag,...args){const props=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{};return new Element(tag,props,args);}
const nodes=el=>el instanceof Element?[el,...el.children.flatMap(nodes)]:[];
const text=el=>el instanceof Element?el.children.map(text).join(''):String(el??'');
const card={title:'Night Walk',blurb:'Lanterns.',pouch:'kraft',designs:[],prizes:[],peek:[{name:'Moon',png:'AAAA'}]};
const listing=(over={})=>({listingId:'L1',sellerKey:'k-nao',sellerName:'Nao',price:6,state:'open',slotCount:6,slotsLeft:4,card,...over});
const RATES=[['tokyo',16,8],['coffee',12,6],['plants',10,5],['pixel',12,6],['cats',10,5],['night',12,6]];
function fixture({listings=[],mine=[],shop=null,rates={},sealed={},enabled=true,offline=false}={}){
  const packs=RATES.map(([id,exchange,stickers])=>({id,exchange,stickers,onSale:true,...rates[id]}));
  const S={page:'market',developer:false,owned:{},packs:Object.entries(sealed).map(([id,n])=>({id,left:Array(n).fill(0)})),scraps:{balance:100,packs,shop}};
  const market={enabled,offline,hasFriends:true,listings,mine};
  const context=vm.createContext({h,Pages:{},S,PACK_SEALED_CAP:100,Shell:{toast(){},go(){}},Snd:{tap(){}},CloseButton:()=>h('button.close'),PackPeek:()=>h('figure'),ScrapAmt:n=>`${n} Scraps`,packVar:()=>'',PackLabel:p=>h('span.label',p.title),
    Scraps:{pack:id=>S.scraps.packs.find(p=>p.id===id),button:(kind,id,label,disabled)=>h('button.scrap',{disabled},label),badge:()=>h('span'),form:()=>null},
    Stk:{make:()=>new Promise(()=>{})},A:{},Cer:{},Bridge:{invoke:async cmd=>cmd==='market_friend_listings'?market:{}}});
  vm.runInContext(source('packs')+';this.PackListing=PackListing;this.PackZoom=PackZoom;PackListing.visible=()=>[];',context);
  vm.runInContext(source('market')+';this.Market=Market;this.FriendShop=FriendShop;this.Featured=Featured;this.MARKET_PACKS=MARKET_PACKS;',context);
  context.Pages.market.rail=cells=>h('div.mk-rail',cells);
  return context;
}
const ready=async c=>{await c.FriendShop.load();return c;};
const pick=(c,r=0)=>{const f=c.Featured.pick(c.Market.official(),()=>r);return f&&{kind:f.kind,id:f.kind==='friend'?f.listing.listingId:f.pack.id};};

test('a friend pack this Mac can pull comes first, at random, and stays while Market is open', async()=>{
  const c=await ready(fixture({listings:[listing(),listing({listingId:'L2',sellerName:'Ren'})]}));
  assert.deepEqual(pick(c,.9),{kind:'friend',id:'L2'});
  assert.deepEqual(pick(c,0),{kind:'friend',id:'L2'},'kept while the page stays open');
  c.Featured.reset();assert.deepEqual(pick(c,0),{kind:'friend',id:'L1'},'chosen again when Market opens');
  const hero=c.Pages.market.packs(()=>{}).children[0].children[0];
  assert.equal(hero.tag,'section.mk-hero.mk-hero-friend');
  assert.match(text(hero),/From a friend/);assert.match(text(hero),/Night Walk/);assert.match(text(hero),/by Nao/);
  assert.equal(nodes(hero).find(n=>n.tag==='img').src,'data:image/png;base64,AAAA');
});
test('own, sold out, paused, unopened, unknown-seller and offline listings never lead', async()=>{
  const bad=[listing({listingId:'MINE'}),listing({listingId:'L2',slotsLeft:0}),listing({listingId:'L3',state:'paused'}),listing({listingId:'L4',card:null}),listing({listingId:'L5',sellerName:''}),listing({listingId:'L6',blocked:true})];
  let c=await ready(fixture({listings:bad,mine:[{listingId:'MINE',packId:'p'}]}));
  assert.deepEqual(pick(c),{kind:'official',id:'tokyo'},'without a shop setting: the first built-in pack');
  c=await ready(fixture({listings:[listing()],offline:true}));assert.equal(pick(c).kind,'official');
  c=await ready(fixture({listings:[listing()],enabled:false}));assert.equal(pick(c).kind,'official','builds without the server');
});
test('the owner picks featured official packs, skipping off-sale or full ones, and Official first wins over friends', async()=>{
  let c=await ready(fixture({shop:{featured:['pixel','cats'],officialFirst:false,order:[],blurbs:{}}}));
  assert.deepEqual(pick(c,0),{kind:'official',id:'pixel'});c.Featured.reset();assert.deepEqual(pick(c,.99),{kind:'official',id:'cats'});
  c=await ready(fixture({shop:{featured:['pixel','cats'],officialFirst:false,order:[],blurbs:{}},rates:{cats:{onSale:false}},sealed:{pixel:96}}));
  assert.equal(pick(c),null,'cats is off sale and another pixel set would overfill the bag');
  assert.equal(c.Pages.market.packs(()=>{}).children[0].children[0]?.tag==='section.mk-hero',false,'no hero at all');
  c=await ready(fixture({listings:[listing()],shop:{featured:['night'],officialFirst:true,order:[],blurbs:{}}}));
  assert.deepEqual(pick(c),{kind:'official',id:'night'});
  c=await ready(fixture({listings:[listing()],shop:{featured:['night'],officialFirst:true,order:[],blurbs:{}},rates:{night:{onSale:false}}}));
  assert.deepEqual(pick(c),{kind:'friend',id:'L1'},'with no official pack to show, a friend pack still leads');
});
test('nothing to feature means no hero; the rail follows the owner order, lines and sales', async()=>{
  const c=await ready(fixture({shop:{featured:['tokyo'],officialFirst:false,order:['night','cats'],blurbs:{cats:'Asleep, mostly.'}},rates:{tokyo:{onSale:false},coffee:{onSale:false}}}));
  const page=c.Pages.market.packs(()=>{}),main=page.children[0];
  assert.equal(nodes(main).some(n=>n.tag?.startsWith('section.mk-hero')),false);
  const rail=nodes(main).find(n=>n.tag==='div.mk-rail');
  assert.deepEqual(nodes(rail).filter(n=>n.tag==='button.mk-tile').map(n=>n.data.pack),['night','cats','pixel','plants'],'owner order, then the rest; off-sale packs leave the rail');
  assert.equal(c.Market.official().find(p=>p.id==='cats').blurb,'Asleep, mostly.');
  assert.equal(c.Market.price(c.MARKET_PACKS.find(p=>p.id==='coffee')),'Not on sale');
  assert.equal(c.Market.limit(c.MARKET_PACKS.find(p=>p.id==='coffee')).max,0);
});
test('the price the Market shows is the rate the native side charges', async()=>{
  const c=await ready(fixture({rates:{pixel:{exchange:20}}}));
  const pixel=c.MARKET_PACKS.find(p=>p.id==='pixel');
  assert.equal(c.Market.price(pixel),'20 Scraps');assert.equal(c.Market.unit(pixel),20);
  assert.equal(c.Market.limit(pixel).max,5,'100 Scraps buy five sets at 20');
});
