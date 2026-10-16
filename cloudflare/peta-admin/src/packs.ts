import { api, audit, fail, now, type Env } from "./index";
import contract from "../../shared/shop-pack-contract.json";

/* Official shop packs (docs/official-packs-howto.md). This page makes drafts and decides when signed packs are on sale.
   It never signs and never sees a signing key: a ready draft is signed on the owner's Mac by scripts/sign-pack.sh, which
   puts the file at shop/<packId>/<version>.peta and records it in shop_packs. Writes to R2 go under shop/drafts/ only. */

export { contract };
const ID = new RegExp(contract.idPattern), controls = /[\u0000-\u001f\u007f-\u009f]/;
export const MAX_LIVE = 24, MAX_DRAFTS = 100;
const DRAFTS = "shop/drafts/";
const draftObject = (draftId: string, name: string) => `${DRAFTS}${draftId}/${name}`;
const DRAFT_ID = /^d-[a-f0-9]{16}$/;

export type Item = { key: string; name: string; rarity: string; weight: number | null };
export type Manifest = { packId: string; version: number; title: string; by: string; blurb: string; pouch: string; color: string | null; price: number; items: Item[] };

const text = (v: unknown, max: number, empty = false) => typeof v === "string" && (empty || v.trim().length > 0) && [...v].length <= max && !controls.test(v);
export const validId = (id: unknown): id is string => typeof id === "string" && ID.test(id);

/** The limits the app and peta-pass apply (cloudflare/shared/shop-pack-contract.json). `complete` adds what signing needs. */
export function checkManifest(input: any, complete: boolean): Manifest {
  const bad = (message: string): never => fail(400, "invalid", message);
  if (!input || typeof input !== "object") bad("Check the form and try again.");
  if (!validId(input.packId) || contract.builtInIds.includes(input.packId)) bad("Pack IDs use letters, numbers, - and _ (up to 40), and never a built-in pack's ID.");
  if (!Number.isSafeInteger(input.version) || input.version < 1) bad("Pack versions start at 1.");
  if (!text(input.title, contract.titleChars, !complete) || !text(input.by, contract.titleChars, !complete)) bad("Give the pack a title and an author, each up to 40 characters.");
  if (!text(input.blurb ?? "", contract.blurbChars, true)) bad("The pack's line is up to 120 characters on one line.");
  if (!contract.pouches.includes(input.pouch)) bad("Choose kraft, matte, holo or glassine.");
  const color = input.color ?? null;
  if (color !== null && (!contract.colors.includes(color) || !contract.colorPouches.includes(input.pouch))) bad("Only matte and holo take a color.");
  if (!Number.isSafeInteger(input.price) || input.price < contract.price.min || input.price > contract.price.max) bad("Shop packs cost 4 to 40 Scraps.");
  if (!Array.isArray(input.items) || input.items.length > contract.items.max || (complete && input.items.length < contract.items.min)) bad(complete ? "A pack needs 3 to 12 stickers." : "A pack holds up to 12 stickers.");
  const keys = new Set<string>();
  const items = input.items.map((i: any): Item => {
    if (!validId(i?.key) || keys.has(i.key)) bad("Each sticker needs its own key.");
    keys.add(i.key);
    if (!text(i.name, contract.titleChars, !complete)) bad("Name each sticker in up to 40 characters.");
    if (!contract.rarities.includes(i.rarity)) bad("Rarity is common, uncommon or rare.");
    const weight = i.weight ?? null;
    if (weight !== null && (!Number.isSafeInteger(weight) || weight < contract.weight.min || weight > contract.weight.max)) bad("Weights are 1 to 100.");
    return { key: i.key, name: i.name.trim(), rarity: i.rarity, weight };
  });
  return { packId: input.packId, version: input.version, title: input.title.trim(), by: input.by.trim(), blurb: (input.blurb ?? "").trim(), pouch: input.pouch, color, price: input.price, items };
}

