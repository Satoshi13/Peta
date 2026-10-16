import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, req, post, jwt } from "./helpers";
import { giftContents } from "../src/reports";
beforeAll(setup);
beforeEach(async () => { await clear(); for (const o of (await base.REPORTS.list()).objects) await base.REPORTS.delete(o.key); });
const PNG = (n: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n, n]);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
function framed(magic: string, version: number, header: unknown, body: Uint8Array, signed = true) {
  const json = new TextEncoder().encode(JSON.stringify(header)), out = new Uint8Array(13 + json.length + body.length + (signed ? 64 : 0));
  out.set(new TextEncoder().encode(magic)); out[8] = version; new DataView(out.buffer).setUint32(9, json.length, false);
  out.set(json, 13); out.set(body, 13 + json.length); return out;
}
const SENDER = "a".repeat(8) + "1".repeat(56), OTHER = "b".repeat(8) + "2".repeat(56), REPORTER = "c".repeat(8) + "3".repeat(56);
const id = (n: number) => n.toString(16).padStart(64, "0");
async function report(n: number, opts: { sender?: string; kind?: string; resolved?: number | null; stored?: number; at?: number; body?: unknown } = {}) {
  const at = opts.at ?? 1760000000 + n;
  await base.DB.prepare("INSERT INTO reports(id,reporter_hash,sender_hash,reason,created_at,kind,listing_id,content_hash,resolved_at,stored) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(id(n), REPORTER, opts.sender ?? SENDER, `reason ${n}`, at, opts.kind ?? "gift", opts.kind === "listing" ? "L".repeat(22) : null, id(n), opts.resolved ?? null, opts.stored ?? 1).run();
  if (opts.body !== undefined) await base.REPORTS.put(`reports/${id(n)}.json`, JSON.stringify(opts.body));
}
const gift = framed("PETAGIFT", 3, { giftId: "GIFT-1", from: "Mika", note: "<b>hello</b>", sentAt: "2026-10-16T00:00:00Z", pngLen: 11, maskLen: 3 }, Uint8Array.from([...PNG(1), 0, 0, 0]));
it("is only for the owner", async () => {
  await report(1, { body: { gift: b64(gift) } });
  const friend = await jwt({ email: "friend@example.com" });
  for (const path of ["/api/reports", `/api/reports/${id(1)}`]) expect((await req(path, {}, base, friend)).status).toBe(403);
  expect((await req("/api/reports/resolve", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://peta-admin.test" }, body: JSON.stringify({ id: id(1), confirm: true }) }, base, friend)).status).toBe(403);
  expect((await base.DB.prepare("SELECT resolved_at FROM reports").first<any>()).resolved_at).toBeNull();
});
it("lists open reports first with short hashes and per-sender counts only", async () => {
  await report(1, { resolved: 1760000500 }); await report(2); await report(3, { sender: OTHER, kind: "listing" });
  const response = await req("/api/reports"), text = await response.clone().text(), data = await response.json<any>();
  expect(data.open).toBe(2);
  expect(data.reports.map((r: any) => r.id)).toEqual([id(3), id(2), id(1)]);
  expect(data.reports[1]).toMatchObject({ sender: "aaaaaaaa", reporter: "cccccccc", senderReports: 2, senderOpen: 1, kind: "gift", reason: "reason 2", resolvedAt: null });
  expect(data.reports[0].kind).toBe("listing");
  for (const full of [SENDER, OTHER, REPORTER]) expect(text).not.toContain(full);
  expect(await base.DB.prepare("SELECT COUNT(*) n FROM admin_log").first<any>()).toEqual({ n: 0 });
});
it("shows a gift's picture and note as data, never markup", async () => {
  await report(1, { body: { gift: b64(gift) } });
  const response = await req(`/api/reports/${id(1)}`), d = await response.json<any>();
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(d).toMatchObject({ available: true, kind: "gift", sender: "aaaaaaaa" });
  expect(d.contents.readable).toBe(true);
  expect(d.contents.pictures).toEqual([{ label: "Sticker", png: b64(PNG(1)) }]);
  expect(d.contents.lines).toContainEqual({ label: "Note", value: "<b>hello</b>" });
  expect(JSON.stringify(d)).not.toContain(SENDER);
});
it("reads a listing's card peeks and the pack's stickers", async () => {
  const card = new TextEncoder().encode(JSON.stringify({ title: "Cats", blurb: "Sleepy", designs: [{ name: "Nap" }], prizes: [], peek: [{ name: "Nap", png: b64(PNG(2)) }, { name: "bad", png: b64(new TextEncoder().encode("<html>")) }] }));
  const pack = framed("PETAPACK", 2, { title: "Cats", author: "Yuki", items: [{ name: "Nap", pngLen: 11, maskLen: 0 }, { name: "Roll", pngLen: 11, maskLen: 0 }] }, Uint8Array.from([...PNG(3), ...PNG(4)]));
  await report(1, { kind: "listing", body: { card: b64(card), pack: b64(pack) } });
  const d = await (await req(`/api/reports/${id(1)}`)).json<any>();
  expect(d.contents.pictures.map((p: any) => p.label)).toEqual(["Card · Nap", "Nap", "Roll"]);
  expect(d.contents.lines).toContainEqual({ label: "Pack author", value: "Yuki" });
});
it("explains expired or never-uploaded contents, and unknown IDs are 404", async () => {
  await report(1); await report(2, { stored: 0 });
  for (const n of [1, 2]) { const d = await (await req(`/api/reports/${id(n)}`)).json<any>(); expect(d.available).toBe(false); expect(d.contents).toBeNull(); }
  expect((await req(`/api/reports/${id(9)}`)).status).toBe(404);
  expect((await req("/api/reports/nope")).status).toBe(404);
  for (const path of ["/api/reports/resolve", "/api/reports/block"]) expect((await post(path, { id: id(9), confirm: true, reason: "x" })).status).toBe(404);
  expect((await post("/api/reports/unblock", { key: "deadbeef", confirm: true })).status).toBe(404);
});
it("resolves once, after confirmation, and logs it", async () => {
  await report(1);
  expect((await post("/api/reports/resolve", { id: id(1) })).status).toBe(400);
  expect((await post("/api/reports/resolve", { id: id(1), confirm: true })).status).toBe(200);
  const at = (await base.DB.prepare("SELECT resolved_at FROM reports").first<any>()).resolved_at;
  expect(at).toBeGreaterThan(0);
  expect((await post("/api/reports/resolve", { id: id(1), confirm: true })).status).toBe(200);
  expect((await base.DB.prepare("SELECT resolved_at FROM reports").first<any>()).resolved_at).toBe(at);
  const log = await base.DB.prepare("SELECT action,detail FROM admin_log WHERE action LIKE 'report.%'").all<any>();
  expect(log.results.map((l: any) => l.action)).toEqual(["report.resolved"]);
  expect(JSON.parse(log.results[0].detail).reportId).toBe(id(1));
});
it("blocks a sender, optionally resolves their open reports, and unblocks", async () => {
  await report(1); await report(2); await report(3, { sender: OTHER });
  expect((await post("/api/reports/block", { id: id(1), reason: "", confirm: true })).status).toBe(400);
  expect((await post("/api/reports/block", { id: id(1), reason: "Spam", confirm: true })).status).toBe(200);
  expect(await base.DB.prepare("SELECT key_hash,reason FROM blocked_keys").first<any>()).toEqual({ key_hash: SENDER, reason: "Spam" });
  expect((await base.DB.prepare("SELECT COUNT(*) n FROM reports WHERE resolved_at IS NULL").first<any>()).n).toBe(3);
  expect(await (await post("/api/reports/block", { id: id(2), reason: "Confirmed", resolveOpen: true, confirm: true })).json()).toEqual({ blocked: true, resolved: 2 });
  expect((await base.DB.prepare("SELECT id FROM reports WHERE resolved_at IS NULL").all<any>()).results).toEqual([{ id: id(3) }]);
  const list = await (await req("/api/reports")).json<any>();
  expect(list.blocked).toEqual([expect.objectContaining({ key: "aaaaaaaa", reason: "Confirmed", reports: 2 })]);
  expect(list.reports.find((r: any) => r.id === id(1)).senderBlocked).toBe(true);
  expect((await post("/api/reports/unblock", { key: "aaaaaaaa" })).status).toBe(400);
  expect((await post("/api/reports/unblock", { key: "aaaaaaaa", confirm: true })).status).toBe(200);
  expect((await base.DB.prepare("SELECT COUNT(*) n FROM blocked_keys").first<any>()).n).toBe(0);
  const actions = (await base.DB.prepare("SELECT action,detail FROM admin_log ORDER BY rowid").all<any>()).results;
  expect(actions.filter((a: any) => a.action.startsWith("report.")).map((a: any) => a.action)).toEqual(["report.sender_blocked", "report.sender_blocked", "report.sender_unblocked"]);
  expect(JSON.parse(actions.at(-1).detail).keyHash).toBe(SENDER);
});
it("treats damaged or non-PNG contents as unreadable instead of passing them on", () => {
  expect(giftContents(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toEqual({ readable: false, pictures: [], lines: [] });
  const html = framed("PETAGIFT", 3, { from: "x", pngLen: 6, maskLen: 0 }, new TextEncoder().encode("<html>"));
  expect(giftContents(html).pictures).toEqual([]);
  expect(giftContents(framed("PETAGIFT", 3, { from: "x", pngLen: 99, maskLen: 0 }, PNG(1))).readable).toBe(false);
});
