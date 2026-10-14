import { fail } from "./validation";
export type Grant = { kind: string; id: string; count: number };
export const CATALOG = [
  { kind: "scraps", id: "", cap: 1000 },
  { kind: "envelope", id: "", cap: 3 },
  ...["kraft", "holographic", "gold", "riso", "vintage", "clear", "pixel", "washi", "sakura"].map(id => ({ kind: "material", id, cap: 50 })),
  { kind: "tool", id: "link-tag", cap: 20 }, { kind: "tool", id: "board", cap: 12 },
  ...["tokyo", "coffee", "plants", "pixel", "cats", "night"].map(id => ({ kind: "pack", id, cap: 5 })),
];
export function checkGrants(input: unknown): Grant[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) fail(400, "invalid", "Give 1 to 10 things.");
  const seen = new Set<string>();
  return input.map(g => {
    if (!g || typeof g !== "object" || typeof g.kind !== "string" || (g.id !== undefined && typeof g.id !== "string")) fail(400, "invalid", "Choose a supported item.");
    const id = g.id ?? "", option = CATALOG.find(o => o.kind === g.kind && o.id === id), identity = `${g.kind}:${id}`;
    if (!option || !Number.isSafeInteger(g.count) || g.count < 1 || g.count > option.cap) fail(400, "invalid", "Choose a count within the item's limit.");
    if (seen.has(identity)) fail(400, "invalid", "Give each item only once.");
    seen.add(identity);
    // Event.payload is a serde_json::Value: Rust writes its object keys in lexical order.
    return { count: g.count, id, kind: g.kind };
  });
}
export const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export type Bundle = { eventId: string; issuedAt: string; notBefore: string | null; notAfter: string; title: string; message: string; items: Grant[] };
export function header(bundle: Bundle, keyId: string) {
  // Keep the Event and Signer field order identical to Rust serde output.
  return { eventId: bundle.eventId, kind: "bundle", issuedAt: bundle.issuedAt, notBefore: bundle.notBefore,
    notAfter: bundle.notAfter, title: bundle.title, message: bundle.message, payload: { items: checkGrants(bundle.items) },
    signer: { kind: "official", keyId }, attachments: [] };
}
export async function signBundle(bundle: Bundle, keyId: string, secret: string, publicKey?: string): Promise<string> {
  if (!/^c[1-9][0-9]*$/.test(keyId)) fail(503, "signing_unavailable", "Coupon signing isn't configured.");
  let key: CryptoKey;
  try {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(secret)) throw new Error();
    const seed = unbase64(secret);
    if (seed.length !== 32 || base64(seed) !== secret) throw new Error();
    // RFC 8410 PKCS#8 wrapping of an Ed25519 seed, held only in memory.
    const prefix = new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
    const pkcs8 = new Uint8Array(48); pkcs8.set(prefix); pkcs8.set(seed, 16);
    key = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);
    seed.fill(0); pkcs8.fill(0);
  } catch { fail(503, "signing_unavailable", "Coupon signing isn't configured."); }
  const json = new TextEncoder().encode(JSON.stringify(header(bundle, keyId)));
  if (json.length > 65536) fail(400, "invalid", "This coupon is too large.");
  const unsigned = new Uint8Array(13 + json.length);
  unsigned.set(new TextEncoder().encode("PETAEVNT")); unsigned[8] = 1;
  new DataView(unsigned.buffer).setUint32(9, json.length, false); unsigned.set(json, 13);
  const signed = new Uint8Array(unsigned.length + 64); signed.set(unsigned);
  try { signed.set(new Uint8Array(await crypto.subtle.sign("Ed25519", key, unsigned)), unsigned.length); }
  catch { fail(503, "signing_unavailable", "Peta couldn't sign this coupon."); }
  if (publicKey !== undefined) {
    try {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) throw new Error();
      const publicBytes = unbase64(publicKey);
      if (publicBytes.length !== 32 || base64(publicBytes) !== publicKey) throw new Error();
      const verifier = await crypto.subtle.importKey("raw", publicBytes, "Ed25519", false, ["verify"]);
      if (!await crypto.subtle.verify("Ed25519", verifier, signed.slice(-64), unsigned)) throw new Error();
    } catch { fail(503, "signing_unavailable", "Coupon signing key doesn't match its configured public key."); }
  }
  return base64(signed);
}
/** Display only: trust verification and grant application happen in the app. */
export function readEvent(value: string): Record<string, any> | null {
  try {
    if (value.length > 32 * 1024 * 1024) return null;
    const bytes = unbase64(value), n = new DataView(bytes.buffer).getUint32(9, false);
    if (new TextDecoder().decode(bytes.slice(0, 8)) !== "PETAEVNT" || bytes[8] !== 1 || n < 1 || n > 65536 || 13 + n > bytes.length - 64) return null;
    return JSON.parse(new TextDecoder().decode(bytes.slice(13, 13 + n)));
  } catch { return null; }
}
