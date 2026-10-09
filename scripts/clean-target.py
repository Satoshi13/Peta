#!/usr/bin/env python3
"""Trim src-tauri/target without touching what the current build uses.

  python3 scripts/clean-target.py          # list what would go (nothing is deleted)
  python3 scripts/clean-target.py --apply  # delete it
  add --deep to also drop older builds of the same crate (saves more, but see below)

Why this exists: on macOS the dev profile keeps every compiled object file (*.o) so a debugger can read the debug info, and it never
deletes the old ones. One rebuild leaves about 3 GB of them behind; they had piled up to 14 GB (the whole target/ reached 20 GB).
They are not needed to build or run. Removed here:
  1. *.o in target/debug/deps older than 3 hours (the debug info of builds that no longer exist)
  2. cross-target builds (target/<triple>) untouched for 2 days
  3. with --deep only: older builds of the same crate (a hash group more than 12 hours older than the newest one), in deps/ and build/.
     This goes by file age, and cargo does not touch an artifact it reuses, so a crate that is still in use can look "old".
     The next build then recompiles it (a few minutes, once). Nothing breaks, but that is why it is not the default.
Nothing outside src-tauri/target is touched."""
import collections, os, re, shutil, sys, time
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "src-tauri" / "target"
APPLY = "--apply" in sys.argv
DEEP = "--deep" in sys.argv
HASHED = re.compile(r"^(?:lib)?(?P<stem>.+?)-(?P<hash>[0-9a-f]{16})(?:\.[A-Za-z0-9]+)*$")
now = time.time()

def size(p: Path) -> int:
    if p.is_symlink() or p.is_file(): return p.lstat().st_size
    return sum(f.lstat().st_size for f in p.rglob("*") if f.is_file() and not f.is_symlink())
def newest(p: Path) -> float:
    if p.is_symlink() or p.is_file(): return p.lstat().st_mtime
    return max([p.lstat().st_mtime] + [f.lstat().st_mtime for f in p.rglob("*")])

plan: list[tuple[Path, int, str]] = []
deps = TARGET / "debug" / "deps"
if deps.is_dir():
    for f in deps.iterdir():
        if f.suffix == ".o" and now - f.lstat().st_mtime > 3 * 3600: plan.append((f, f.lstat().st_size, "object files of old builds"))
for sub in (("deps", "build") if DEEP else ()):
    d = TARGET / "debug" / sub
    if not d.is_dir(): continue
    groups: dict[str, dict[str, list[Path]]] = collections.defaultdict(lambda: collections.defaultdict(list))
    for f in d.iterdir():
        m = HASHED.match(f.name)
        if m and f.suffix != ".o": groups[m["stem"]][m["hash"]].append(f)
    for hashes in groups.values():
        times = {h: max(newest(p) for p in ps) for h, ps in hashes.items()}
        top = max(times.values())
        for h, ps in hashes.items():
            if top - times[h] > 12 * 3600: plan += [(p, size(p), "older builds of the same crate") for p in ps]
for x in TARGET.iterdir() if TARGET.is_dir() else []:
    if x.is_dir() and re.fullmatch(r"[a-z0-9_]+-[a-z]+-[a-z]+(-[a-z]+)?", x.name) and now - newest(x) > 2 * 86400:
        plan.append((x, size(x), "cross-target build"))

by = collections.Counter(); [by.update({why: b}) for _, b, why in plan]
print(("DELETING" if APPLY else "DRY RUN (nothing deleted)") + f": {len(plan)} items, {sum(by.values()) / 1e9:.2f} GB")
for why, b in by.most_common(): print(f"  {b / 1e9:6.2f} GB  {why}")
if APPLY:
    for p, _, _ in plan:
        try: shutil.rmtree(p) if p.is_dir() and not p.is_symlink() else p.unlink()
        except OSError as e: print("skipped", p, e)
    print("done. The next build may recompile a crate or two; that is expected.")
else:
    print("add --apply to delete")
