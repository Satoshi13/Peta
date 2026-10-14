#!/usr/bin/env python3
"""Reject personal source paths in every executable (every architecture of a universal one) of the supplied macOS bundle."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

def check(app):
    binaries = sorted((app / 'Contents/MacOS').glob('*'))
    if not binaries:
        print('No app executable found. Build the app first.', file=sys.stderr)
        return 2
    found = set()
    for binary in binaries:
        if not binary.is_file():
            continue
        result = subprocess.run(['strings', '-a', '-arch', 'all', str(binary)], check=True, stdout=subprocess.PIPE, text=True, errors='replace')
        found.update((binary.name, line) for line in result.stdout.splitlines() if '/Users/' in line)
    if found:
        print(f'FAIL: {len(found)} strings contain personal source paths:')
        for binary, line in sorted(found):
            print(f'{binary}: {line}')
        return 1
    print('PASS: no personal source paths in the app executables.')
    return 0

if __name__ == '__main__':
    raise SystemExit(check(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'src-tauri/target/universal-apple-darwin/release/bundle/macos/Peta.app'))
