import {stmt,type Env} from './index';
export async function dailyTables(request:Request,env:Env,path:string):Promise<Response|null> {
  if(path!=='/v1/daily-table' || request.method!=='GET')return null;
  const now=Math.floor(Date.now()/1000);
  const base=await stmt(env.DB,"SELECT event FROM daily_tables WHERE kind='default' AND stopped_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC,created_at DESC,id DESC LIMIT 1",now,now).first<{event:string}>();
  const events=await stmt(env.DB,"SELECT event FROM daily_tables WHERE kind='event' AND stopped_at IS NULL AND ends_at>? ORDER BY starts_at,id LIMIT 10",now).all<{event:string}>();
  return Response.json({tables:[...(base?[base.event]:[]),...events.results.map(e=>e.event)]},{headers:{'Cache-Control':'private, no-store'}});
}
