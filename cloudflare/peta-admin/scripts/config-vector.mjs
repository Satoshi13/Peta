// Public RFC 8032 test key only; this file never reads an owner key. Signed settings shared with the Rust tests.
import {createPrivateKey,sign} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const seed=Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex');
const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
function signed(header){
  const json=Buffer.from(JSON.stringify(header)),length=Buffer.alloc(4);length.writeUInt32BE(json.length);
  const bytes=Buffer.concat([Buffer.from('PETAEVNT'),Buffer.from([1]),length,json]);
  return Buffer.concat([bytes,sign(null,bytes,key)]).toString('base64');
}
const announcement={id:'news-contract',issuedAt:'2026-10-16T00:00:00Z',startsAt:'2026-10-16T00:00:00Z',endsAt:'2026-11-01T00:00:00Z',kind:'event',link:'download',text:'Autumn week: a new pack is in the Market.'};
const announcementEvent=signed({eventId:announcement.id,kind:'announcement',issuedAt:announcement.issuedAt,notBefore:announcement.startsAt,notAfter:announcement.endsAt,title:'Announcement',message:'',
  payload:{announcementId:announcement.id,kind:announcement.kind,link:announcement.link,text:announcement.text},signer:{kind:'official',keyId:'c1'},attachments:[]});
// The official packs and the shop limits as the app has them; the Rust tests fail if these drift.
const shopCatalog={limits:{minPercent:50,maxPercent:200,blurbMax:120,maxPacks:30,maxFeatured:6,maxDays:400,maxConfigs:10},shopPackPrefix:'shop:',shopPackPrice:{min:4,max:40},packs:[
  {id:'tokyo',title:'Tokyo Pack',price:16,free:true},{id:'coffee',title:'Coffee Club',price:12,free:true},{id:'plants',title:'Houseplants',price:10,free:true},
  {id:'pixel',title:'Pixel Dream',price:12,free:false},{id:'cats',title:'Cats',price:10,free:false},{id:'night',title:'Night Market',price:12,free:false}]};
const shop={id:'shop-contract',kind:'event',issuedAt:'2026-10-16T00:00:00Z',startsAt:'2026-10-16T00:00:00Z',endsAt:'2026-11-01T00:00:00Z',featured:['night','pixel'],officialFirst:true,order:['night','cats'],
  packs:[{id:'night',onSale:true,price:18,blurb:'Paper lanterns, now with fog.'},{id:'cats',onSale:false,price:null,blurb:null},{id:'tokyo',onSale:true,price:null,blurb:'Start here.'}]};
const shopEvent=signed({eventId:shop.id,kind:'shop_config',issuedAt:shop.issuedAt,notBefore:shop.startsAt,notAfter:shop.endsAt,title:'Shop',message:'',
  payload:{configId:shop.id,configKind:shop.kind,featured:shop.featured,officialFirst:shop.officialFirst,order:shop.order,packs:shop.packs.map(p=>({blurb:p.blurb,id:p.id,onSale:p.onSale,price:p.price}))},signer:{kind:'official',keyId:'c1'},attachments:[]});
writeFileSync(new URL('../test/config-vector.json',import.meta.url),JSON.stringify({note:'Public RFC 8032 test vector, never a production key.',keyId:'c1',publicKey:'11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',
  announcement,announcementEvent,shopCatalog,shop,shopEvent},null,2)+'\n');
