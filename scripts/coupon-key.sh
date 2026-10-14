#!/usr/bin/env bash
# The owner runs this manually. Signing seeds stay in memory and Wrangler's stdin only.
set +x
set -euo pipefail
case "${1:-prod}" in prod|dev) coupon_env="${1:-prod}" ;; *) echo 'Usage: coupon-key.sh [prod|dev]' >&2; exit 2 ;; esac
coupon_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$coupon_root/cloudflare/peta-admin"
node --input-type=module - "$coupon_env" <<'JS'
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { spawnSync } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";
const environment = process.argv[2];
function refuse(message) { console.error(message); process.exit(1); }
function wrangler(args, input) {
  return spawnSync("npx", ["--no-install", "wrangler", ...args, "--env", environment], {
    encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_SANITIZE: "true", CI: "true" },
  });
}
const listed = wrangler(["secret", "list", "--format", "json"]);
if (listed.error || listed.status !== 0) refuse("Couldn't inspect Worker secrets. Deploy the fail-closed Worker and sign in to Wrangler first. No key was made.");
let names;
try { names = JSON.parse(listed.stdout); if (!Array.isArray(names)) throw new Error(); }
catch { refuse("Couldn't read the secret list. No key was made."); }
if (names.some(value => value.name === "COUPON_SIGNING_KEY")) {
  console.error(`COUPON_SIGNING_KEY already exists in ${environment}. Replacing it can make coupons unusable.\nType REPLACE to continue:`);
  let tty, answer = "";
  try {
    tty = openSync("/dev/tty", "r"); const byte = Buffer.alloc(1);
    while (readSync(tty, byte, 0, 1, null) && byte[0] !== 10 && answer.length < 100) answer += byte.toString();
    closeSync(tty);
  } catch { refuse("Interactive confirmation is required. Nothing was changed."); }
  if (answer.trim() !== "REPLACE") refuse("Nothing was changed.");
}
let seed, publicKey;
if (environment === "dev") {
  // Public RFC 8032 test vector, never a production secret. Peta Developer trusts c1 only.
  seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
} else {
  const pair = generateKeyPairSync("ed25519"), privateDER = pair.privateKey.export({ format: "der", type: "pkcs8" });
  seed = Buffer.from(privateDER.subarray(-32)); privateDER.fill(0);
  publicKey = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
}
// No shell argument, environment variable, temporary file or echoed prompt contains the seed.
const registered = wrangler(["secret", "put", "COUPON_SIGNING_KEY"], seed.toString("base64") + "\n");
seed.fill(0);
if (registered.error || registered.status !== 0) refuse("Wrangler couldn't confirm key registration. Check the Worker secret status before retrying; no private key was printed or saved.");
console.log(publicKey);
if (environment === "prod") console.log('Public key only. Add this as c2 at the end of COUPON_KEYS in official_keys.rs, set COUPON_KEY_ID=c2 and COUPON_PUBLIC_KEY to this public key, and distribute the updated app before issuing coupons.');
else console.log('Public RFC 8032 dev key c1. Set COUPON_KEY_ID=c1 and COUPON_PUBLIC_KEY to this public key, and use Peta Developer. Never use this key in production.');
console.log('For rotation, use a NEW key ID (c3, c4, …) and update COUPON_KEYS and COUPON_KEY_ID together.');
JS