/** pack.json as peta-pass reads it (optional fields left out when unset). */
export function packJson(m: Manifest) {
  return { packId: m.packId, version: m.version, title: m.title, by: m.by, blurb: m.blurb, pouch: m.pouch, ...(m.color ? { color: m.color } : {}), price: m.price,
    items: m.items.map(i => ({ key: i.key, name: i.name, rarity: i.rarity, ...(i.weight !== null ? { weight: i.weight } : {}) })) };
}

/** Width, height and whether a PNG can be transparent, from its header; null when it is not a PNG. Pixels are checked on the
   owner's Mac (peta-pass) before signing, and by every app after. */
export function pngInfo(bytes: Uint8Array): { width: number; height: number; alpha: boolean } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), type = (at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8));
  if (type(8) !== "IHDR") return null;
  const width = view.getUint32(16), height = view.getUint32(20), colorType = bytes[25];
  let alpha = colorType === 4 || colorType === 6;
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at), t = type(at);
    if (t === "tRNS") alpha = true;
    if (t === "IDAT" || t === "IEND") break;
    at += 12 + length;
  }
  return width > 0 && height > 0 ? { width, height, alpha } : null;
}

const sale = (r: any, t: number) => r.removed_at !== null ? "removed" : r.stopped_at !== null ? "stopped" : r.starts_at === null ? "signed" : t < r.starts_at ? "scheduled" : r.ends_at !== null && t >= r.ends_at ? "ended" : "on sale";
async function pictures(env: Env, draftId: string) {
  const listed = await env.RELEASES.list({ prefix: draftObject(draftId, "") });
  return listed.objects.filter(o => o.key.endsWith(".png")).map(o => ({ key: o.key.slice(draftObject(draftId, "").length, -4), size: o.size }));
}
async function draft(env: Env, draftId: unknown) {
  if (typeof draftId !== "string" || !DRAFT_ID.test(draftId)) fail(404, "not_found", "That draft wasn't found.");
  const row = await env.DB.prepare("SELECT * FROM shop_pack_drafts WHERE draft_id=?").bind(draftId).first<any>();
  if (!row) fail(404, "not_found", "That draft wasn't found.");
  return { ...row, manifest: JSON.parse(row.manifest) as Manifest };
}
const command = (env: Env, draftId: string) => `bash scripts/sign-pack.sh ${draftId} ${env.PETA_ENV === "prod" ? "prod" : "dev"}`;
const newDraftId = () => "d-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
async function nextVersion(env: Env, packId: string) {
  const row = await env.DB.prepare("SELECT MAX(v) v FROM (SELECT version v FROM shop_packs WHERE pack_id=?1 UNION ALL SELECT version v FROM shop_pack_drafts WHERE pack_id=?1 AND state!='discarded')").bind(packId).first<{ v: number | null }>();
  return (row?.v ?? 0) + 1;
}
async function limitDrafts(env: Env) {
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM shop_pack_drafts WHERE state IN ('draft','ready')").first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_DRAFTS) fail(409, "limit", "Discard a draft before starting another.");
}

