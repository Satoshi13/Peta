import { expect, it } from "vitest";
import { signBundle, header, CATALOG, checkGrants, unbase64 } from "../src/bundle";
import input from "./vector-input.json";
import vector from "./coupon-vector.json";
// Public RFC 8032 test vector; it is never a production secret.
export const TEST_SEED = btoa(String.fromCharCode(..."9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60".match(/../g)!.map(s => parseInt(s, 16))));
it("produces the immutable Rust contract vector byte for byte", async () => {
  const event = await signBundle(input, "c1", TEST_SEED);
  expect(event).toBe(vector.event);
  expect(CATALOG).toEqual(vector.caps);
  expect(checkGrants(input.items)).toEqual(vector.items);
  const bytes = unbase64(event), key = await crypto.subtle.importKey("raw", unbase64(vector.publicKey), "Ed25519", false, ["verify"]);
  expect(await crypto.subtle.verify("Ed25519", key, bytes.slice(-64), bytes.slice(0, -64))).toBe(true);
  expect(new TextDecoder().decode(bytes.slice(13, -64))).toBe(JSON.stringify(header(input, "c1")));
});
it("refuses malformed secrets, broad official keys and invalid grants", async () => {
  for (const [id, seed] of [["k2", TEST_SEED], ["c0", TEST_SEED], ["c1", "bad"], ["c1", btoa("x".repeat(31))]]) await expect(signBundle(input, id, seed)).rejects.toThrow("isn't configured");
  for (const items of [[], Array(11).fill(input.items[0]), [input.items[0], input.items[0]], [{ kind: "scraps", count: 1001 }], [{ kind: "material", id: "matte", count: 1 }], [{ kind: "pack", id: "cats", count: 0 }], [{ kind: "scraps", id: 1, count: 1 }]]) expect(() => checkGrants(items)).toThrow();
});
