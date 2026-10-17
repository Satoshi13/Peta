import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, req, post, jwt, ORIGIN } from "./helpers";
import { png } from "./png";
import { pngInfo } from "../src/packs";
import contract from "../../shared/shop-pack-contract.json";
import vector from "./config-vector.json";

const secret = btoa(String.fromCharCode(...Uint8Array.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60".match(/../g)!, x => parseInt(x, 16))));
const use = { ...base, COUPON_KEY_ID: "c1", COUPON_SIGNING_KEY: secret, COUPON_PUBLIC_KEY: vector.publicKey, PETA_ENV: "dev" };
const bucket = base.RELEASES;
const now = () => Math.floor(Date.now() / 1000);
beforeAll(setup);
beforeEach(async () => {
  await clear();
  await base.DB.batch(["shop_pack_drafts", "shop_packs"].map(t => base.DB.prepare(`DELETE FROM ${t}`)));
  const listed = await bucket.list({ prefix: "shop/" });
  if (listed.objects.length) await bucket.delete(listed.objects.map(o => o.key));
});
const put = async (draftId: string, key: string, bytes: Uint8Array, headers: Record<string, string> = {}) =>
  req(`/api/packs/drafts/${draftId}/pictures/${key}`, { method: "PUT", headers: { Origin: ORIGIN, "Content-Type": "image/png", ...headers }, body: bytes }, use);
const list = async () => (await (await req("/api/packs", {}, use)).json()) as any;
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `s${i}`, name: `Sticker ${i}`, rarity: contract.rarities[i % 3], weight: i === 0 ? 7 : null }));
const manifest = (over: Record<string, unknown> = {}) => ({ title: "Autumn Walk", by: "Peta", blurb: "Leaves on the way home.", pouch: "matte", color: "rose", price: 12, items: items(3), ...over });
async function newDraft(packId = "autumn") {
  const r = await post("/api/packs/drafts", { packId }, use); expect(r.status).toBe(201); return ((await r.json()) as any).draftId as string;
}
async function readyDraft(packId = "autumn") {
  const id = await newDraft(packId);
  expect((await post("/api/packs/drafts/save", { draftId: id, manifest: manifest() }, use)).status).toBe(200);
  for (const i of items(3)) expect((await put(id, i.key, await png(64, 48))).status).toBe(200);
  expect((await post("/api/packs/drafts/ready", { draftId: id }, use)).status).toBe(200);
  return id;
}
async function signed(packId: string, version: number, draftId: string | null, period: { starts?: number | null; ends?: number | null } = {}) {
  await bucket.put(`shop/${packId}/${version}.peta`, `signed ${packId} ${version}`);
  await base.DB.prepare("INSERT INTO shop_packs(pack_id,version,title,file,size,sha256,price,starts_at,ends_at,created_at,draft_id,key_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'k1')")
    .bind(packId, version, "Autumn Walk", `shop/${packId}/${version}.peta`, `signed ${packId} ${version}`.length, "ab".repeat(32), 12, period.starts ?? null, period.ends ?? null, now(), draftId).run();
  if (draftId) await base.DB.prepare("UPDATE shop_pack_drafts SET state='signed' WHERE draft_id=?").bind(draftId).run();
}

it("reads PNG headers: size and whether the picture can be transparent", async () => {
  expect(pngInfo(await png(30, 20))).toEqual({ width: 30, height: 20, alpha: true });
  expect(pngInfo(await png(30, 20, false))).toEqual({ width: 30, height: 20, alpha: false });
  expect(pngInfo(new TextEncoder().encode("not a png at all, really not"))).toBeNull();
});

it("only the owner starts drafts, never with a built-in or used ID", async () => {
  expect((await req("/api/packs", {}, use, await jwt({ email: "friend@example.com" }))).status).toBe(403);
  await newDraft("autumn");
  for (const packId of ["tokyo", "a.b", "-a", "x".repeat(41), "autumn"]) expect((await post("/api/packs/drafts", { packId }, use)).status).not.toBe(201);
  const data = await list();
  expect(data.drafts).toHaveLength(1);
  expect(data.drafts[0]).toMatchObject({ packId: "autumn", version: 1, state: "draft", command: null });
  expect(data.contract.price).toEqual({ min: 4, max: 40 });
});

