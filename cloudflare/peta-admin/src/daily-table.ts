import contract from '../test/materials-vector.json';
import {fail} from './validation';
import {signHeader} from './bundle';
export {contract};
export type DailyItem={id:string;weight:number};
export function checkTable(input:unknown):DailyItem[] {
  if(!Array.isArray(input) || !input.length || input.length>contract.limits.maxItems)fail(400,'invalid','Choose 1 to 20 materials.');
  const seen=new Set<string>();
  const items=input.map(item=>{
    if(!item || typeof item.id!=='string' || !contract.materials.some(m=>m.id===item.id) || seen.has(item.id) || !Number.isSafeInteger(item.weight) || item.weight<1 || item.weight>contract.limits.maxWeight)fail(400,'invalid','Use each supported material once, with a weight from 1 to 1000.');
    seen.add(item.id);return {id:item.id,weight:item.weight} as DailyItem;
  });
  const total=items.reduce((n,i)=>n+i.weight,0),matte=items.find(i=>i.id==='matte')?.weight??0;
  if(matte*100<total*contract.limits.matteMinPercent)fail(400,'invalid','Matte must be at least 20%.');
  if(items.some(i=>['special','archive'].includes(contract.materials.find(m=>m.id===i.id)!.rarity) && i.weight*100>total*contract.limits.limitedMaxPercent))fail(400,'invalid','Each Special or Archive material must be at most 5%.');
  return items;
}
export type DailyPolicy={id:string;kind:'default'|'event';issuedAt:string;startsAt:string;endsAt:string;title:string;items:DailyItem[]};
export function dailyHeader(p:DailyPolicy,keyId:string) {
  // serde_json::Value sorts payload object keys lexically; Event header order remains unchanged.
  return {eventId:p.id,kind:'daily_table',issuedAt:p.issuedAt,notBefore:p.startsAt,notAfter:p.endsAt,title:p.title,message:'',payload:{items:checkTable(p.items),tableId:p.id,tableKind:p.kind},signer:{kind:'official',keyId},attachments:[]};
}
export const signDaily=(p:DailyPolicy,keyId:string,secret:string,publicKey:string)=>signHeader(dailyHeader(p,keyId),keyId,secret,publicKey);
