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
    args = sys.argv[1:]
    beta = any('beta' in a.split(',') for a in args)
    if beta:
        config = __import__('json').loads((ROOT / 'src-tauri/tauri.beta.conf.json').read_text())
        key = config.get('plugins', {}).get('updater', {}).get('pubkey', '')
        import base64
        try:
            decoded = base64.b64decode(key, validate=True).decode()
            if not decoded.startswith('untrusted comment:') or len(decoded.splitlines()) != 2:
                raise ValueError()
            if len(base64.b64decode(decoded.splitlines()[1], validate=True)) != 42:
                raise ValueError()
        except Exception:
            raise SystemExit('Beta requires the owner updater PUBLIC key in tauri.beta.conf.json. No build was started.')
        args += ['--config', str(ROOT / 'src-tauri/tauri.beta.conf.json')]
        if not Path(os.environ.get('TAURI_SIGNING_PRIVATE_KEY_PATH', '')).is_file():
            raise SystemExit('Select the updater private key FILE on your encrypted disk. No build was started.')
    raise SystemExit(subprocess.run([str(ROOT / 'node_modules/.bin/tauri'), 'build', '--config', '{"bundle":{"macOS":{"signingIdentity":"-"}}}', *args], cwd=ROOT, env=release_env()).returncode)