it("checks every field and every picture before keeping them", async () => {
  const id = await newDraft();
  for (const bad of [manifest({ pouch: "cotton" }), manifest({ pouch: "kraft", color: "mint" }), manifest({ price: 3 }), manifest({ price: 41 }), manifest({ items: items(13) }),
    manifest({ items: [...items(2), { key: "s0", name: "Twin", rarity: "common" }] }), manifest({ items: [{ key: "s0", name: "x", rarity: "special" }] }), manifest({ items: [{ key: "s0", name: "x", rarity: "rare", weight: 101 }] }),
    manifest({ blurb: "x".repeat(121) }), manifest({ title: "x".repeat(41) })])
    expect((await post("/api/packs/drafts/save", { draftId: id, manifest: bad }, use)).status).toBe(400);
  // A draft may be unfinished: no title, fewer than three stickers.
  expect((await post("/api/packs/drafts/save", { draftId: id, manifest: manifest({ title: "", items: items(1) }) }, use)).status).toBe(200);
  expect((await put(id, "s0", new TextEncoder().encode("GIF89a"))).status).toBe(400);
  expect((await put(id, "s0", await png(32, 32, false))).status).toBe(400);
  expect((await put(id, "s0", await png(1100, 10))).status).toBe(400);
  expect((await put(id, "s0", await png(32, 32), { Origin: "https://elsewhere.test" })).status).toBe(403);
  expect((await put(id, "s0", await png(32, 32), { "Content-Type": "application/json" })).status).toBe(403);
  const ok = await png(32, 32);
  expect((await put(id, "s0", ok)).status).toBe(200);
  const back = await req(`/api/packs/drafts/${id}/pictures/s0`, {}, use);
  expect(back.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await back.arrayBuffer())).toEqual(ok);
  // Taking a sticker out removes its picture.
  expect((await post("/api/packs/drafts/save", { draftId: id, manifest: manifest({ items: [] }) }, use)).status).toBe(200);
  expect((await list()).drafts[0].pictures).toEqual([]);
});

it("a ready draft is complete, frozen, and shows the command to sign it on the Mac", async () => {
  const id = await newDraft();
  await post("/api/packs/drafts/save", { draftId: id, manifest: manifest() }, use);
  await put(id, "s0", await png(40, 40));
  const missing = await post("/api/packs/drafts/ready", { draftId: id }, use);
  expect(missing.status).toBe(400); expect(((await missing.json()) as any).message).toContain("Sticker 1");
  for (const key of ["s1", "s2"]) await put(id, key, await png(40, 40));
  const ready = await post("/api/packs/drafts/ready", { draftId: id }, use);
  expect(ready.status).toBe(200);
  expect(((await ready.json()) as any).command).toBe(`bash scripts/sign-pack.sh ${id} dev`);
  const json = JSON.parse(await (await bucket.get(`shop/drafts/${id}/pack.json`))!.text());
  expect(json).toEqual({ packId: "autumn", version: 1, title: "Autumn Walk", by: "Peta", blurb: "Leaves on the way home.", pouch: "matte", color: "rose", price: 12,
    items: [{ key: "s0", name: "Sticker 0", rarity: "common", weight: 7 }, { key: "s1", name: "Sticker 1", rarity: "uncommon" }, { key: "s2", name: "Sticker 2", rarity: "rare" }] });
  expect((await post("/api/packs/drafts/save", { draftId: id, manifest: manifest({ title: "Changed" }) }, use)).status).toBe(409);
  expect((await put(id, "s0", await png(40, 40))).status).toBe(409);
  // To change it, duplicate it: the same version, the same pictures, open for changes.
  const copy = ((await (await post("/api/packs/drafts/duplicate", { draftId: id }, use)).json()) as any).draftId;
  const drafts = (await list()).drafts;
  expect(drafts.find((d: any) => d.draftId === copy)).toMatchObject({ version: 1, state: "draft" });
  expect(drafts.find((d: any) => d.draftId === copy).pictures.map((p: any) => p.key).sort()).toEqual(["s0", "s1", "s2"]);
  expect((await post("/api/packs/drafts/discard", { draftId: id }, use)).status).toBe(200);
  expect((await list()).drafts.map((d: any) => d.draftId)).toEqual([copy]);
});

