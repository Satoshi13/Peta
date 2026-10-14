import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, post, req } from "./helpers";
import { emailHash } from "../../shared/identity";
import { emailHash as downloadHash } from "../../peta-download/src/index";
import type { Fetch } from "../src/friends";
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const use = { ...base, CF_ACCOUNT_ID: "a".repeat(32), ACCESS_FRIENDS_POLICY_ID: ID, CF_API_TOKEN: "CANARY-TOKEN" };
let policy: any, calls: { method: string; body: any }[], rejectPut: boolean, rejectGet: boolean;
const fake: Fetch = async (url, init) => {
  expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${use.CF_ACCOUNT_ID}/access/policies/${ID}`);
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer CANARY-TOKEN");
  const method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, body });
  if ((method === "PUT" && rejectPut) || (method === "GET" && rejectGet)) return Response.json({ success: false, errors: [{ code: 1000, message: "CANARY-TOKEN private upstream detail" }] }, { status: 403 });
  if (method === "PUT") { expect(body.id).toBeUndefined(); expect(body.created_at).toBeUndefined(); policy = { ...policy, ...body }; }
  return Response.json({ success: true, result: policy });
};
const listing = async () => (await req("/api/friends", {}, use, undefined, fake)).json<any>();
const change = async (path: string, body: any) => post(path, { ...body, revision: (await listing()).revision }, use, fake);
beforeAll(setup);
beforeEach(async () => {
  await clear(); calls = []; rejectPut = rejectGet = false;
  policy = { id: ID, name: "Peta friends", decision: "allow", reusable: true, created_at: "ignored", include: [{ email: { email: "Owner@Example.com" } }, { email: { email: "friend@example.com" } }, { group: { id: "group" } }], exclude: [{ email: { email: "blocked@example.com" } }], require: [{ login_method: { id: "pin" } }], session_duration: "24h", approval_required: false, approval_groups: [], isolation_required: false, mfa_config: { mfa_disabled: false }, connection_rules: { rdp: {} }, purpose_justification_prompt: "Reason", purpose_justification_required: false };
});
it("joins normalized policy emails to invite state and the last download using the shared hash", async () => {
  const hash = await emailHash(" FRIEND@example.com "); expect(hash).toBe(await downloadHash("friend@example.com"));
  await use.DB.prepare("INSERT INTO invites VALUES(?,?,?,?,?,?)").bind(hash, "0123456789", "mac", 1, 2, null).run();
  await use.DB.batch([use.DB.prepare("INSERT INTO downloads VALUES(?,?,?)").bind(hash, "0.1.0", 1), use.DB.prepare("INSERT INTO downloads VALUES(?,?,?)").bind(hash, "0.2.0", 3)]);
  expect((await listing()).friends).toEqual(expect.arrayContaining([expect.objectContaining({ email: "friend@example.com", invite: { state: "in use", since: 2 }, download: { version: "0.2.0", at: 3 } }), expect.objectContaining({ email: "owner@example.com", owner: true, invite: { state: "not visited", since: null } })]));
  expect((await use.DB.prepare("SELECT COUNT(*) AS n FROM admin_log").first<any>()).n).toBe(0);
  await change("/api/friends/pause", { email: "friend@example.com" }); expect((await listing()).friends.find((f: any) => f.email === "friend@example.com").invite.state).toBe("stopped");
  await change("/api/friends/resume", { email: "friend@example.com" }); expect((await listing()).friends.find((f: any) => f.email === "friend@example.com").invite.state).toBe("in use");
});
it("adds multiple normalized emails while preserving every writable policy field and other rules", async () => {
  const before = structuredClone(policy);
  const r = await change("/api/friends/add", { emails: " NEW@Example.com ,\nsecond@example.com" }); expect(r.status).toBe(200);
  const body = calls.find(c => c.method === "PUT")!.body;
  for (const key of ["exclude", "require", "session_duration", "approval_required", "approval_groups", "isolation_required", "mfa_config", "connection_rules", "purpose_justification_prompt", "purpose_justification_required"]) expect(body[key]).toEqual(before[key]);
  expect(body.include).toContainEqual({ group: { id: "group" } }); expect(body.include).toContainEqual({ email: { email: "new@example.com" } });
  for (const values of ["friend@example.com", "same@example.com,SAME@example.com", "bad", "x@example.com,y@example.com,y@example.com"]) expect((await change("/api/friends/add", { emails: values })).status).toBeGreaterThanOrEqual(400);
  const logs = JSON.stringify((await use.DB.prepare("SELECT * FROM admin_log").all()).results);
  expect(logs).not.toContain("@example.com"); expect(logs).not.toContain("CANARY");
});
it("rejects owner removal before any mutation/provider call and refuses stale forms", async () => {
  const r = await post("/api/friends/remove", { email: " OWNER@Example.com ", confirm: true }, use, fake); expect(r.status).toBe(400); expect(calls).toHaveLength(0);
  expect((await use.DB.prepare("SELECT COUNT(*) AS n FROM invites").first<any>()).n).toBe(0);
  expect((await post("/api/friends/add", { emails: "new@example.com", revision: "stale" }, use, fake)).status).toBe(409); expect(calls.some(c => c.method === "PUT")).toBe(false);
});
it("revokes a never-opened invite before removing its policy email, and retries partial deletion safely", async () => {
  rejectPut = true;
  const r = await change("/api/friends/remove", { email: "friend@example.com", confirm: true }); expect(r.status).toBe(502);
  expect(await r.json()).toMatchObject({ inviteRevoked: true, changed: false });
  const hash = await emailHash("friend@example.com"), invite = await use.DB.prepare("SELECT * FROM invites WHERE email_hash=?").bind(hash).first<any>(); expect(invite.revoked_at).not.toBeNull(); expect(invite.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  expect(policy.include).toContainEqual({ email: { email: "friend@example.com" } });
  rejectPut = false; expect((await change("/api/friends/remove", { email: "friend@example.com", confirm: true })).status).toBe(200);
  expect(policy.include).not.toContainEqual({ email: { email: "friend@example.com" } }); expect(policy.include).toContainEqual({ group: { id: "group" } });
  expect((await use.DB.prepare("SELECT code FROM invites WHERE email_hash=?").bind(hash).first<any>()).code).toBe(invite.code);
  const logs = JSON.stringify((await use.DB.prepare("SELECT * FROM admin_log").all()).results); expect((await use.DB.prepare("SELECT detail FROM admin_log WHERE action='friend.provider_failed'").first<any>()).detail).toContain('"codes":[1000]'); expect(logs).not.toContain("CANARY"); expect(logs).not.toContain("friend@example.com");
});
it("enforces the 200-email limit and sanitizes provider errors on reads", async () => {
  policy.include = Array.from({ length: 200 }, (_, i) => ({ email: { email: `friend${i}@example.com` } }));
  expect((await change("/api/friends/add", { emails: "overflow@example.com" })).status).toBe(400);
  rejectGet = true; const r = await req("/api/friends", {}, use, undefined, fake); expect(r.status).toBe(502); expect(await r.text()).not.toContain("CANARY");
});
it("does not report success if Cloudflare accepts PUT but verification differs", async () => {
  const altered: Fetch = async (url, init) => { const r = await fake(url, init); if (init?.method === "PUT") policy.session_duration = "1h"; return r; };
  const rev = (await listing()).revision;
  const r = await post("/api/friends/add", { emails: "new@example.com", revision: rev }, use, altered);
  expect(r.status).toBe(502); expect(await r.json()).toMatchObject({ changed: true });
});

it("serializes competing tabs and permits retrying the second change without losing the first", async () => {
  const revision = (await listing()).revision;
  const results = await Promise.all(["first@example.com", "second@example.com"].map(email => post("/api/friends/add", { emails: email, revision }, use, fake)));
  expect(results.map(r => r.status).sort()).toEqual([200,409]);
  const missing = ["first@example.com", "second@example.com"].find(email => !policy.include.some((r: any) => r.email?.email === email));
  expect((await change("/api/friends/add", { emails: missing })).status).toBe(200);
  for (const email of ["first@example.com", "second@example.com"]) expect(policy.include).toContainEqual({ email: { email } });
});
