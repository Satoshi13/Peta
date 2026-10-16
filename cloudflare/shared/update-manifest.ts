// Shared parsing only: no credentials, storage or Worker routes.
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
