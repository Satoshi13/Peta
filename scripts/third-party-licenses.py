#!/usr/bin/env python3
"""Generate offline notices from locked Cargo metadata, cached sources and bundled font licenses."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent

def generate(output):
    metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--manifest-path', str(ROOT / 'src-tauri/Cargo.toml'), '--locked', '--offline', '--all-features', '--filter-platform', 'aarch64-apple-darwin', '--format-version', '1'], cwd=ROOT))
    resolved = {node['id'] for node in metadata['resolve']['nodes']}
    packages = sorted((p for p in metadata['packages'] if p['id'] in resolved and p['source']), key=lambda p: (p['name'], p['version']))
    supplemental = json.loads((ROOT / 'third-party/licenses/sources.json').read_text())
    sections = ['Peta — Third-party notices\nGenerated from the locked macOS dependency graph (all features).\nLicense texts are reproduced without modification.\n']
    missing = []
    for package in packages:
        crate_root = Path(package['manifest_path']).parent
        files = [p for p in crate_root.rglob('*') if p.is_file() and any(p.name.upper().startswith(prefix) for prefix in ('LICENSE', 'LICENCE', 'COPYING', 'NOTICE'))]
        if package.get('license_file') and (crate_root / package['license_file']).is_file():
            files.append(crate_root / package['license_file'])
        sources = supplemental.get(f"{package['name']}@{package['version']}", [])
        for source in sources:
            path = ROOT / 'third-party/licenses' / source['file']
            if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
                raise RuntimeError(f"Supplemental license digest mismatch: {source['file']}")
            files.append(path)
        if not files:
            missing.append(f"{package['name']} {package['version']}")
            continue
        title = f"{package['name']} {package['version']} — {package.get('license') or 'See license text'}"
        sections.append('\n' + '=' * 72 + '\n' + title + '\n' + (package.get('repository') or package['source']) + '\n')
        sections.append('Original unmodified crate source: https://crates.io/api/v1/crates/' + package['name'] + '/' + package['version'] + '/download\n')
        if package.get('authors'):
            sections.append('Authors declared by upstream: ' + ', '.join(package['authors']) + '\n')
        for source in sources:
            sections.append('License source: ' + source['url'] + '\n')
        for path in sorted(set(files)):
            sections.append('\n--- ' + path.name + ' ---\n' + path.read_text(errors='replace'))
    if missing:
        raise RuntimeError('Missing local license texts: ' + ', '.join(missing))
    sections.append('\n' + '=' * 72 + '\nBundled fonts and frontend assets\n')
    for path in sorted((ROOT / 'src/fonts').glob('*')):
        if path.is_file() and (path.name == 'NOTICE.md' or path.suffix == '.txt'):
            sections.append('\n--- ' + path.name + ' ---\n' + path.read_text())
    output.write_text('\n'.join(sections))
    print(f'Generated {output.name}: {len(packages)} Rust packages plus bundled font notices.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'THIRD_PARTY_NOTICES')
    generate(parser.parse_args().output)
