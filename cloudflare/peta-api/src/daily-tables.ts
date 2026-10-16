import {stmt,type Env} from './index';
/** Signed tables still in effect or upcoming: the newest normal table and up to ten events. */
async function tables(env:Env,now:number):Promise<string[]> {
  const base=await stmt(env.DB,"SELECT event FROM daily_tables WHERE kind='default' AND stopped_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC,created_at DESC,id DESC LIMIT 1",now,now).first<{event:string}>();
  const events=await stmt(env.DB,"SELECT event FROM daily_tables WHERE kind='event' AND stopped_at IS NULL AND ends_at>? ORDER BY starts_at,id LIMIT 10",now).all<{event:string}>();
  return [...(base?[base.event]:[]),...events.results.map(e=>e.event)];
}
/** Signed owner settings of one kind that haven't ended or been stopped, newest start first. */
async function configs(env:Env,kind:string,now:number):Promise<string[]> {
  const rows=await stmt(env.DB,"SELECT event FROM signed_configs WHERE kind=? AND stopped_at IS NULL AND ends_at>? ORDER BY starts_at DESC,created_at DESC,id LIMIT 10",kind,now).all<{event:string}>();
  return rows.results.map(r=>r.event);
}
export async function dailyTables(request:Request,env:Env,path:string):Promise<Response|null> {
  if(!['/v1/daily-table','/v1/config'].includes(path) || request.method!=='GET')return null;
  const now=Math.floor(Date.now()/1000);
  // The older route stays for apps that only know the daily table.
  const body=path==='/v1/daily-table'?{tables:await tables(env,now)}:{tables:await tables(env,now),announcements:await configs(env,'announcement',now),shop:await configs(env,'shop_config',now)};
  return Response.json(body,{headers:{'Cache-Control':'private, no-store'}});
}
