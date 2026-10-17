import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

test('the served legal pages match docs/legal (run scripts/build-legal.py after editing them)', () => {
  assert.doesNotThrow(() => execFileSync('python3', ['scripts/build-legal.py', '--check'], { stdio: 'pipe' }));
});

test('About links to the published terms and privacy policy over https', () => {
  const about = fs.readFileSync(new URL('../src-tauri/src/about.rs', import.meta.url), 'utf8');
  for (const id of ['terms', 'privacy']) assert.match(about, new RegExp(`\\("${id}", "[^"]+", Some\\(if cfg!\\(feature = "developer"\\) \\{ "https://peta-api-dev\\.peta-api\\.workers\\.dev/${id}" \\} else \\{ "https://peta-api-prod\\.peta-api\\.workers\\.dev/${id}" \\}\\)\\)`));
});
