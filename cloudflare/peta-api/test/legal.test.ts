import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import worker, { Env } from "../src/index";

const get = (path: string, method = "GET", extra: Partial<Env> = {}) =>
  worker.fetch(new Request(`https://peta.test${path}`, { method }), { ...env, ...extra } as unknown as Env);

it("the terms and privacy policy are public pages, even where invites are required", async () => {
  for (const [path, title] of [["/terms", "Peta 利用規約"], ["/privacy", "Peta プライバシーポリシー"]]) {
    const r = await get(path, "GET", { INVITE_REQUIRED: "1" } as Partial<Env>);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const text = await r.text();
    expect(text).toContain(title);
    expect(text).not.toContain("{{EFFECTIVE_DATE");
    expect(text).not.toMatch(/<script/i);
    expect((await get(path, "HEAD")).status).toBe(200);
  }
  expect((await get("/terms", "POST")).status).not.toBe(200);
});
