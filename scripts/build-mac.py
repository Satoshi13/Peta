#!/usr/bin/env python3
"""Build a release bundle with portable source paths, including paths with spaces."""
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

def release_env(environ=None, root=ROOT, home=None):
    env = dict(os.environ if environ is None else environ)
    separator = chr(31)
    flags = env.get('CARGO_ENCODED_RUSTFLAGS', '').split(separator) if env.get('CARGO_ENCODED_RUSTFLAGS') else shlex.split(env.get('RUSTFLAGS', ''))
    flags += [f'--remap-path-prefix={home or Path.home()}=/home/peta', f'--remap-path-prefix={root}=/peta/source']
    env.pop('RUSTFLAGS', None)
    # Notarization belongs exclusively to release-mac.sh, after binary path checks.
    for key in ('APPLE_ID','APPLE_PASSWORD','APPLE_TEAM_ID','APPLE_API_KEY','APPLE_API_ISSUER','APPLE_API_KEY_PATH','APPLE_CERTIFICATE','APPLE_CERTIFICATE_PASSWORD','APPLE_SIGNING_IDENTITY'):
        env.pop(key, None)
    env['CARGO_ENCODED_RUSTFLAGS'] = separator.join(flags)
    env['CARGO_INCREMENTAL'] = '0'
    return env

if __name__ == '__main__':
    raise SystemExit(subprocess.run([str(ROOT / 'node_modules/.bin/tauri'), 'build', '--config', '{"bundle":{"macOS":{"signingIdentity":"-"}}}', *sys.argv[1:]], cwd=ROOT, env=release_env()).returncode)
