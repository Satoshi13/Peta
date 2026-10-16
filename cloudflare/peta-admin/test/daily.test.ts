import {beforeAll,beforeEach,expect,it} from 'vitest';
import {base,setup,clear,req,post} from './helpers';
import {readEvent} from '../src/bundle';
const secret=btoa(String.fromCharCode(...Uint8Array.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'.match(/../g)!,x=>parseInt(x,16))));
const use={...base,COUPON_KEY_ID:'c1',COUPON_SIGNING_KEY:secret,COUPON_PUBLIC_KEY:'11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo='};
beforeAll(setup);beforeEach(async()=>{await clear();await base.DB.prepare('DELETE FROM daily_tables').run();});
const items=[{id:'matte',weight:60},{id:'kraft',weight:30},{id:'holographic',weight:10}];
it('only the owner can publish, and signs exactly the stored ID, role and period',async()=>{
 expect((await req('/api/daily',{},use,null)).status).toBe(403);
 const response=await post('/api/daily',{kind:'default',items},use);expect(response.status).toBe(201);
 const row=await base.DB.prepare('SELECT * FROM daily_tables').first<any>();const event=readEvent(row.event)!;
 expect(event.kind).toBe('daily_table');expect(event.payload.tableId).toBe(row.id);expect(event.payload.tableKind).toBe(row.kind);expect(Date.parse(event.notBefore)/1000).toBe(row.starts_at);expect(Date.parse(event.notAfter)/1000).toBe(row.ends_at);expect(row.ends_at-row.starts_at).toBe(400*86400);
 expect((await base.DB.prepare("SELECT COUNT(*) n FROM admin_log WHERE action='daily.created'").first<any>()).n).toBe(1);
 const data=await(await req('/api/daily',{},use)).json<any>();expect(data.contract.materials).toHaveLength(10);expect(data.tables[0].state).toBe('active');
 expect((await post('/api/daily/stop',{id:row.id},use)).status).toBe(200);expect((await(await req('/api/daily',{},use)).json<any>()).tables[0].state).toBe('stopped');
});
it('rejects cap violations without a write and keeps a single normal table',async()=>{
 expect((await post('/api/daily',{kind:'default',items:[{id:'matte',weight:10},{id:'gold',weight:90}]},use)).status).toBe(400);
 expect((await base.DB.prepare('SELECT COUNT(*) n FROM daily_tables').first<any>()).n).toBe(0);
 await post('/api/daily',{kind:'default',items},use);await post('/api/daily',{kind:'default',items},use);
 expect((await base.DB.prepare("SELECT COUNT(*) n FROM daily_tables WHERE stopped_at IS NULL AND kind='default'").first<any>()).n).toBe(1);
});
it('validates event dates, limits scheduled events and accepts stopping',async()=>{
 const now=Math.floor(Date.now()/1000),event={kind:'event',title:'A little autumn',items,startsAt:now+100,endsAt:now+86400};
 expect((await post('/api/daily',{...event,endsAt:now},use)).status).toBe(400);
 for(let i=0;i<10;i++)expect((await post('/api/daily',event,use)).status).toBe(201);
 expect((await post('/api/daily',event,use)).status).toBe(409);
 const id=(await base.DB.prepare('SELECT id FROM daily_tables LIMIT 1').first<any>()).id;await post('/api/daily/stop',{id},use);
 expect((await post('/api/daily',event,use)).status).toBe(201);
});
