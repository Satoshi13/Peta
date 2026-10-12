export interface Creation {
  stickerId: string;
  creatorPublicKey: string | null;
  creatorName: string | null;
  createdAt: string;
  imageDigest: string;
  creatorSig: string | null;
  editionNo?: number;
  editionTotal?: number;
  legacy?: unknown;
}
export interface Transfer {
  stickerId: string;
  seq: number;
  kind: string;
  actorKey: string;
  ref: string;
  at: string;
  sig: string;
}
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const creationBytes = (c: Creation) =>
  utf8(
    JSON.stringify([
      "peta.creation.v1",
      c.stickerId,
      c.creatorPublicKey,
      c.createdAt,
      c.imageDigest,
      c.creatorName,
      c.editionNo ?? null,
      c.editionTotal ?? null,
    ]),
  );
export const transferBytes = (t: Transfer) =>
  utf8(
    JSON.stringify([
      "peta.transfer.v1",
      t.stickerId,
      t.seq,
      t.kind,
      t.actorKey,
      t.ref,
      t.at,
    ]),
  );
export function unbase64(s: string, length?: number): Uint8Array {
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if ((length !== undefined && bytes.length !== length) || base64(bytes) !== s)
    throw new Error("bad_base64");
  return bytes;
}
export const base64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes));
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function requestBytes(
  method: string,
  path: string,
  time: string,
  nonce: string,
  body: Uint8Array,
): Promise<Uint8Array> {
  return utf8(
    `peta.req.v1\n${method}\n${path}\n${time}\n${nonce}\n${await sha256(body)}`,
  );
}
export async function verify(
  key: string,
  bytes: Uint8Array,
  sig: string,
): Promise<boolean> {
  try {
    const k = await crypto.subtle.importKey(
      "raw",
      unbase64(key, 32),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("Ed25519", k, unbase64(sig, 64), bytes);
  } catch {
    return false;
  }
}
