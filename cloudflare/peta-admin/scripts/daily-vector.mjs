// Public RFC 8032 test key only; this file never reads an owner key.
import {createPrivateKey,sign} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const seed=Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex');
const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
const policy={id:'daily-contract',kind:'default',issuedAt:'2026-10-16T00:00:00Z',startsAt:'2026-10-16T00:00:00Z',endsAt:'2026-11-01T00:00:00Z',title:'Daily supply',items:[{id:'matte',weight:50},{id:'kraft',weight:25},{id:'holographic',weight:15},{id:'riso',weight:10}]};
const header={eventId:policy.id,kind:'daily_table',issuedAt:policy.issuedAt,notBefore:policy.startsAt,notAfter:policy.endsAt,title:policy.title,message:'',payload:{items:policy.items,tableId:policy.id,tableKind:policy.kind},signer:{kind:'official',keyId:'c1'},attachments:[]};
const json=Buffer.from(JSON.stringify(header)),length=Buffer.alloc(4);length.writeUInt32BE(json.length);
const bytes=Buffer.concat([Buffer.from('PETAEVNT'),Buffer.from([1]),length,json]);
writeFileSync(new URL('../test/daily-vector.json',import.meta.url),JSON.stringify({note:'Public RFC 8032 test vector, never a production key.',keyId:'c1',publicKey:'11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',policy,event:Buffer.concat([bytes,sign(null,bytes,key)]).toString('base64')},null,2)+'\n');
