import { fail, now, type Env } from "./index";
/** All mutations share a lease so separate tabs and Worker instances do not overwrite each other. */
export async function mutate(env: Env, work: () => Promise<Response>): Promise<Response> {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO admin_locks(name,token,until) VALUES('mutation',?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,until=excluded.until WHERE admin_locks.until<?").bind(token, now() + 120, now()).run();
  const lock = await env.DB.prepare("SELECT token FROM admin_locks WHERE name='mutation'").first<{ token: string }>();
  if (lock?.token !== token) fail(409, "busy", "別の変更を処理しています。ページを更新してから試してください。");
  try { return await work(); }
  finally { await env.DB.prepare("DELETE FROM admin_locks WHERE name='mutation' AND token=?").bind(token).run(); }
}
