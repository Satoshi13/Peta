#!/usr/bin/env python3
"""Make, list and stop Peta coupons: a short name friends type into Redeem Code… (docs/coupon-howto.md).

  python3 scripts/coupon.py new HALLOWEEN --scraps 50 --envelopes 1 --material kraft=2 --tool link-tag=1 --pack cats=1 --until 2026-11-01 --limit 30
  python3 scripts/coupon.py list
  python3 scripts/coupon.py stop HALLOWEEN
  python3 scripts/coupon.py catalog

`new` signs the bundle with your official key (PETA_SIGNING_KEY, or --key) using peta-pass, shows what it will give and
asks before storing it in D1 with your own wrangler login. The key never leaves your Mac; the server only keeps the signed file.
"""
import argparse, base64, datetime, os, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / 'cloudflare/peta-api'
# What a coupon can give and the most of each (the app enforces the same caps: crates/core/src/scraps.rs grant_cap).
CATALOG = {
    'scraps': ('Scraps', 1000, None),
    'envelope': ('Extra envelopes', 3, None),
    'material': ('Material sheets', 50, ['kraft', 'holographic', 'gold', 'riso', 'vintage', 'clear', 'pixel', 'washi', 'sakura']),
    'tool': ('Tools', None, {'link-tag': 20, 'board': 12}),
    'pack': ('Shop pack refills (sets)', 5, ['tokyo', 'coffee', 'plants', 'pixel', 'cats', 'night']),
}
NAME = re.compile(r'^[A-Z0-9][A-Z0-9-]{2,23}$')


def fail(message):
    print(f'coupon: {message}', file=sys.stderr)
    raise SystemExit(2)


def when(value, end):
    """A date (YYYY-MM-DD, local) or an ISO time. A bare --until date lasts through that whole day."""
    try:
        if re.fullmatch(r'\d{4}-\d\d-\d\d', value):
            day = datetime.datetime.fromisoformat(value).astimezone()
            return day + datetime.timedelta(days=1) if end else day
        t = datetime.datetime.fromisoformat(value)
        return t if t.tzinfo else t.astimezone()
    except ValueError:
        fail(f'Not a date: {value}')


def pairs(values, kind):
    out = []
    for v in values or []:
        m = re.fullmatch(r'([a-z-]+)=(\d+)', v.strip())
        if not m:
            fail(f'Write --{kind} as id=count, e.g. kraft=2: {v}')
        out.append((m[1], int(m[2])))
    return out


def d1(env, sql, capture=False):
    cmd = ['npx', 'wrangler', 'd1', 'execute', f'peta-{env}', '--env', env, '--remote', '--command', sql]
    return subprocess.run(cmd, cwd=API, check=True, text=True, capture_output=capture)


def peta_pass():
    binary = ROOT / 'src-tauri/target/release/peta-pass'
    if not binary.exists() and (ROOT / 'src-tauri/target/debug/peta-pass').exists():
        binary = ROOT / 'src-tauri/target/debug/peta-pass'
    if not binary.exists():
        print('Building peta-pass (once)…')
        subprocess.run(['cargo', 'build', '--manifest-path', str(ROOT / 'src-tauri/Cargo.toml'), '-p', 'peta-pass', '--release'], check=True)
    return binary


def new(a):
    name = a.name.strip().upper()
    if not NAME.fullmatch(name):
        fail('A coupon name is 3–24 letters, digits or hyphens, starting with a letter or digit.')
    items = []
    if a.scraps:
        items.append(('scraps', '', a.scraps))
    if a.envelopes:
        items.append(('envelope', '', a.envelopes))
    for kind in ('material', 'tool', 'pack'):
        items += [(kind, i, n) for i, n in pairs(getattr(a, kind), kind)]
    for kind, i, n in items:
        label, cap, ids = CATALOG[kind]
        cap = ids.get(i) if isinstance(ids, dict) else cap
        if (ids is not None and i not in ids) or cap is None:
            fail(f'Unknown {kind}: {i}. See: coupon.py catalog')
        if not 1 <= n <= cap:
            fail(f'{label}{" " + i if i else ""}: 1 to {cap} per coupon.')
    if len(items) > 10:
        fail('Up to 10 things per coupon.')
    if not items:
        fail('Give at least one thing: --scraps, --envelopes, --material, --tool or --pack. See: coupon.py catalog')
    start = when(a.start, False) if a.start else None
    until = when(a.until, True) if a.until else datetime.datetime.now().astimezone() + datetime.timedelta(days=a.days)
    if until <= (start or datetime.datetime.now().astimezone()):
        fail('The coupon would end before it starts.')
    if a.limit is not None and a.limit < 1:
        fail('--limit is at least 1.')
    key = a.key or os.environ.get('PETA_SIGNING_KEY')
    if not key or not Path(key).exists():
        fail('Mount your key disk image and set PETA_SIGNING_KEY to the key file (docs/official-key-howto.md), or use --key.')
    event_id = f'cpn-{name.lower()}-{datetime.datetime.now():%Y%m%d%H%M}'

    def label(kind, i, n):
        if kind == 'scraps':
            return f'{n} Scraps'
        if kind == 'envelope':
            return f'{n} extra envelope{"s" if n != 1 else ""}'
        return f'{i} ×{n} ({kind})'
    print(f'\n  {name}  →  ' + ', '.join(label(*x) for x in items))
    print(f'  {("from " + start.strftime("%Y-%m-%d %H:%M") + "  ") if start else ""}until {(until - datetime.timedelta(minutes=1)):%Y-%m-%d %H:%M %Z}'
          f'  ·  {"first " + str(a.limit) + " Macs" if a.limit else "no limit"}  ·  {a.env}')
    print(f'  Shown in Peta as “{a.title}”{(": " + a.message) if a.message else ""}\n')
    if not a.dry_run and input('Sign and store it? [y/N] ').strip().lower() != 'y':
        print('Nothing was made.')
        return
    with tempfile.TemporaryDirectory(prefix='peta-coupon-') as tmp:
        out = Path(tmp) / 'coupon.peta'
        cmd = [str(peta_pass()), 'event', '--key', key, '--key-id', a.key_id, '--id', event_id, '--kind', 'bundle',
               '--not-after', until.isoformat(timespec='seconds'), '--title', a.title, '--message', a.message, '--out', str(out)]
        if start:
            cmd += ['--not-before', start.isoformat(timespec='seconds')]
        for kind, i, n in items:
            cmd += ['--item', f'{kind}:{i}={n}' if i else f'{kind}={n}']
        signed = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        if signed.returncode:
            fail(signed.stderr.strip() or 'peta-pass could not sign the coupon.')
        event = base64.b64encode(out.read_bytes()).decode()
    if a.dry_run:
        print(f'Signed {event_id} ({len(event)} characters). --dry-run: nothing was stored.')
        return
    sql = (f"INSERT INTO coupons(name,event,starts_at,ends_at,max_claims,created_at) VALUES('{name}','{event}',"
           f"{int(start.timestamp()) if start else 'NULL'},{int(until.timestamp())},{a.limit if a.limit else 'NULL'},unixepoch())")
    d1(a.env, sql)
    print(f'\nDone. Post this in Discord:  {name}\n(Redeem Code… in Peta. Stop it early with: python3 scripts/coupon.py stop {name})')


