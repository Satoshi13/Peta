import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker, { Env } from "../src/index";
import {
  Creation,
  Transfer,
  base64,
  creationBytes,
  transferBytes,
  requestBytes,
  utf8,
  sha256,
  unbase64,
} from "../src/proofs";
const db = (env as unknown as Env).DB;
const bindings = {
  ...env,
  REQUESTS_PER_MINUTE: "10000",
  PACKS_PER_HOUR: "10000",
  RATE_LIMITER: undefined,
} as unknown as Env;
let a: CryptoKeyPair, b: CryptoKeyPair, c: CryptoKeyPair;
const pub = async (k: CryptoKeyPair) =>
  base64(
    new Uint8Array(
      (await crypto.subtle.exportKey("raw", k.publicKey)) as ArrayBuffer,
    ),
  );
const sig = async (k: CryptoKeyPair, bytes: Uint8Array) =>
  base64(
    new Uint8Array(await crypto.subtle.sign("Ed25519", k.privateKey, bytes)),
  );
const now = () => new Date().toISOString();
async function make(id = "real", key = a, edition = false): Promise<Creation> {
  const c: Creation = {
    stickerId: id,
    creatorPublicKey: await pub(key),
    creatorName: "日本語 🌸",
    createdAt: now(),
    imageDigest: "a".repeat(64),
    creatorSig: null,
    ...(edition ? { editionNo: 1, editionTotal: 1 } : {}),
  };
  c.creatorSig = await sig(key, creationBytes(c));
  return c;
}
async function move(
  id: string,
  seq: number,
  kind: string,
  key: CryptoKeyPair,
  ref = "GIFT-test",
): Promise<Transfer> {
  const t = {
    stickerId: id,
    seq,
    kind,
    actorKey: await pub(key),
    ref,
    at: now(),
    sig: "",
  };
  t.sig = await sig(key, transferBytes(t));
  return t;
}
async function req(
  path: string,
  body?: unknown,
  key = a,
  options: {
    time?: string;
    nonce?: string;
    bad?: boolean;
    bindings?: Env;
  } = {},
) {
  const method = body === undefined ? "GET" : "POST",
    bytes = body === undefined ? new Uint8Array() : utf8(JSON.stringify(body)),
    time = options.time ?? String(Math.floor(Date.now() / 1000)),
    nonce = options.nonce ?? base64(crypto.getRandomValues(new Uint8Array(16)));
  let signature = await sig(
    key,
    await requestBytes(method, path, time, nonce, bytes),
  );
  if (options.bad) signature = base64(new Uint8Array(64));
  return worker.fetch(
    new Request(`https://peta.test${path}`, {
      method,
      headers: {
        "X-Peta-Key": await pub(key),
        "X-Peta-Time": time,
        "X-Peta-Nonce": nonce,
        "X-Peta-Sig": signature,
      },
      ...(body === undefined ? {} : { body: bytes }),
    }),
    options.bindings ?? bindings,
  );
}
async function code(r: Response, status: number, error: string) {
  expect(r.status).toBe(status);
  expect(((await r.json()) as { error: string }).error).toBe(error);
}
async function register(id = "real") {
  expect((await req("/v1/stickers", await make(id))).status).toBe(200);
}
async function pack(id = "pack", count = 2) {
  const creation = await make(`${id}-edition`, a, true),
    release = await move(creation.stickerId, 0, "release", a, `${id}:slot-0`);
  return {
    packId: id,
    creatorKey: await pub(a),
    slotCount: count,
    headerDigest: "b".repeat(64),
    editions: [{ creation, release }],
    movedReleases: [] as Transfer[],
  };
}
beforeAll(async () => {
  await applyD1Migrations(db, (env as any).TEST_MIGRATIONS);
  [a, b, c] = await Promise.all(
    [1, 2, 3].map(
      () =>
        crypto.subtle.generateKey("Ed25519", true, [
          "sign",
          "verify",
        ]) as Promise<CryptoKeyPair>,
    ),
  );
});
beforeEach(async () => {
  await db.batch(
    [
      "pack_slots",
      "packs",
      "transfers",
      "stickers",
      "nonces",
      "blocked_keys",
      "rate_counters",
      "assertions",
      "cancelled_releases",
      "cancelled_packs",
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
});
it("register/release/claim is idempotent, with only one receiver", async () => {
  const origin = await make();
  expect((await req("/v1/stickers", origin)).status).toBe(200);
  expect((await req("/v1/stickers", origin)).status).toBe(200);
  const release = await move("real", 0, "release", a);
  expect((await req("/v1/stickers/real/release", release)).status).toBe(200);
  expect((await req("/v1/stickers/real/release", release)).status).toBe(200);
  const claim = await move("real", 1, "claim", b);
  expect((await req("/v1/stickers/real/claim", claim, b)).status).toBe(200);
  await code(
    await req("/v1/stickers/real/claim", await move("real", 1, "claim", c), c),
    409,
    "already_claimed",
  );
  expect((await req("/v1/stickers/real/claim", claim, b)).status).toBe(200);
  expect((await req("/v1/stickers/real")).status).toBe(200);
});
it("concurrent gifts have one winner", async () => {
  await register();
  await req("/v1/stickers/real/release", await move("real", 0, "release", a));
  const results = await Promise.all(
    [b, c].map(async (k) =>
      req("/v1/stickers/real/claim", await move("real", 1, "claim", k), k),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await db.prepare("SELECT COUNT(*) n FROM transfers").first("n")).toBe(
    2,
  );
});
it("auth rejects tampering, skew, replay, blocked and actor mismatch", async () => {
  const origin = await make();
  await code(
    await req("/v1/stickers", origin, a, { bad: true }),
    401,
    "bad_signature",
  );
  await code(
    await req("/v1/stickers", origin, a, { time: "1" }),
    401,
    "clock_skew",
  );
  const nonce = base64(new Uint8Array(16));
  expect((await req("/v1/stickers", origin, a, { nonce })).status).toBe(200);
  await code(await req("/v1/stickers", origin, a, { nonce }), 401, "replay");
  expect((await req("/v1/stickers/real", undefined, a, { nonce })).status).toBe(
    200,
  );
  expect((await req("/v1/stickers/real", undefined, a, { nonce })).status).toBe(
    200,
  );
  await code(
    await req(
      "/v1/stickers/real/release",
      await move("real", 0, "release", a),
      b,
    ),
    403,
    "not_yours",
  );
  await db
    .prepare("INSERT INTO blocked_keys VALUES(?,?,?)")
    .bind(await sha256(unbase64(await pub(a))), null, 0)
    .run();
  await code(await req("/v1/stickers/real"), 403, "blocked");
});
it("wrong owner, sequence, ref, signed bytes and future dates are rejected", async () => {
  await register();
  await code(
    await req(
      "/v1/stickers/real/release",
      await move("real", 0, "release", b),
      b,
    ),
    403,
    "not_yours",
  );
  await code(
    await req("/v1/stickers/real/release", await move("real", 2, "release", a)),
    409,
    "seq_mismatch",
  );
  const release = await move("real", 0, "release", a);
  expect(
    (await req("/v1/stickers/real/release", { ...release, ref: "changed" }))
      .status,
  ).toBe(401);
  await req("/v1/stickers/real/release", release);
  await code(
    await req(
      "/v1/stickers/real/claim",
      await move("real", 1, "claim", b, "wrong"),
      b,
    ),
    409,
    "ref_mismatch",
  );
  const future = await move("real", 1, "claim", b);
  future.at = "2999-01-01T00:00:00Z";
  future.sig = await sig(b, transferBytes(future));
  await code(
    await req("/v1/stickers/real/claim", future, b),
    400,
    "future_time",
  );
});
it("cancel before claim restores seq and retries, after claim rejects", async () => {
  await register();
  const release = await move("real", 0, "release", a);
  await req("/v1/stickers/real/release", release);
  expect((await req("/v1/stickers/real/cancel", release)).status).toBe(200);
  expect((await req("/v1/stickers/real/cancel", release)).status).toBe(200);
  expect(await db.prepare("SELECT seq FROM stickers").first("seq")).toBe(0);
  const newer = await move("real", 0, "release", a, "GIFT-new");
  await req("/v1/stickers/real/release", newer);
  await req(
    "/v1/stickers/real/claim",
    await move("real", 1, "claim", b, "GIFT-new"),
    b,
  );
  await code(await req("/v1/stickers/real/cancel", release), 403, "not_yours");
});
it("old cancellation cannot take back a newer release", async () => {
  await register();
  const old = await move("real", 0, "release", a);
  await req("/v1/stickers/real/release", old);
  await req("/v1/stickers/real/cancel", old);
  const newer = await move("real", 0, "release", a, "GIFT-new");
  await req("/v1/stickers/real/release", newer);
  await code(await req("/v1/stickers/real/cancel", old), 409, "ref_mismatch");
});
it("unknown IDs and pack bounds return explicit errors", async () => {
  await code(await req("/v1/stickers/missing"), 404, "unknown");
  await code(await req("/v1/packs/missing/slots"), 404, "unknown_pack");
  await code(
    await req("/v1/packs/missing/slots/0/claim", {}, b),
    404,
    "unknown_pack",
  );
  const p = await pack();
  await req("/v1/packs", p);
  await code(await req("/v1/packs/pack/slots/2/claim", {}, b), 400, "invalid");
});
it("pack registration is atomic when a moved release fails in SQL", async () => {
  await register("moved");
  const p = await pack();
  p.movedReleases = [await move("moved", 9, "release", a, "pack:slot-1")];
  await code(await req("/v1/packs", p), 409, "seq_mismatch");
  expect(await db.prepare("SELECT COUNT(*) n FROM packs").first("n")).toBe(0);
  expect(await db.prepare("SELECT COUNT(*) n FROM stickers").first("n")).toBe(
    1,
  );
  expect(await db.prepare("SELECT state FROM stickers").first("state")).toBe(
    "held",
  );
});
it("a bad later proof leaves no registrations", async () => {
  const p = await pack();
  p.editions[0].release.sig = base64(new Uint8Array(64));
  await code(await req("/v1/packs", p), 401, "bad_signature");
  expect(await db.prepare("SELECT COUNT(*) n FROM stickers").first("n")).toBe(
    0,
  );
});
it("slot and edition claims are atomic, concurrent, and replayable", async () => {
  const p = await pack();
  expect((await req("/v1/packs", p)).status).toBe(200);
  expect((await req("/v1/packs", p)).status).toBe(200);
  const tb = await move("pack-edition", 1, "claim", b, "pack:slot-0"),
    tc = await move("pack-edition", 1, "claim", c, "pack:slot-0");
  const r = await Promise.all([
    req("/v1/packs/pack/slots/0/claim", { claim: tb }, b),
    req("/v1/packs/pack/slots/0/claim", { claim: tc }, c),
  ]);
  expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
  const winner = r[0].status === 200 ? b : c,
    t = r[0].status === 200 ? tb : tc;
  expect(
    (await req("/v1/packs/pack/slots/0/claim", { claim: t }, winner)).status,
  ).toBe(200);
  await code(
    await req("/v1/packs/pack/slots/0/claim", {}, winner),
    409,
    "slot_taken",
  );
  expect(await (await req("/v1/packs/pack/slots")).json()).toEqual({
    slots: [0],
  });
  await code(await req("/v1/packs/pack/cancel", p), 409, "already_opened");
});
it("bad edition sequence does not consume the slot; direct claim cannot bypass it", async () => {
  const p = await pack();
  await req("/v1/packs", p);
  const t = await move("pack-edition", 9, "claim", b, "pack:slot-0");
  await code(
    await req("/v1/packs/pack/slots/0/claim", { claim: t }, b),
    409,
    "seq_mismatch",
  );
  expect(await (await req("/v1/packs/pack/slots")).json()).toEqual({
    slots: [],
  });
  await code(
    await req(
      "/v1/stickers/pack-edition/claim",
      await move("pack-edition", 1, "claim", b, "pack:slot-0"),
      b,
    ),
    409,
    "slot_taken",
  );
});
it("prize slots are idempotent only for the same key", async () => {
  await req("/v1/packs", await pack());
  expect((await req("/v1/packs/pack/slots/1/claim", {}, b)).status).toBe(200);
  expect((await req("/v1/packs/pack/slots/1/claim", {}, b)).status).toBe(200);
  await code(
    await req("/v1/packs/pack/slots/1/claim", {}, c),
    409,
    "slot_taken",
  );
});
it("pack cancel deletes editions and restores moved originals atomically", async () => {
  await register("moved");
  const p = await pack();
  p.movedReleases = [await move("moved", 0, "release", a, "pack:slot-1")];
  await req("/v1/packs", p);
  expect((await req("/v1/packs/pack/cancel", p)).status).toBe(200);
  expect((await req("/v1/packs/pack/cancel", p)).status).toBe(200);
  expect(await db.prepare("SELECT COUNT(*) n FROM stickers").first("n")).toBe(
    1,
  );
  expect(await db.prepare("SELECT seq FROM stickers").first("seq")).toBe(0);
  expect(await db.prepare("SELECT COUNT(*) n FROM transfers").first("n")).toBe(
    0,
  );
});
it("minute and hourly limits are configurable and return 429", async () => {
  const limited = { ...bindings, REQUESTS_PER_MINUTE: "1" };
  expect(
    (await req("/v1/stickers/missing", undefined, a, { bindings: limited }))
      .status,
  ).toBe(404);
  await code(
    await req("/v1/stickers/missing", undefined, a, { bindings: limited }),
    429,
    "slow_down",
  );
  const hourly = { ...bindings, PACKS_PER_HOUR: "1" };
  expect(
    (await req("/v1/packs", await pack(), b, { bindings: hourly })).status,
  ).toBe(403);
  await code(
    await req("/v1/packs", await pack(), b, { bindings: hourly }),
    429,
    "slow_down",
  );
});
it("200-slot packs use bounded bulk statements", async () => {
  expect((await req("/v1/packs", await pack("large", 200))).status).toBe(200);
  expect(await db.prepare("SELECT COUNT(*) n FROM pack_slots").first("n")).toBe(
    200,
  );
});

it("cancellation fences a release that arrives after the cancellation", async () => {
  await register();
  const t = await move("real", 0, "release", a);
  expect((await req("/v1/stickers/real/cancel", t)).status).toBe(200);
  await code(await req("/v1/stickers/real/release", t), 409, "cancelled");
  expect(await db.prepare("SELECT state FROM stickers").first("state")).toBe(
    "held",
  );
});
it("cancellation fences a pack registration that arrives late", async () => {
  const p = await pack();
  expect((await req("/v1/packs/pack/cancel", p)).status).toBe(200);
  expect((await req("/v1/packs", p)).status).toBe(409);
  expect(await db.prepare("SELECT COUNT(*) n FROM packs").first("n")).toBe(0);
});
it("simultaneous identical pack registrations both succeed", async () => {
  const p = await pack();
  const results = await Promise.all([req("/v1/packs", p), req("/v1/packs", p)]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
});
