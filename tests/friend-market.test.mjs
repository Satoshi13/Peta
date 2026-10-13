import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=name=>fs.readFileSync(new URL(`../src/app/js/${name}.js`,import.meta.url),'utf8');
class Element {
  constructor(tag,props,children){this.tag=tag;Object.assign(this,props);this.children=children.flat(Infinity).filter(x=>x!=null);this.classList={add(){}};}
  append(...children){this.children.push(...children.flat(Infinity));}
  replaceChildren(...children){this.children=children.filter(x=>x!=null);}   // like the DOM: an array argument is not spread
}
function h(tag,...args){const props=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{};return new Element(tag,props,args);}
function nodes(el){return el instanceof Element?[el,...el.children.flatMap(nodes)]:[];}
function text(el){return el instanceof Element?(el.textContent??el.children.map(text).join('')):String(el??'');}
const card={title:'Night Walk',blurb:'Lanterns.',pouch:'kraft',designs:[{name:'Moon',total:2},{name:'Cat',total:3}],prizes:[{name:'Kraft',total:1}],peek:[{name:'Cat',png:'AAAA'}]};
const listing=(over={})=>({listingId:'L1',sellerKey:'k-nao',sellerName:'Nao',externalId:'night',price:6,state:'open',slotCount:6,slotsLeft:4,card,packId:null,...over});
function fixture({market={enabled:true,offline:false,hasFriends:true,listings:[listing()],mine:[],balance:20,price:6},balance=20,developer=false,answer}={}){
  const calls=[],toasts=[],opened=[];let refreshes=0;
  const context=vm.createContext({h,Pages:{},S:{packs:[],page:'market',developer,scraps:{balance}},MK:undefined,
    Shell:{toast:t=>toasts.push(t),refresh:()=>refreshes++,go(){}},Snd:{tap(){}},CloseButton:()=>h('button.close'),PackPeek:items=>h('figure.peek',items.map(i=>h('img',{src:i.src}))),ScrapAmt:n=>`${n} Scraps`,packVar:()=>'',PackLabel:p=>h('span.label',p.title),
    Cer:{openPack:async(pack,o)=>{opened.push({pack,o});return o.pull();}},
    Bridge:{busy:false,reload:async()=>{},invoke:async(cmd,args)=>{calls.push({cmd,args});if(answer)return answer(cmd,args);
      if(cmd==='market_friend_listings')return market;if(cmd==='market_card')return {listing:{...listing(),slotsLeft:3},taken:[1,1,0]};return {};}}});
  vm.runInContext(source('packs')+';this.PackListing=PackListing;this.PackZoom=PackZoom;PackArt.peek=async()=>[];',context);
  vm.runInContext(source('market')+';this.Market=Market;this.FriendShop=FriendShop;',context);
  context.Pages.market.rail=cells=>h('div.mk-rail',cells);
  return {context,calls,toasts,opened,refreshes:()=>refreshes};
}
const loaded=async f=>{await f.context.FriendShop.load();};

