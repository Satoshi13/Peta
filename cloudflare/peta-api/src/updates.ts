import { sha256, utf8 } from './proofs';
import { fail, stmt, type Env } from './index';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export function versionParts(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const m = semver.exec(value);
  if (!m || m[4]?.split('.').some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) return null;
  return m.slice(1, 5);
}
const numberCompare = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
export function newer(a: string, b: string): boolean {
  const x = versionParts(a), y = versionParts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) { const d = numberCompare(x[i], y[i]); if (d) return d > 0; }
  if (!x[3] || !y[3]) return !!y[3] && !x[3];
  const p=x[3].split('.'), q=y[3].split('.');
  for(let i=0;i<Math.max(p.length,q.length);i++) {
    if(p[i]===undefined || q[i]===undefined)return p[i]!==undefined;
    if(p[i]===q[i])continue;
    const n=/^\d+$/.test(p[i]), m=/^\d+$/.test(q[i]);
    return n && m ? numberCompare(p[i],q[i])>0 : n!==m ? !n : p[i]>q[i];
  }
  return false;
}
interface Manifest {version:string; publishedAt:string; update?:{version:string;file:string;signature:string;notes?:string}}
export function validUpdate(m: any): m is Manifest & {update:NonNullable<Manifest['update']>} {
  const u=m?.update;
  return !!u && !!versionParts(m.version) && u.version===m.version
    && u.file===`updates/${m.version}/Peta.app.tar.gz`
    && typeof u.signature==='string' && /^[A-Za-z0-9+/=]{40,4096}$/.test(u.signature)
    && (u.notes===undefined || typeof u.notes==='string' && u.notes.length<=8000)
    && typeof m.publishedAt==='string' && Number.isFinite(Date.parse(m.publishedAt));
}
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