it("puts a signed pack on sale for a period, stops it, and starts the next version from it", async () => {
  const id = await readyDraft();
  await signed("autumn", 1, id);
  expect((await list()).packs[0]).toMatchObject({ packId: "autumn", version: 1, state: "signed", price: 12 });
  expect((await post("/api/packs/publish", { packId: "autumn", version: 1, startsAt: now(), endsAt: now() - 1 }, use)).status).toBe(400);
  expect((await post("/api/packs/publish", { packId: "autumn", version: 9, startsAt: now() }, use)).status).toBe(404);
  // The owner can end a sale immediately by moving its end into the past.
  expect((await post("/api/packs/publish", { packId: "autumn", version: 1, startsAt: now() - 60, endsAt: now() - 1 }, use)).status).toBe(200);
  expect((await list()).packs[0].state).toBe("ended");
  expect((await post("/api/packs/publish", { packId: "autumn", version: 1, startsAt: now() - 60, endsAt: null }, use)).status).toBe(200);
  expect((await list()).packs[0].state).toBe("on sale");
  expect((await post("/api/packs/publish", { packId: "autumn", version: 1, startsAt: now() + 3600, endsAt: now() + 7200 }, use)).status).toBe(200);
  expect((await list()).packs[0].state).toBe("scheduled");
  const file = await req("/api/packs/file/autumn/1", {}, use);
  expect(await file.text()).toBe("signed autumn 1");
  expect((await post("/api/packs/stop", { packId: "autumn", version: 1 }, use)).status).toBe(200);
  expect((await list()).packs[0].state).toBe("stopped");
  expect((await post("/api/packs/publish", { packId: "autumn", version: 1, startsAt: now() }, use)).status).toBe(409);
  const next = ((await (await post("/api/packs/drafts", { fromPackId: "autumn" }, use)).json()) as any).draftId;
  const d = (await list()).drafts.find((x: any) => x.draftId === next);
  expect(d).toMatchObject({ packId: "autumn", version: 2, state: "draft" });
  expect(d.manifest.title).toBe("Autumn Walk");
  expect(d.pictures).toHaveLength(3);
  const log = (await base.DB.prepare("SELECT action FROM admin_log ORDER BY rowid").all<any>()).results.map(r => r.action);
  expect(log).toEqual(expect.arrayContaining(["packs.draft_created", "packs.draft_ready", "packs.published", "packs.stopped"]));
});

it("never puts more than 24 packs on sale or scheduled at once", async () => {
  for (let i = 0; i < 24; i++) await signed(`p${i}`, 1, null, { starts: now() - 60 });
  await signed("one-more", 1, null);
  expect((await post("/api/packs/publish", { packId: "one-more", version: 1, startsAt: now() }, use)).status).toBe(409);
  await base.DB.prepare("UPDATE shop_packs SET ends_at=? WHERE pack_id='p0'").bind(now() - 1).run();
  expect((await post("/api/packs/publish", { packId: "one-more", version: 1, startsAt: now() }, use)).status).toBe(200);
});

it("lets the shop setting feature and price signed shop packs within half to double of their price", async () => {
  await signed("autumn", 1, null, { starts: now() - 60 });
  const shop = await (await req("/api/shop", {}, use)).json() as any;
  expect(shop.catalog.packs.at(-1)).toEqual({ id: "shop:autumn", title: "Autumn Walk", price: 12, free: false, shop: true });
  const setting = (price: number | null) => ({ kind: "default", featured: ["shop:autumn", "pixel"], officialFirst: true, order: ["shop:autumn", "night"], packs: [{ id: "shop:autumn", onSale: true, price, blurb: "Leaves." }] });
  for (const price of [5, 25]) expect((await post("/api/shop", setting(price), use)).status).toBe(400);
  expect((await post("/api/shop", { ...setting(null), featured: ["shop:winter"] }, use)).status).toBe(400);
  expect((await post("/api/shop", { ...setting(null), featured: ["tokyo", "coffee", "plants", "pixel", "cats", "night", "shop:autumn"] }, use)).status).toBe(400);
  expect((await post("/api/shop", setting(24), use)).status).toBe(201);
});

it("cleans up old versions no longer sold and discarded drafts, after confirmation, and keeps what is on sale", async () => {
  await signed("autumn", 1, null, { starts: now() - 7200, ends: now() - 60 });
  await signed("autumn", 2, null, { starts: now() - 60 });
  await signed("winter", 1, null);
  const id = await newDraft("spring");
  await put(id, "s0", await png(32, 32));
  await post("/api/packs/drafts/discard", { draftId: id }, use);
  expect((await post("/api/packs/cleanup", {}, use)).status).toBe(400);
  const done = (await (await post("/api/packs/cleanup", { confirm: true }, use)).json()) as any;
  expect(done).toMatchObject({ versions: 1, objects: 2 });
  expect(await bucket.get("shop/autumn/1.peta")).toBeNull();
  expect(await bucket.get("shop/autumn/2.peta")).not.toBeNull();
  expect(await bucket.get("shop/winter/1.peta")).not.toBeNull();
  expect(await bucket.get(`shop/drafts/${id}/s0.png`)).toBeNull();
  const packs = (await list()).packs;
  expect(packs.find((p: any) => p.packId === "autumn" && p.version === 1).state).toBe("removed");
  expect((await req("/api/packs/file/autumn/1", {}, use)).status).toBe(404);
});