def listing(a):
    d1(a.env, "SELECT name, claims, max_claims AS max, datetime(starts_at,'unixepoch','localtime') AS starts, "
              "datetime(ends_at,'unixepoch','localtime') AS ends, CASE WHEN stopped_at IS NOT NULL THEN 'stopped' "
              "WHEN ends_at<=unixepoch() THEN 'ended' WHEN max_claims IS NOT NULL AND claims>=max_claims THEN 'used up' "
              "WHEN starts_at>unixepoch() THEN 'not yet' ELSE 'open' END AS state FROM coupons ORDER BY created_at DESC LIMIT 30")


def stop(a):
    name = a.name.strip().upper()
    if not NAME.fullmatch(name):
        fail('Not a coupon name.')
    d1(a.env, f"UPDATE coupons SET stopped_at=unixepoch() WHERE name='{name}' AND stopped_at IS NULL")
    print(f'{name} is stopped. Macs that already received it keep what they got.')


def catalog(_):
    print('What a coupon can give (most per coupon):')
    for kind, (label, cap, ids) in CATALOG.items():
        flag = {'scraps': '--scraps N', 'envelope': '--envelopes N'}.get(kind, f'--{kind} id=N')
        if isinstance(ids, dict):
            print(f'  {flag:<18} {label}: ' + ', '.join(f'{i} (≤{c})' for i, c in ids.items()))
        else:
            print(f'  {flag:<18} {label} (≤{cap})' + (': ' + ', '.join(ids) if ids else ''))
    print('Up to 10 things per coupon. Boards and pack refills stop at what a library can hold.')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    n = sub.add_parser('new', help='make a coupon')
    n.add_argument('name')
    n.add_argument('--scraps', type=int)
    n.add_argument('--envelopes', type=int)
    n.add_argument('--material', action='append', help='id=count, repeatable')
    n.add_argument('--tool', action='append', help='link-tag=N or board=N, repeatable')
    n.add_argument('--pack', action='append', help='id=sets, repeatable')
    n.add_argument('--from', dest='start', help='opens at (YYYY-MM-DD or ISO time); default now')
    n.add_argument('--until', help='last day (YYYY-MM-DD) or ISO end time')
    n.add_argument('--days', type=int, default=14, help='open for this many days when --until is not given (default 14)')
    n.add_argument('--limit', type=int, help='only the first N Macs')
    n.add_argument('--title', default='From Peta')
    n.add_argument('--message', default='')
    n.add_argument('--key', help='official private key file (default PETA_SIGNING_KEY)')
    n.add_argument('--dry-run', action='store_true', help='sign and show it, but store nothing')
    n.add_argument('--key-id', default=os.environ.get('PETA_KEY_ID', 'k2'), help='official key slot (default k2, or PETA_KEY_ID)')
    for s in [n, sub.add_parser('list', help='recent coupons and how many Macs claimed them'), sub.add_parser('stop', help='close a coupon now'), sub.add_parser('catalog', help='what a coupon can give')]:
        s.add_argument('--env', choices=['prod', 'dev'], default='prod')
    sub.choices['stop'].add_argument('name')
    a = p.parse_args()
    {'new': new, 'list': listing, 'stop': stop, 'catalog': catalog}[a.cmd](a)


if __name__ == '__main__':
    main()
