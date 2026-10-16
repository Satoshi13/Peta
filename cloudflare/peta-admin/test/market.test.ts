import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, req, jwt } from "./helpers";
beforeAll(setup); beforeEach(clear);
const SELLER_A = "a".repeat(64), SELLER_B = "b".repeat(64), BUYER = "c".repeat(64), KEY_A = "key-a", KEY_B = "key-b";
async function listing(id: string, seller: string, key: string, state: string) {
  await base.DB.prepare("INSERT INTO packs VALUES(?,?,?,?,?,?)").bind(`pack-${id}`, key, 6, "d".repeat(64), "e".repeat(64), 0).run();
  await base.DB.prepare("INSERT INTO market_listings VALUES(?,?,?,?,6,700,?,?,1,?,1,0,0)").bind(id, `pack-${id}`, key, seller, state, "f".repeat(64), "f".repeat(64)).run();
}
let n = 0;
const sale = (id: string, key: string, at: number) => base.DB.prepare("INSERT INTO market_sales(listing_id,pack_id,slot_no,pull_id,buyer_hash,seller_key,price,cut_milli,at) VALUES(?,?,?,?,?,?,6,4200,?)").bind(id, `pack-${id}`, n++, `pull-${n}`, BUYER, key, at).run();
it("is for the owner only and shows zeros when nothing has happened", async () => {
  expect((await req("/api/market", {}, base, await jwt({ email: "friend@example.com" }))).status).toBe(403);
  const d = await (await req("/api/market")).json<any>();
  expect(d).toMatchObject({ openListings: 0, sellers: 0, allTime: { pulls: 0, scraps: 0, sellerMilli: 0 } });
  expect(d.daily).toHaveLength(30); expect(d.daily.every((x: any) => x.pulls === 0 && x.scraps === 0)).toBe(true);
});
it("counts listings, sellers and daily pulls without naming anyone", async () => {
  await listing("L1", SELLER_A, KEY_A, "open"); await listing("L2", SELLER_A, KEY_A, "open"); await listing("L3", SELLER_B, KEY_B, "paused"); await listing("L4", SELLER_B, KEY_B, "closed");
  const today = Math.floor(Date.now() / 1000 / 86400) * 86400;
  await sale("L1", KEY_A, today + 10); await sale("L1", KEY_A, today + 20); await sale("L3", KEY_B, today - 86400 + 5); await sale("L2", KEY_A, today - 40 * 86400);
  const response = await req("/api/market"), text = await response.clone().text(), d = await response.json<any>();
  expect(d.openListings).toBe(2); expect(d.sellers).toBe(1);
  expect(d.allTime).toEqual({ pulls: 4, scraps: 24, sellerMilli: 16800 });
  expect(d.daily.at(-1)).toEqual({ day: today, pulls: 2, scraps: 12, sellerMilli: 8400 });
  expect(d.daily.at(-2)).toMatchObject({ day: today - 86400, pulls: 1, scraps: 6 });
  expect(d.daily.reduce((s: number, x: any) => s + x.pulls, 0)).toBe(3);
  for (const secret of [SELLER_A, SELLER_B, BUYER, KEY_A, KEY_B, "L1", "pack-L1"]) expect(text).not.toContain(secret);
  expect((await base.DB.prepare("SELECT COUNT(*) n FROM admin_log").first<any>()).n).toBe(0);
});