/** JSON routes under /api/packs. */
export async function packs(request: Request, env: Env, path: string, actor: string, data: any): Promise<Response | null> {
  if (path !== "/api/packs" && !path.startsWith("/api/packs/")) return null;
  const t = now();
  if (request.method === "GET" && path === "/api/packs") {
    const drafts = (await env.DB.prepare("SELECT * FROM shop_pack_drafts WHERE state IN ('draft','ready') ORDER BY updated_at DESC LIMIT ?").bind(MAX_DRAFTS).all<any>()).results;
    const signed = (await env.DB.prepare("SELECT * FROM shop_packs ORDER BY pack_id, version DESC").all<any>()).results;
    const stored = await env.RELEASES.list({ prefix: "shop/" });
    return api({
      contract, maxLive: MAX_LIVE,
      drafts: await Promise.all(drafts.map(async d => ({ draftId: d.draft_id, packId: d.pack_id, version: d.version, state: d.state, manifest: JSON.parse(d.manifest), pictures: await pictures(env, d.draft_id), updatedAt: d.updated_at, command: d.state === "ready" ? command(env, d.draft_id) : null }))),
      packs: signed.map(r => ({ packId: r.pack_id, version: r.version, title: r.title, price: r.price, size: r.size, sha256: r.sha256, keyId: r.key_id, startsAt: r.starts_at, endsAt: r.ends_at, stoppedAt: r.stopped_at, removedAt: r.removed_at, createdAt: r.created_at, state: sale(r, t) })),
      storage: { objects: stored.objects.length, bytes: stored.objects.reduce((n, o) => n + o.size, 0), truncated: stored.truncated },
    });
  }
  if (request.method !== "POST") fail(405, "method_not_allowed", "This action is not available.");

  if (path === "/api/packs/drafts") {
    await limitDrafts(env);
    let manifest: Manifest;
    if (typeof data?.fromPackId === "string") {
      // A new version of a signed pack: the same ID, the next version, starting from the newest signed contents.
      const latest = await env.DB.prepare("SELECT d.manifest FROM shop_packs s LEFT JOIN shop_pack_drafts d ON d.draft_id=s.draft_id WHERE s.pack_id=? ORDER BY s.version DESC LIMIT 1").bind(data.fromPackId).first<{ manifest: string | null }>();
      if (!latest) fail(404, "not_found", "That pack wasn't found.");
      manifest = { ...(latest.manifest ? JSON.parse(latest.manifest) : { title: "", by: "Peta", blurb: "", pouch: "kraft", color: null, price: 12, items: [] }), packId: data.fromPackId, version: await nextVersion(env, data.fromPackId) };
    } else {
      if (!validId(data?.packId) || contract.builtInIds.includes(data.packId)) fail(400, "invalid", "Pack IDs use letters, numbers, - and _ (up to 40), and never a built-in pack's ID.");
      if (await nextVersion(env, data.packId) !== 1) fail(409, "exists", "That ID is already used. Make a new version of that pack instead.");
      manifest = { packId: data.packId, version: 1, title: "", by: "Peta", blurb: "", pouch: "kraft", color: null, price: 12, items: [] };
    }
    const draftId = newDraftId(), checked = checkManifest(manifest, false);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shop_pack_drafts VALUES(?,?,?,'draft',?,?,?)").bind(draftId, checked.packId, checked.version, JSON.stringify(checked), t, t),
      audit(env.DB, actor, "packs.draft_created", { draftId, packId: checked.packId, version: checked.version }),
    ]);
    // Pictures of the version it starts from, when they are still kept.
    if (typeof data?.fromPackId === "string") {
      const from = await env.DB.prepare("SELECT draft_id FROM shop_packs WHERE pack_id=? ORDER BY version DESC LIMIT 1").bind(data.fromPackId).first<{ draft_id: string | null }>();
      if (from?.draft_id) await copyPictures(env, from.draft_id, draftId, checked.items.map(i => i.key));
    }
    return api({ draftId }, 201);
  }
  if (path === "/api/packs/drafts/save") {
    const d = await draft(env, data?.draftId);
    if (d.state !== "draft") fail(409, "not_draft", "Only a draft can change. Duplicate it to make changes.");
    const m = checkManifest({ ...data.manifest, packId: d.pack_id, version: d.version }, false);
    // Pictures of stickers taken out of the pack leave with them.
    const keep = new Set(m.items.map(i => i.key));
    const gone = (await pictures(env, d.draft_id)).filter(p => !keep.has(p.key)).map(p => draftObject(d.draft_id, `${p.key}.png`));
    if (gone.length) await env.RELEASES.delete(gone);
    await env.DB.prepare("UPDATE shop_pack_drafts SET manifest=?,updated_at=? WHERE draft_id=? AND state='draft'").bind(JSON.stringify(m), t, d.draft_id).run();
    return api({ saved: true });
  }
  if (path === "/api/packs/drafts/ready") {
    const d = await draft(env, data?.draftId);
    if (d.state !== "draft") fail(409, "not_draft", "This draft is not open for changes.");
    const m = checkManifest(d.manifest, true), have = await pictures(env, d.draft_id);
    const missing = m.items.filter(i => !have.some(p => p.key === i.key)).map(i => i.name || i.key);
    if (missing.length) fail(400, "missing_pictures", `Add a picture for ${missing.join(", ")}.`);
    if (have.filter(p => m.items.some(i => i.key === p.key)).reduce((n, p) => n + p.size, 0) > contract.totalBytes) fail(400, "too_large", "The pictures are more than 12 MB together.");
    const signedNewer = await env.DB.prepare("SELECT 1 FROM shop_packs WHERE pack_id=? AND version>=?").bind(m.packId, m.version).first();
    if (signedNewer) fail(409, "stale", "A newer version of this pack is already signed. Make a new version instead.");
    await env.RELEASES.put(draftObject(d.draft_id, "pack.json"), JSON.stringify(packJson(m), null, 2) + "\n", { httpMetadata: { contentType: "application/json" } });
    await env.DB.batch([
      env.DB.prepare("UPDATE shop_pack_drafts SET state='ready',manifest=?,updated_at=? WHERE draft_id=? AND state='draft'").bind(JSON.stringify(m), t, d.draft_id),
      audit(env.DB, actor, "packs.draft_ready", { draftId: d.draft_id, packId: m.packId, version: m.version }),
    ]);
    return api({ command: command(env, d.draft_id) });
  }
  if (path === "/api/packs/drafts/discard") {
    const d = await draft(env, data?.draftId);
    if (!["draft", "ready"].includes(d.state)) fail(409, "not_draft", "This draft can't be discarded.");
    await env.DB.batch([
      env.DB.prepare("UPDATE shop_pack_drafts SET state='discarded',updated_at=? WHERE draft_id=? AND state IN ('draft','ready')").bind(t, d.draft_id),
      audit(env.DB, actor, "packs.draft_discarded", { draftId: d.draft_id }),
    ]);
    return api({ discarded: true });
  }
  if (path === "/api/packs/drafts/duplicate") {
    const d = await draft(env, data?.draftId);
    await limitDrafts(env);
    const signed = await env.DB.prepare("SELECT 1 FROM shop_packs WHERE pack_id=? AND version>=?").bind(d.pack_id, d.version).first();
    const version = signed || d.state === "signed" ? await nextVersion(env, d.pack_id) : d.version;
    const draftId = newDraftId(), m = { ...d.manifest, version };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shop_pack_drafts VALUES(?,?,?,'draft',?,?,?)").bind(draftId, d.pack_id, version, JSON.stringify(m), t, t),
      audit(env.DB, actor, "packs.draft_created", { draftId, packId: d.pack_id, version, from: d.draft_id }),
    ]);
    await copyPictures(env, d.draft_id, draftId, m.items.map((i: Item) => i.key));
    return api({ draftId }, 201);
  }
  if (path === "/api/packs/publish") {
    const row = await signedRow(env, data);
    if (row.removed_at !== null || row.stopped_at !== null) fail(409, "stopped", "A stopped pack can't be put back on sale. Make a new version.");
    const start = data.startsAt, end = data.endsAt ?? null;
    if (!Number.isSafeInteger(start) || start < 0 || (end !== null && (!Number.isSafeInteger(end) || end <= start || end <= t)))
      fail(400, "invalid", "Choose a start, and an end after the start and after now (or no end).");
    const others = await env.DB.prepare("SELECT COUNT(DISTINCT pack_id) n FROM shop_packs WHERE pack_id!=? AND starts_at IS NOT NULL AND stopped_at IS NULL AND removed_at IS NULL AND (ends_at IS NULL OR ends_at>?)").bind(row.pack_id, t).first<{ n: number }>();
    if ((others?.n ?? 0) >= MAX_LIVE) fail(409, "limit", `At most ${MAX_LIVE} packs can be on sale or scheduled. Stop or end one first.`);
    await env.DB.batch([
      env.DB.prepare("UPDATE shop_packs SET starts_at=?,ends_at=? WHERE pack_id=? AND version=?").bind(start, end, row.pack_id, row.version),
      audit(env.DB, actor, "packs.published", { packId: row.pack_id, version: row.version, startsAt: start, endsAt: end }),
    ]);
    return api({ published: true });
  }
  if (path === "/api/packs/stop") {
    const row = await signedRow(env, data);
    await env.DB.batch([
      env.DB.prepare("UPDATE shop_packs SET stopped_at=COALESCE(stopped_at,?) WHERE pack_id=? AND version=?").bind(t, row.pack_id, row.version),
      audit(env.DB, actor, "packs.stopped", { packId: row.pack_id, version: row.version }),
    ]);
    return api({ stopped: true });
  }
  if (path === "/api/packs/cleanup") {
    if (data?.confirm !== true) fail(400, "invalid", "Confirm the clean-up first.");
    // Old versions: a newer version of the same pack exists, and this one is not on sale or scheduled.
    const rows = (await env.DB.prepare("SELECT * FROM shop_packs s WHERE removed_at IS NULL AND EXISTS(SELECT 1 FROM shop_packs n WHERE n.pack_id=s.pack_id AND n.version>s.version)").all<any>()).results
      .filter(r => !["on sale", "scheduled"].includes(sale(r, t)));
    const drafts = (await env.DB.prepare("SELECT draft_id FROM shop_pack_drafts WHERE state IN ('discarded','signed')").all<{ draft_id: string }>()).results;
    let bytes = 0, objects: string[] = [];
    for (const r of rows) { objects.push(r.file); bytes += r.size; }
    for (const d of drafts) for (const o of (await env.RELEASES.list({ prefix: draftObject(d.draft_id, "") })).objects) { objects.push(o.key); bytes += o.size; }
    objects = objects.filter(k => k.startsWith("shop/"));
    for (let i = 0; i < objects.length; i += 1000) await env.RELEASES.delete(objects.slice(i, i + 1000));
    await env.DB.batch([
      ...rows.map(r => env.DB.prepare("UPDATE shop_packs SET removed_at=? WHERE pack_id=? AND version=?").bind(t, r.pack_id, r.version)),
      audit(env.DB, actor, "packs.cleaned", { versions: rows.length, drafts: drafts.length, bytes }),
    ]);
    return api({ versions: rows.length, objects: objects.length, bytes });
  }
  return api({ error: "not_found" }, 404);
}
async function signedRow(env: Env, data: any) {
  if (!validId(data?.packId) || !Number.isSafeInteger(data?.version)) fail(404, "not_found", "That pack wasn't found.");
  const row = await env.DB.prepare("SELECT * FROM shop_packs WHERE pack_id=? AND version=?").bind(data.packId, data.version).first<any>();
  if (!row) fail(404, "not_found", "That pack wasn't found.");
  return row;
}
async function copyPictures(env: Env, from: string, to: string, keys: string[]) {
  for (const key of keys) {
    const object = await env.RELEASES.get(draftObject(from, `${key}.png`));
    if (object) await env.RELEASES.put(draftObject(to, `${key}.png`), await object.arrayBuffer(), { httpMetadata: { contentType: "image/png" } });
  }
}

