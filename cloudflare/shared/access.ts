/* Cloudflare Access in front of this Worker decides who may sign in; this re-checks its signed token on every request,
   so a misconfigured or missing Access policy fails closed instead of serving the page or the disk image. */
export interface AccessConfig {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
export type KeySource = (certsUrl: string) => Promise<JsonWebKey[]>;

let cached: { url: string; at: number; keys: JsonWebKey[] } | null = null;
export const fetchKeys: KeySource = async (url) => {
  if (cached?.url === url && Date.now() - cached.at < 3600_000) return cached.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error("access_certs");
  const keys = ((await r.json()) as { keys?: JsonWebKey[] }).keys ?? [];
  cached = { url, at: Date.now(), keys };
  return keys;
};

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

export function teamDomain(env: AccessConfig): string | null {
  const d = (env.ACCESS_TEAM_DOMAIN ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(d) ? d : null;
}
export function token(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("Cookie") ?? "");
  return cookie ? cookie[1] : null;
}
/** The signed-in email, or null for anything not issued by this team's Access application for this audience. */
export async function accessEmail(request: Request, env: AccessConfig, keys: KeySource = fetchKeys): Promise<string | null> {
  const team = teamDomain(env), aud = (env.ACCESS_AUD ?? "").trim();
  const jwt = token(request);
  if (!team || !/^[a-f0-9]{64}$/.test(aud) || !jwt) return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = json(parts[0]), payload = json(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const jwk = (await keys(`${team}/cdn-cgi/access/certs`)).find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), signed))) return null;
    const now = Date.now() / 1000;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== team || !auds.includes(aud)) return null;
    if (typeof payload.exp !== "number" || payload.exp < now - 30) return null;
    if (typeof payload.nbf === "number" && payload.nbf > now + 30) return null;
    // Service tokens carry no email and are not friends.
    if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
    return payload.email.trim().toLowerCase();
  } catch {
    return null;
  }
}
