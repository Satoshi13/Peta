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
writeFileSync(new URL('../test/config-vector.json',import.meta.url),JSON.stringify({note:'Public RFC 8032 test vector, never a production key.',keyId:'c1',publicKey:'11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',
  announcement,announcementEvent},null,2)+'\n');