test('builds without the server show no friends section', async()=>{
  const f=fixture({market:{enabled:false,listings:[],mine:[],price:6}});await loaded(f);
  assert.equal(f.context.Pages.market.friendPacks(()=>{}),null);
  assert.equal(f.context.PackListing.friendly(),false,'listing stays local to this Mac');
});
test('empty and offline states say what to do', async()=>{
  let f=fixture({market:{enabled:true,hasFriends:false,listings:[],mine:[]}});await loaded(f);
  assert.match(text(f.context.Pages.market.friendPacks(()=>{})),/Add a friend to see the packs they make\./);
  f=fixture({market:{enabled:true,hasFriends:true,listings:[],mine:[]}});await loaded(f);
  assert.match(text(f.context.Pages.market.friendPacks(()=>{})),/haven't put any packs out yet/);
  f=fixture({market:{enabled:true,offline:true,hasFriends:true,listings:[listing()],mine:[]}});await loaded(f);
  assert.match(text(f.context.Pages.market.friendPacks(()=>{})),/Connect to the internet to pull from your friends' packs\./);
});
test('friends get one rail each with the price and what is left', async()=>{
  const f=fixture({market:{enabled:true,hasFriends:true,mine:[],listings:[listing(),listing({listingId:'L2',state:'paused'}),listing({listingId:'L3',sellerKey:'k-ren',sellerName:'Ren',slotsLeft:0}),listing({listingId:'L4',card:null})]}});
  await loaded(f);
  const all=text(f.context.Pages.market.friendPacks(()=>{}));
  assert.match(all,/From Nao/);assert.match(all,/From Ren/);
  assert.match(all,/6 Scraps · 4 of 6 left/);assert.match(all,/Back soon/);assert.match(all,/Sold out/);
  assert.equal((all.match(/6 Scraps ·/g)||[]).length,3,'a listing whose card has not arrived is not shown');
});
test('the friend card fills in what is left and pulls once through the ceremony', async()=>{
  const f=fixture({answer:(cmd,args)=>cmd==='market_card'?{listing:{...listing(),slotsLeft:3},taken:[1,1,0]}:cmd==='market_pull'?{kind:'sticker',remaining:2}:{enabled:true,hasFriends:true,listings:[listing()],mine:[]}});
  await loaded(f);
  const pack=f.context.FriendShop.pack(f.context.FriendShop.data.listings[0]);
  const zoom=f.context.Market.card(pack);await new Promise(r=>setTimeout(r));
  assert.match(text(zoom),/from Nao/);assert.match(text(zoom),/Moon1 of 2 left/);assert.match(text(zoom),/Cat2 of 3 left/);
  assert.ok(!/Maker/.test(text(zoom)));
  const buy=nodes(zoom).find(n=>n.tag==='button.btn.mkz-primary');
  assert.equal(buy.disabled,false);assert.match(text(buy),/Pull one — 6 Scraps/);
  await buy.on.click();
  assert.equal(f.opened.length,1);assert.equal(f.opened[0].pack.listingId,'L1');
  assert.equal(JSON.stringify(f.calls.filter(c=>c.cmd==='market_pull').map(c=>c.args)),JSON.stringify([{listingId:'L1',queue:false}]));
});
test('a pull is refused here before anything is paid when it cannot happen', async()=>{
  for(const [over,balance,why] of [[{state:'paused'},20,/taken down for now/],[{slotsLeft:0},20,/pulled the last one/],[{},5,/need 1 more Scraps/]]){
    const f=fixture({balance,market:{enabled:true,hasFriends:true,listings:[listing(over)],mine:[]},answer:cmd=>cmd==='market_card'?new Promise(()=>{}):{enabled:true,hasFriends:true,listings:[listing(over)],mine:[]}});
    await loaded(f);const pack=f.context.FriendShop.pack(f.context.FriendShop.data.listings[0]);
    const zoom=f.context.Market.card(pack),buy=nodes(zoom).find(n=>n.tag==='button.btn.mkz-primary');
    assert.equal(buy.disabled,true);assert.match(text(zoom),why);
    await f.context.FriendShop.pull(pack);assert.equal(f.opened.length,0);
  }
  const dev=fixture({balance:0,developer:true});await loaded(dev);
  assert.equal(dev.context.FriendShop.why(dev.context.FriendShop.data.listings[0]),'','the developer edition pulls without Scraps');
});
test('my own pack is shown to friends, taken down and stopped only with the native result', async()=>{
  const states=[];let state=null;
  const f=fixture({answer:(cmd)=>{if(cmd==='market_friend_listings')return {enabled:true,hasFriends:true,listings:[],mine:state?[{packId:'own',state}]:[]};
    state=cmd==='market_list_pack'?'open':cmd==='market_pause_pack'?'paused':cmd==='market_close_pack'?'closed':state;states.push(cmd);return {packId:'own',state,earned:0};}});
  await loaded(f);
  const pack={id:'own',title:'Autumn',by:'Me',own:true,canList:true,listed:false,left:[]};f.context.S.packs.push(pack);
  const control=f.context.PackListing.control(pack),[main,stop]=nodes(control).filter(n=>n.tag.startsWith('button'));
  assert.equal(main.textContent,'Show to friends in Market');assert.equal(stop.hidden,true);
  await main.on.click();assert.equal(pack.listed,true);assert.equal(main.textContent,'Take down');assert.equal(stop.hidden,false);
  await main.on.click();assert.equal(pack.listed,false);assert.match(text(control),/Taken down for now/);
  f.context.Friends={ask:async()=>false};vm.runInContext('var Friends=this.Friends;',f.context);
  await stop.on.click();assert.deepEqual(states,['market_list_pack','market_pause_pack'],'declining the sheet sends nothing');
  vm.runInContext('Friends={ask:async()=>true};',f.context);
  await stop.on.click();assert.equal(main.hidden,true);assert.match(text(control),/Stopped selling/);
  assert.deepEqual(states,['market_list_pack','market_pause_pack','market_close_pack']);
});
