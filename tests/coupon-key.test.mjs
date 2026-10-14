import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = resolve('scripts/coupon-key.sh');
function run(environment, mode = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'peta-coupon-key-test-')), record = join(dir, 'public.json');
  writeFileSync(join(dir, 'npx'), `#!/usr/bin/env node
const fs = require('node:fs'), crypto = require('node:crypto');
const args = process.argv.slice(2);
if (process.env.WRANGLER_WRITE_LOGS !== 'false' || process.env.WRANGLER_LOG_SANITIZE !== 'true') process.exit(3);
if (args.includes('list')) {
  if (process.env.FAKE_MODE === 'list-fail') { console.error('CANARY-PRIVATE-UPSTREAM'); process.exit(1); }
  console.log(JSON.stringify(process.env.FAKE_MODE === 'exists' ? [{name:'COUPON_SIGNING_KEY'}] : []));
} else if (args.includes('put')) {
  const value=fs.readFileSync(0,'utf8').trim(), seed=Buffer.from(value,'base64');
  if(seed.length!==32 || seed.toString('base64')!==value) process.exit(2);
  const key=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
  const publicKey=crypto.createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  // Only public data is written. Test keys are generated in memory and never persisted.
  fs.writeFileSync(process.env.FAKE_RECORD,JSON.stringify({publicKey,args}));
  if(process.env.FAKE_MODE==='put-fail'){console.log(value);console.error('CANARY-PRIVATE-UPSTREAM '+value);process.exit(1);}
} else process.exit(2);
`, { mode: 0o755 });
  const result = spawnSync('bash', [script, environment], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_RECORD: record, FAKE_MODE: mode } });
  const publicData = existsSync(record) ? JSON.parse(readFileSync(record,'utf8')) : null;
  rmSync(dir, { recursive:true, force:true });
  return { ...result, publicData };
}
test('coupon key script pipes seeds to the intended Worker and prints public keys only', () => {
  for (const environment of ['dev','prod']) {
    const r = run(environment); assert.equal(r.status,0,r.stderr); assert.equal(r.stdout.split('\n')[0],r.publicData.publicKey);
    assert.deepEqual(r.publicData.args,['--no-install','wrangler','secret','put','COUPON_SIGNING_KEY','--env',environment]);
    assert.equal(r.stdout.split('\n').filter(line=>/^[A-Za-z0-9+/]{43}=$/.test(line)).length,1);
    if(environment==='dev') assert.equal(r.publicData.publicKey,'11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=');
  }
});
test('coupon key script suppresses upstream errors and refuses unknown environment or unavailable secret listing', () => {
  for (const [environment, mode] of [['bad','ok'],['dev','list-fail'],['dev','put-fail']]) {
    const r=run(environment,mode);assert.notEqual(r.status,0);assert.ok(!(r.stdout+r.stderr).includes('CANARY-PRIVATE-UPSTREAM'));
    // Public RFC 8032 seed is allowed in tests but must never be echoed by the script.
    assert.ok(!(r.stdout+r.stderr).includes(Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex').toString('base64')));
    if(mode==='list-fail') assert.equal(r.publicData,null);
  }
});
test('coupon key script does not overwrite an existing secret without interactive approval', () => {
  const r=run('dev','exists');assert.notEqual(r.status,0);assert.equal(r.publicData,null);assert.match(r.stderr,/REPLACE|Interactive confirmation/);
});
