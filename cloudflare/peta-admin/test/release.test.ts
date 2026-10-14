import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, req, post } from "./helpers";
const latest = { version: "0.1.0", file: "Peta-0.1.0.dmg", size: 1000000, sha256: "b".repeat(64), minimumSystemVersion: "14.0", architectures: ["arm64", "x86_64"], publishedAt: "2026-10-14T00:00:00Z" };
beforeAll(setup); beforeEach(async () => { await clear(); await base.RELEASES.delete("releases/latest.json"); });
it("reads only the manifest and counts distinct friends per version without side effects", async () => {
  await base.RELEASES.put("releases/latest.json", JSON.stringify(latest));
  for (const [email, version, at] of [["one", "0.1.0", 1], ["one", "0.1.0", 2], ["two", "0.1.0", 3], ["one", "0.0.9", 0]]) await base.DB.prepare("INSERT INTO downloads VALUES(?,?,?)").bind(email, version, at).run();
  const response = await req("/api/release"); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ latest, downloads: [{ version: "0.1.0", people: 2, downloads: 3, lastAt: 3 }, { version: "0.0.9", people: 1, downloads: 1, lastAt: 0 }] });
  expect((await base.DB.prepare("SELECT COUNT(*) AS n FROM admin_log").first<any>()).n).toBe(0);
  expect((await post("/api/release", {})).status).toBe(404);
  expect(await (await base.RELEASES.get("releases/latest.json"))!.json()).toEqual(latest);
});
it("handles missing and malformed manifests without exposing raw content", async () => {
  expect((await (await req("/api/release")).json<any>()).latest).toBeNull();
  for (const content of ["bad", JSON.stringify({ ...latest, file: "../private.dmg" }), JSON.stringify({ ...latest, publishedAt: "not-a-date" })]) {
    await base.RELEASES.put("releases/latest.json", content);
    expect((await (await req("/api/release")).json<any>()).latest).toBeNull();
  }
});
