import {api,audit,fail,now,type Env} from './index';
import {contract,checkTable,signDaily,type DailyPolicy} from './daily-table';
import {readEvent} from './bundle';
export async function daily(request:Request,env:Env,path:string,actor:string,data:any):Promise<Response|null> {
  if(!path.startsWith('/api/daily'))return null;
  const t=now();
  if(request.method==='GET' && path==='/api/daily') {
    const rows=await env.DB.prepare('SELECT * FROM daily_tables ORDER BY created_at DESC,id DESC LIMIT 100').all<any>();
    return api({contract,tables:rows.results.map(r=>({id:r.id,kind:r.kind,title:readEvent(r.event)?.title??"デイリー配布",items:readEvent(r.event)?.payload?.items??[],startsAt:r.starts_at,endsAt:r.ends_at,stoppedAt:r.stopped_at,state:r.stopped_at!==null?'stopped':t>=r.ends_at?'ended':t<r.starts_at?'scheduled':'active'}))});
  }
  if(request.method!=='POST')fail(405,'method_not_allowed',"この操作は利用できません。");
  if(path==='/api/daily/stop') {
    if(typeof data?.id!=='string' || !await env.DB.prepare('SELECT 1 FROM daily_tables WHERE id=?').bind(data.id).first())fail(404,'not_found',"確率表が見つかりません。");
    await env.DB.batch([env.DB.prepare('UPDATE daily_tables SET stopped_at=COALESCE(stopped_at,?) WHERE id=?').bind(t,data.id),audit(env.DB,actor,'daily.stopped',{id:data.id})]);return api({stopped:true});
  }
  if(path!=='/api/daily')return api({error:'not_found'},404);
  if(!['default','event'].includes(data?.kind))fail(400,'invalid',"通常の確率表かイベントを選んでください。");
  const kind=data.kind as 'default'|'event',items=checkTable(data.items),start=kind==='default'?t:data.startsAt,end=kind==='default'?t+400*86400:data.endsAt;
  if(!Number.isSafeInteger(start) || start<0 || !Number.isSafeInteger(end) || end<=start || end<=t || end>7258118400)fail(400,'invalid',"終了日時は開始日時および現在時刻より後にしてください。");
  const title=kind==='default'?"デイリー配布":typeof data.title==='string'?data.title.trim():'';
  if(!title || [...title].length>120 || /[\u0000-\u001f\u007f-\u009f]/.test(title))fail(400,'invalid',"イベント名は120文字以内にしてください。");
  if(kind==='event' && Number((await env.DB.prepare("SELECT COUNT(*) n FROM daily_tables WHERE kind='event' AND stopped_at IS NULL AND ends_at>?").bind(t).first<any>())?.n)>=10)fail(409,'limit',"公開中・予定のイベントは10件までです。別のイベントを停止してください。");
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
