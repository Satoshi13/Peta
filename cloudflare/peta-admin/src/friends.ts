import { api, audit, fail, normalizeEmail, now, owners, type Env } from "./index";
import { emailHash } from "../../shared/identity";
import { newCode } from "../../peta-download/src/index";
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Policy = Record<string, any> & { id: string; name: string; decision: string; include: Record<string, any>[] };
// Cloudflare's reusable-policy PUT schema, checked 2026-10-14. Never send response-only fields.
const WRITABLE = ["name", "decision", "include", "exclude", "require", "approval_groups", "approval_required", "connection_rules", "isolation_required", "mfa_config", "purpose_justification_prompt", "purpose_justification_required", "session_duration"];
class ProviderError extends Error {
  constructor(public phase: string, public status: number, public codes: number[] = []) { super("Cloudflare didn't accept the change. Refresh to check its status."); }
}
function policyURL(env: Env) {
  if (!/^[a-f0-9]{32}$/.test(env.CF_ACCOUNT_ID ?? "") || !/^[a-f0-9-]{36}$/.test(env.ACCESS_FRIENDS_POLICY_ID ?? "") || !env.CF_API_TOKEN) fail(503, "friends_unavailable", "Friend management isn't configured.");
  return `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/policies/${env.ACCESS_FRIENDS_POLICY_ID}`;
}
async function provider(env: Env, transport: Fetch, method: "GET" | "PUT", body?: unknown): Promise<Policy> {
  let response: Response, data: any;
  try {
    response = await transport(policyURL(env), { method, headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    data = await response.json();
  } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError(method.toLowerCase(), 0); }
  if (!response.ok || data?.success !== true || !data.result) throw new ProviderError(method.toLowerCase(), response.status, Array.isArray(data?.errors) ? data.errors.map((e: any) => e?.code).filter((n: any) => Number.isSafeInteger(n)).slice(0, 8) : []);
  const p = data.result;
  if (p.id !== env.ACCESS_FRIENDS_POLICY_ID || p.name !== "Peta friends" || p.decision !== "allow" || p.reusable === false || !Array.isArray(p.include)) throw new ProviderError("policy_shape", response.status);
  return p;
}
const address = (rule: Record<string, any>) => rule && Object.keys(rule).length === 1 ? normalizeEmail(rule.email?.email) : null;
function emails(policy: Policy) { return [...new Set(policy.include.map(address).filter(Boolean) as string[])].sort(); }
function projection(policy: Policy): Record<string, any> { return Object.fromEntries(WRITABLE.filter(key => key in policy).map(key => [key, policy[key]])); }
function canonical(value: any): string { return JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v); }
async function revision(policy: Policy): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(projection(policy))));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
function parseEmails(value: unknown): string[] {
  const parts = typeof value === "string" ? value.split(/[\n,]+/).filter(v => v.trim()) : Array.isArray(value) ? value : [];
  if (!parts.length || parts.length > 200) fail(400, "invalid", "Add between 1 and 200 email addresses.");
  const normalized = parts.map(normalizeEmail);
  if (normalized.some(v => !v)) fail(400, "invalid", "Check each email address.");
  if (new Set(normalized).size !== normalized.length) fail(409, "duplicate", "Each email address should appear once.");
  return normalized as string[];
}
async function revoke(env: Env, hash: string, actor: string): Promise<void> {
  for (let tries = 0; tries < 4; tries++) {
    try {
      // A tombstone also stops a never-opened friend creating a live invite from an old Access session.
      await env.DB.batch([
        env.DB.prepare("INSERT INTO invites(email_hash,code,created_at,revoked_at) VALUES(?,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET revoked_at=COALESCE(invites.revoked_at,excluded.revoked_at)").bind(hash, newCode(), now(), now()),
        audit(env.DB, actor, "friend.invite_stopped", { emailHash: hash }),
      ]);
      return;
    } catch (error) { if (tries === 3) throw error; }
  }
}
export async function friends(request: Request, env: Env, path: string, actor: string, data: any, transport: Fetch): Promise<Response | null> {
  if (!path.startsWith("/api/friends")) return null;
  // Validate before provider() so missing configuration returns its safe, actionable message.
  policyURL(env);
  let inviteRevoked = false, changed = false;
  const subjects: string[] = [];
  try {
    if (path === "/api/friends" && request.method === "GET") {
      const p = await provider(env, transport, "GET");
      const [inviteRows, downloadRows] = await env.DB.batch([
        env.DB.prepare("SELECT email_hash,key_hash,bound_at,revoked_at FROM invites"),
        env.DB.prepare("SELECT email_hash,version,at FROM (SELECT email_hash,version,at,ROW_NUMBER() OVER(PARTITION BY email_hash ORDER BY at DESC,rowid DESC) AS rank FROM downloads) WHERE rank=1"),
      ]);
      const invites = new Map(inviteRows.results.map((row: any) => [row.email_hash, row]));
      const downloads = new Map(downloadRows.results.map((row: any) => [row.email_hash, { version: row.version, at: row.at }]));
      const list = await Promise.all(emails(p).map(async email => {
        const hash = await emailHash(email), invite = invites.get(hash) as any;
        return { email, owner: owners(env)!.includes(email), invite: invite ? { state: invite.revoked_at !== null ? "stopped" : invite.key_hash ? "in use" : "unused", since: invite.bound_at } : { state: "not visited", since: null }, download: downloads.get(hash) ?? null };
      }));
      return api({ friends: list, revision: await revision(p), downloadPage: env.DOWNLOAD_PAGE_URL ?? "" });
    }
    if (request.method !== "POST") fail(405, "method_not_allowed", "This action is not available.");
    if (!["/api/friends/add", "/api/friends/remove", "/api/friends/pause", "/api/friends/resume"].includes(path)) return api({ error: "not_found" }, 404);
    const values = path === "/api/friends/add" ? parseEmails(data?.emails) : parseEmails([data?.email]);
    if (path === "/api/friends/remove" && values.some(email => owners(env)!.includes(email))) fail(400, "owner", "You can't remove an owner's email address.");
    for (const email of values) subjects.push(await emailHash(email));
    const p = await provider(env, transport, "GET"), existing = emails(p);
    if (typeof data?.revision !== "string" || data.revision !== await revision(p)) fail(409, "stale", "The friends list has changed. Refresh and try again.");
    if (path === "/api/friends/pause" || path === "/api/friends/resume") {
      if (!existing.includes(values[0])) fail(404, "not_found", "That friend isn't in the list. Refresh and try again.");
      if (path.endsWith("pause")) await revoke(env, subjects[0], actor);
      else await env.DB.batch([env.DB.prepare("UPDATE invites SET revoked_at=NULL WHERE email_hash=?").bind(subjects[0]), audit(env.DB, actor, "friend.invite_resumed", { emailHash: subjects[0] })]);
      return api({ changed: true });
    }
    if (path.endsWith("add")) {
      if (values.some(email => existing.includes(email))) fail(409, "duplicate", "That email address is already a friend.");
      if (existing.length + values.length > 200) fail(400, "limit", "The list can hold up to 200 email addresses.");
      p.include.push(...values.map(email => ({ email: { email } })));
      await audit(env.DB, actor, "friend.add_requested", { emailHashes: subjects }).run();
    } else {
      if (data?.confirm !== true) fail(400, "confirm", "Confirm removing this friend and stopping their invite.");
      p.include = p.include.filter(rule => address(rule) !== values[0]);
      // Cloudflare requires at least one Include rule. Keep the owner email in this reusable policy.
      if (!p.include.length) fail(400, "empty_policy", "Keep an owner email in the friends policy before removing its last friend.");
      await revoke(env, subjects[0], actor); inviteRevoked = true;
    }
    const expected = projection(p);
    await provider(env, transport, "PUT", expected); changed = true;
    const verified = await provider(env, transport, "GET");
    if (canonical(projection(verified)) !== canonical(expected)) throw new ProviderError("verify", 200);
    await audit(env.DB, actor, path.endsWith("add") ? "friend.added" : "friend.removed", { emailHashes: subjects, outcome: "success" }).run();
    return api({ changed: true, inviteRevoked, revision: await revision(verified), downloadPage: env.DOWNLOAD_PAGE_URL ?? "" });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    // Reading a list must be side-effect free. Only mutations enter the audit trail.
    if (request.method === "POST") await audit(env.DB, actor, "friend.provider_failed", { emailHashes: subjects, phase: error.phase, status: error.status, codes: error.codes, inviteRevoked, changed }).run();
    return api({ error: "cloudflare", inviteRevoked, changed, message: inviteRevoked ? "The invite is stopped. Cloudflare couldn't confirm page access was removed. Refresh and retry removal." : "Cloudflare couldn't confirm the change. Refresh the list before trying again." }, 502);
  }
}
