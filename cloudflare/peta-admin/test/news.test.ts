import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, req, post, jwt } from "./helpers";
import vector from "./config-vector.json";
import { readEvent } from "../src/bundle";
import { signAnnouncement } from "../src/settings";
const secret = btoa(String.fromCharCode(...Uint8Array.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60".match(/../g)!, x => parseInt(x, 16))));
const use = { ...base, COUPON_KEY_ID: "c1", COUPON_SIGNING_KEY: secret, COUPON_PUBLIC_KEY: vector.publicKey };
beforeAll(setup); beforeEach(clear);
const now = () => Math.floor(Date.now() / 1000);
const notice = (over: Record<string, unknown> = {}) => ({ text: "Autumn week is here.", kind: "event", link: null, startsAt: now(), endsAt: now() + 86400, ...over });
it("matches the Rust announcement contract byte for byte", async () => {
  expect(await signAnnouncement(vector.announcement, vector.keyId, secret, vector.publicKey)).toBe(vector.announcementEvent);
});
it("only the owner can write, and the signed event carries the stored period and plain text", async () => {
  expect((await req("/api/news", {}, use, await jwt({ email: "friend@example.com" }))).status).toBe(403);
  const response = await post("/api/news", notice({ text: "  <b>Hello</b> & welcome  ", link: "discord" }), use);
  expect(response.status).toBe(201);
  const row = await base.DB.prepare("SELECT * FROM signed_configs").first<any>(), event = readEvent(row.event)!;
  expect(row.kind).toBe("announcement");
  expect(event).toMatchObject({ eventId: row.id, kind: "announcement", title: "Announcement", attachments: [], signer: { kind: "official", keyId: "c1" } });
  expect(event.payload).toEqual({ announcementId: row.id, kind: "event", link: "discord", text: "<b>Hello</b> & welcome" });
  expect(Object.keys(event.payload)).toEqual(["announcementId", "kind", "link", "text"]);
  expect([Date.parse(event.notBefore) / 1000, Date.parse(event.notAfter) / 1000]).toEqual([row.starts_at, row.ends_at]);
  const list = await (await req("/api/news", {}, use)).json<any>();
  expect(list.news[0]).toMatchObject({ id: row.id, state: "live", link: "discord", text: "<b>Hello</b> & welcome" });
  expect((await base.DB.prepare("SELECT action FROM admin_log").first<any>()).action).toBe("news.created");
});
it("refuses free URLs, unknown kinds, long or multi-line text and bad periods without writing", async () => {
  for (const bad of [notice({ link: "https://example.com" }), notice({ kind: "party" }), notice({ text: "x".repeat(141) }), notice({ text: "two\nlines" }), notice({ text: "  " }),
    notice({ endsAt: now() - 1 }), notice({ startsAt: now() + 10, endsAt: now() + 5 }), notice({ endsAt: now() + 367 * 86400 })]) expect((await post("/api/news", bad, use)).status).toBe(400);
  expect((await post("/api/news", notice({ text: "é".repeat(140) }), use)).status).toBe(201);
  expect((await base.DB.prepare("SELECT COUNT(*) n FROM signed_configs").first<any>()).n).toBe(1);
});
it("stops an announcement and keeps at most ten live or scheduled", async () => {
  for (let i = 0; i < 10; i++) expect((await post("/api/news", notice(), use)).status).toBe(201);
  expect((await post("/api/news", notice(), use)).status).toBe(409);
  const id = (await base.DB.prepare("SELECT id FROM signed_configs LIMIT 1").first<any>()).id;
  expect((await post("/api/news/stop", { id: "missing" }, use)).status).toBe(404);
  expect((await post("/api/news/stop", { id }, use)).status).toBe(200);
  expect((await (await req("/api/news", {}, use)).json<any>()).news.find((n: any) => n.id === id).state).toBe("stopped");
  expect((await post("/api/news", notice(), use)).status).toBe(201);
});
