import { sha256, utf8 } from './proofs';
import { fail, stmt, type Env } from './index';

import {versionParts,newer,validUpdate} from '../../shared/update-manifest';
export {newer,validUpdate} from '../../shared/update-manifest';
async function latest(env:Env) {
  const object=await env.RELEASES?.get('releases/latest.json');
  if(!object)return null;
  try {const m=await object.json();return validUpdate(m)?m:null;} catch {return null;}
}
export async function updates(request:Request,env:Env,path:string,hash:string):Promise<Response|null> {
  if(request.method!=='GET')return null;
  if(path==='/v1/update') {
    const current=new URL(request.url).searchParams.get('current');
    if(!versionParts(current))fail(400,'invalid');
    const m=await latest(env);
    if(!m || !newer(m.version,current!))return new Response(null,{status:204});
    // No identifying information appears in the URL. Requests still require this Mac's signature.
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const now=Math.floor(Date.now()/1000);
    await env.DB.batch([
      stmt(env.DB,'DELETE FROM update_tokens WHERE expires_at<=?',now),
      stmt(env.DB,'INSERT INTO update_tokens VALUES(?,?,?,?,?)',await sha256(utf8(token)),hash,m.version,m.update.file,now+600),
    ]);
    const item={url:new URL(`/v1/update/file/${token}`,request.url).href,signature:m.update.signature};
    return Response.json({version:m.version,notes:m.update.notes??'',pub_date:m.publishedAt,platforms:{'darwin-aarch64':item,'darwin-x86_64':item}},{headers:{'Cache-Control':'private, no-store'}});
  }
  const match=/^\/v1\/update\/file\/([a-f0-9]{64})$/.exec(path);
  if(!match)return null;
  const row=await stmt(env.DB,'SELECT version,file FROM update_tokens WHERE token=? AND key_hash=? AND expires_at>?',await sha256(utf8(match[1])),hash,Math.floor(Date.now()/1000)).first<{version:string;file:string}>();
  const m=await latest(env);
  if(!row || !m || row.version!==m.version || row.file!==m.update.file)fail(403,'update_expired');
  const object=await env.RELEASES?.get('releases/'+row.file);
  if(!object)fail(404,'not_found');
  await stmt(env.DB,'INSERT INTO update_downloads VALUES(?,?,?)',hash,row.version,Math.floor(Date.now()/1000)).run();
  return new Response(object.body,{headers:{'Content-Type':'application/gzip','Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
