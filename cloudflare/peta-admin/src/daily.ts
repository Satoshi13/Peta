import {api,audit,fail,now,type Env} from './index';
import {contract,checkTable,signDaily,type DailyPolicy} from './daily-table';
import {readEvent} from './bundle';
export async function daily(request:Request,env:Env,path:string,actor:string,data:any):Promise<Response|null> {
  if(!path.startsWith('/api/daily'))return null;
  const t=now();
  if(request.method==='GET' && path==='/api/daily') {
    const rows=await env.DB.prepare('SELECT * FROM daily_tables ORDER BY created_at DESC,id DESC LIMIT 100').all<any>();
    return api({contract,tables:rows.results.map(r=>({id:r.id,kind:r.kind,title:readEvent(r.event)?.title??'Daily supply',items:readEvent(r.event)?.payload?.items??[],startsAt:r.starts_at,endsAt:r.ends_at,stoppedAt:r.stopped_at,state:r.stopped_at!==null?'stopped':t>=r.ends_at?'ended':t<r.starts_at?'scheduled':'active'}))});
  }
  if(request.method!=='POST')fail(405,'method_not_allowed','This action is not available.');
  if(path==='/api/daily/stop') {
    if(typeof data?.id!=='string' || !await env.DB.prepare('SELECT 1 FROM daily_tables WHERE id=?').bind(data.id).first())fail(404,'not_found','That table was not found.');
    await env.DB.batch([env.DB.prepare('UPDATE daily_tables SET stopped_at=COALESCE(stopped_at,?) WHERE id=?').bind(t,data.id),audit(env.DB,actor,'daily.stopped',{id:data.id})]);return api({stopped:true});
  }
  if(path!=='/api/daily')return api({error:'not_found'},404);
  if(!['default','event'].includes(data?.kind))fail(400,'invalid','Choose a normal table or an event.');
  const kind=data.kind as 'default'|'event',items=checkTable(data.items),start=kind==='default'?t:data.startsAt,end=kind==='default'?t+400*86400:data.endsAt;
  if(!Number.isSafeInteger(start) || start<0 || !Number.isSafeInteger(end) || end<=start || end<=t || end>7258118400)fail(400,'invalid','Choose an end after the start and after now.');
  const title=kind==='default'?'Daily supply':typeof data.title==='string'?data.title.trim():'';
  if(!title || [...title].length>120 || /[\u0000-\u001f\u007f-\u009f]/.test(title))fail(400,'invalid','Use an event name up to 120 characters.');
  if(kind==='event' && Number((await env.DB.prepare("SELECT COUNT(*) n FROM daily_tables WHERE kind='event' AND stopped_at IS NULL AND ends_at>?").bind(t).first<any>())?.n)>=10)fail(409,'limit','Stop an event before scheduling another. Up to 10 can be active or scheduled.');
  const id=`daily-${kind}-${crypto.randomUUID()}`,iso=(v:number)=>new Date(v*1000).toISOString().replace('.000Z','Z');
  const policy:DailyPolicy={id,kind,title,issuedAt:iso(t),startsAt:iso(start),endsAt:iso(end),items};
  const event=await signDaily(policy,env.COUPON_KEY_ID??'',env.COUPON_SIGNING_KEY??'',env.COUPON_PUBLIC_KEY??'');
  await env.DB.batch([
    ...(kind==='default'?[env.DB.prepare("UPDATE daily_tables SET stopped_at=? WHERE kind='default' AND stopped_at IS NULL").bind(t)]:[]),
    env.DB.prepare('INSERT INTO daily_tables(id,kind,starts_at,ends_at,event,created_at) VALUES(?,?,?,?,?,?)').bind(id,kind,start,end,event,t),
    audit(env.DB,actor,'daily.created',{id,kind,startsAt:start,endsAt:end,items}),
  ]);
  return api({id},201);
}
