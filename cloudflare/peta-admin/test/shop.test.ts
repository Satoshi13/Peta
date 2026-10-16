import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, req, post, jwt } from "./helpers";
import vector from "./config-vector.json";
import { readEvent } from "../src/bundle";
import { signShop, priceRange, type Shop } from "../src/settings";
const secret = btoa(String.fromCharCode(...Uint8Array.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60".match(/../g)!, x => parseInt(x, 16))));
const use = { ...base, COUPON_KEY_ID: "c1", COUPON_SIGNING_KEY: secret, COUPON_PUBLIC_KEY: vector.publicKey };
beforeAll(setup); beforeEach(clear);
const now = () => Math.floor(Date.now() / 1000);
const pack = (id: string, over: Record<string, unknown> = {}) => ({ id, onSale: true, price: null, blurb: null, ...over });
const setting = (over: Record<string, unknown> = {}) => ({ kind: "default", featured: ["pixel"], officialFirst: false, order: ["night", "pixel"], packs: [pack("pixel", { price: 15, blurb: "Late-night glow." })], ...over });
it("matches the Rust shop contract byte for byte", async () => {
  expect(await signShop(vector.shop as Shop, vector.keyId, secret, vector.publicKey)).toBe(vector.shopEvent);
  expect(priceRange("pixel")).toEqual([6, 24]); expect(priceRange("tokyo")).toBeNull();
});
it("only the owner can save; the standing setting replaces the last one and is signed with sorted keys", async () => {
  expect((await req("/api/shop", {}, use, await jwt({ email: "friend@example.com" }))).status).toBe(403);
  expect((await post("/api/shop", setting(), use)).status).toBe(201);
  expect((await post("/api/shop", setting({ officialFirst: true }), use)).status).toBe(201);
  const rows = (await base.DB.prepare("SELECT * FROM signed_configs ORDER BY created_at,rowid").all<any>()).results;
  expect(rows.map(r => r.stopped_at === null)).toEqual([false, true]);
  const event = readEvent(rows[1].event)!;
  expect(event).toMatchObject({ kind: "shop_config", eventId: rows[1].id, title: "Shop" });
  expect(Object.keys(event.payload)).toEqual(["configId", "configKind", "featured", "officialFirst", "order", "packs"]);
  expect(event.payload.packs).toEqual([{ blurb: "Late-night glow.", id: "pixel", onSale: true, price: 15 }]);
  expect(rows[1].ends_at - rows[1].starts_at).toBe(400 * 86400);
  const list = await (await req("/api/shop", {}, use)).json<any>();
  expect(list.catalog.packs).toHaveLength(6); expect(list.configs[0]).toMatchObject({ state: "active", officialFirst: true, kind: "default" });
  expect((await base.DB.prepare("SELECT COUNT(*) n FROM admin_log WHERE action='shop.created'").first<any>()).n).toBe(2);
});
it("keeps prices within half to double, never prices a free pack, and checks every field", async () => {
  for (const bad of [setting({ packs: [pack("pixel", { price: 5 })] }), setting({ packs: [pack("pixel", { price: 25 })] }), setting({ packs: [pack("tokyo", { price: 8 })] }),
    setting({ packs: [pack("pixel", { price: 12.5 })] }), setting({ packs: [pack("pixel", { blurb: "x".repeat(121) })] }), setting({ packs: [pack("pixel"), pack("pixel")] }),
    setting({ featured: ["mystery"] }), setting({ order: ["night", "night"] }), setting({ officialFirst: "yes" }), setting({ packs: [{ id: "pixel", price: 10 }] }),
    setting({ kind: "event", startsAt: now(), endsAt: now() - 1 }), setting({ kind: "event", startsAt: now(), endsAt: now() + 401 * 86400 })])
    expect((await post("/api/shop", bad, use)).status).toBe(400);
  expect((await base.DB.prepare("SELECT COUNT(*) n FROM signed_configs").first<any>()).n).toBe(0);
  expect((await post("/api/shop", setting({ packs: [pack("pixel", { price: 6 }), pack("night", { price: 24 }), pack("tokyo", { onSale: false, blurb: "Back soon." })] }), use)).status).toBe(201);
});
it("schedules a setting for a period and stops it", async () => {
  expect((await post("/api/shop", setting({ kind: "event", startsAt: now() + 60, endsAt: now() + 7 * 86400 }), use)).status).toBe(201);
  const id = (await base.DB.prepare("SELECT id FROM signed_configs").first<any>()).id;
  expect((await (await req("/api/shop", {}, use)).json<any>()).configs[0].state).toBe("scheduled");
  expect((await post("/api/shop/stop", { id: "nope" }, use)).status).toBe(404);
  expect((await post("/api/shop/stop", { id }, use)).status).toBe(200);
  expect((await (await req("/api/shop", {}, use)).json<any>()).configs[0].state).toBe("stopped");
});