/** Binary routes: a draft's pictures (GET, PUT) and a signed file (GET) for the page to show. */
export async function packFiles(request: Request, env: Env, path: string, actor: () => Promise<string>, lock: (work: () => Promise<Response>) => Promise<Response>): Promise<Response | null> {
  const picture = /^\/api\/packs\/drafts\/(d-[a-f0-9]{16})\/pictures\/([A-Za-z0-9][A-Za-z0-9_-]{0,39})$/.exec(path);
  const file = /^\/api\/packs\/file\/([A-Za-z0-9][A-Za-z0-9_-]{0,39})\/([1-9][0-9]{0,8})$/.exec(path);
  if (!picture && !file) return null;
  const headers = (type: string, size: number) => ({ "Content-Type": type, "Content-Length": String(size), "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment" });
  if (file) {
    if (request.method !== "GET") fail(405, "method_not_allowed", "This action is not available.");
    const row = await env.DB.prepare("SELECT file,size FROM shop_packs WHERE pack_id=? AND version=? AND removed_at IS NULL").bind(file[1], Number(file[2])).first<{ file: string; size: number }>();
    const object = row && row.file.startsWith("shop/") ? await env.RELEASES.get(row.file) : null;
    if (!object) fail(404, "not_found", "That file isn't kept any more.");
    return new Response(object.body, { headers: headers("application/octet-stream", object.size) });
  }
  const [, draftId, key] = picture!;
  if (request.method === "GET") {
    const object = await env.RELEASES.get(draftObject(draftId, `${key}.png`));
    if (!object) fail(404, "not_found", "That picture wasn't found.");
    return new Response(object.body, { headers: headers("image/png", object.size) });
  }
  if (request.method !== "PUT") fail(405, "method_not_allowed", "This action is not available.");
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin || request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "image/png")
    fail(403, "forbidden", "Refresh this page and try again.");
  if (Number(request.headers.get("Content-Length")) > contract.picture.maxBytes) fail(413, "too_large", "Each picture is at most 1.5 MB.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > contract.picture.maxBytes) fail(413, "too_large", "Each picture is at most 1.5 MB.");
  const info = pngInfo(bytes);
  if (!info) fail(400, "invalid", "Pictures are PNG files.");
  if (Math.max(info.width, info.height) > contract.picture.maxEdge) fail(400, "invalid", "Pictures are at most 1024 px on their long side.");
  if (!info.alpha) fail(400, "invalid", "Pictures need a transparent background.");
  return lock(async () => {
    const d = await draft(env, draftId);
    if (d.state !== "draft") fail(409, "not_draft", "Only a draft can change. Duplicate it to make changes.");
    const others = (await pictures(env, draftId)).filter(p => p.key !== key);
    if (others.length >= contract.items.max) fail(400, "too_many", "A pack holds up to 12 stickers.");
    if (others.reduce((n, p) => n + p.size, 0) + bytes.length > contract.totalBytes) fail(400, "too_large", "The pictures are more than 12 MB together.");
    await env.RELEASES.put(draftObject(draftId, `${key}.png`), bytes, { httpMetadata: { contentType: "image/png" } });
    await env.DB.batch([
      env.DB.prepare("UPDATE shop_pack_drafts SET updated_at=? WHERE draft_id=?").bind(now(), draftId),
      audit(env.DB, await actor(), "packs.picture_added", { draftId, key, size: bytes.length }),
    ]);
    return api({ saved: true, size: bytes.length });
  });
}

/** Signed shop packs the shop setting may name (`shop:<packId>`), with the newest signed price. */
export async function signedForShop(env: Env): Promise<{ id: string; title: string; price: number; free: false; shop: true }[]> {
  const rows = (await env.DB.prepare("SELECT pack_id,title,price FROM shop_packs s WHERE removed_at IS NULL AND version=(SELECT MAX(version) FROM shop_packs n WHERE n.pack_id=s.pack_id AND n.removed_at IS NULL) ORDER BY pack_id LIMIT ?").bind(MAX_LIVE * 2).all<any>()).results;
  return rows.map(r => ({ id: `shop:${r.pack_id}`, title: r.title, price: r.price, free: false as const, shop: true as const }));
}
