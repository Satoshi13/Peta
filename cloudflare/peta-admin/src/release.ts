import { api, type Env } from "./index";
import { validRelease, type Release } from "../../peta-download/src/index";
export async function release(env: Env): Promise<Response> {
  const object = await env.RELEASES.get("releases/latest.json");
  let latest: Release | null = null;
  if (object) { try { const value = await object.json(); if (validRelease(value) && Number.isFinite(Date.parse(value.publishedAt))) latest = value; } catch { /* A missing or malformed manifest is displayed as unavailable. */ } }
  const downloads = await env.DB.prepare("SELECT version,COUNT(DISTINCT email_hash) AS people,COUNT(*) AS downloads,MAX(at) AS lastAt FROM downloads GROUP BY version ORDER BY lastAt DESC").all();
  const updates = await env.DB.prepare("SELECT version,COUNT(DISTINCT key_hash) AS devices,COUNT(*) AS downloads,MAX(at) AS lastAt FROM update_downloads GROUP BY version ORDER BY lastAt DESC").all();
  return api({ latest, downloads: downloads.results, updates:updates.results });
}
