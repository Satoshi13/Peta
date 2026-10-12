import { expect, it } from "vitest";
import vectors from "./vectors.json";
import {
  base64,
  creationBytes,
  transferBytes,
  requestBytes,
  utf8,
  verify,
} from "../src/proofs";
it("all Rust creation, transfer and request bytes and signatures agree", async () => {
  for (const v of vectors.creations) {
    expect(base64(creationBytes(v.record))).toBe(v.bytes);
    expect(
      await verify(
        vectors.publicKey,
        creationBytes(v.record),
        v.record.creatorSig,
      ),
    ).toBe(true);
  }
  for (const v of vectors.transfers) {
    expect(base64(transferBytes(v.record))).toBe(v.bytes);
    expect(
      await verify(vectors.publicKey, transferBytes(v.record), v.record.sig),
    ).toBe(true);
  }
  for (const v of vectors.requests) {
    const bytes = await requestBytes(
      v.method,
      v.path,
      v.time,
      v.nonce,
      utf8(v.body),
    );
    expect(base64(bytes)).toBe(v.bytes);
    expect(await verify(vectors.publicKey, bytes, v.sig)).toBe(true);
  }
});
