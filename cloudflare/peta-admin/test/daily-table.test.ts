import {expect,it} from 'vitest';
import vector from './daily-vector.json';
import {checkTable,signDaily,type DailyPolicy} from '../src/daily-table';
const secret=btoa(String.fromCharCode(...Uint8Array.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'.match(/../g)!,x=>parseInt(x,16))));
it('matches the Rust daily-table signing contract byte for byte',async()=>{
 expect(await signDaily(vector.policy as DailyPolicy,vector.keyId,secret,vector.publicKey)).toBe(vector.event);
});
it('uses exact integer limits and rejects unknown, duplicate or invalid weights',()=>{
 expect(checkTable([{id:'matte',weight:20},{id:'kraft',weight:75},{id:'gold',weight:5}])).toHaveLength(3);
 for(const items of [[{id:'matte',weight:19},{id:'kraft',weight:81}],[{id:'matte',weight:94},{id:'sakura',weight:6}],[{id:'matte',weight:1},{id:'matte',weight:1}],[{id:'unknown',weight:100}],[{id:'matte',weight:1001}],[]])expect(()=>checkTable(items)).toThrow();
});
