import { expect, it } from "vitest";
import vectors from "./vectors-s3.json";
import { base64, unbase64, utf8, sha256, requestBytes, transferBytes, creationBytes, verify } from "../src/proofs";

it("Rust Market request bodies and signed bytes agree for listing, edition and prize pulls", async () => {
  for (const v of vectors.requests) {
    const bytes = await requestBytes(v.method, v.path, v.time, v.nonce, utf8(v.body));
    expect(base64(bytes)).toBe(v.bytes);
    expect(await verify(v.key, bytes, v.sig)).toBe(true);
  }
  expect(JSON.parse(vectors.requests[0].body)).toEqual(vectors.listing);
  expect(JSON.parse(vectors.requests[1].body)).toEqual(vectors.editionPull);
  expect(JSON.parse(vectors.requests[2].body)).toEqual(vectors.prizePull);
  expect(await verify(vectors.creation.creatorPublicKey, creationBytes(vectors.creation), vectors.creation.creatorSig)).toBe(true);
  expect(await verify(vectors.release.actorKey, transferBytes(vectors.release), vectors.release.sig)).toBe(true);
  expect(await verify(vectors.editionPull.claim.actorKey, transferBytes(vectors.editionPull.claim), vectors.editionPull.claim.sig)).toBe(true);
});
it("the Worker sees only bounded sealed content and a sealed content-key envelope", async () => {
  for (const kind of ["card", "pack"] as const) {
    const sealed = unbase64(vectors[kind].sealed);
    expect(new TextDecoder().decode(sealed.slice(0, 8))).toBe("PETAMKT1");
    expect(sealed.length).toBe(vectors.listing[kind === "card" ? "cardSize" : "packSize"]);
    expect(await sha256(sealed)).toBe(vectors.listing[kind === "card" ? "cardDigest" : "packDigest"]);
    expect(sealed.length).toBe(unbase64(vectors[kind].plain).length + 36);
    expect(new TextDecoder().decode(sealed)).not.toContain(new TextDecoder().decode(unbase64(vectors[kind].plain)));
  }
  expect(unbase64(vectors.envelope.encKey).length).toBe(32);
  expect(unbase64(vectors.envelope.sealed).length).toBe(80);
  expect(JSON.stringify(vectors.listing)).not.toContain("contentKey");
});
