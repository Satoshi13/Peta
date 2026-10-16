#!/usr/bin/env python3
"""Exercise scripts/sign-pack.sh against a fake wrangler (local SQLite + folder for R2) and a disposable key.

Checks: it stops for a draft that isn't ready; it builds a preview from the downloaded files; "n" signs and uploads nothing;
"y" signs, verifies, uploads and records the pack; a second run refuses an older-or-equal version; the key's contents never
appear in any output, log, preview or upload. Never touches a real Cloudflare account or a real key.
"""
from pathlib import Path
import json, os, shutil, sqlite3, struct, subprocess, sys, tempfile, zlib

root = Path(__file__).resolve().parents[1]
FAKE_WRANGLER = r'''#!/usr/bin/env python3
import json,os,shutil,sqlite3,sys
args=sys.argv[1:]
with open(os.environ["FAKE_LOG"],"a") as log: log.write(" ".join(args)+"\n")
store=os.environ["FAKE_R2"]
if args[:2]==["d1","execute"]:
    command=args[args.index("--command")+1]
    db=sqlite3.connect(os.environ["FAKE_DB"]);db.row_factory=sqlite3.Row
    results=[]
    for statement in [s for s in command.split(";") if s.strip()]:
        cur=db.execute(statement);results=[dict(r) for r in cur.fetchall()] if cur.description else results
    db.commit();print(json.dumps([{"results":results,"success":True}]))
elif args[:3]==["r2","object","get"]:
    src=os.path.join(store,args[3]);dst=args[args.index("--file")+1]
    if not os.path.exists(src): sys.exit("The specified key does not exist.")
    shutil.copy(src,dst)
elif args[:3]==["r2","object","put"]:
    dst=os.path.join(store,args[3]);os.makedirs(os.path.dirname(dst),exist_ok=True);shutil.copy(args[args.index("--file")+1],dst)
else: sys.exit("unexpected wrangler call: "+" ".join(args))
'''
FAKE_OPEN = '#!/bin/sh\ncp "$1" "$FAKE_PREVIEW"\n'

def png(w, h):
    raw = b"".join(b"\x00" + b"".join(bytes([190, 100, 60, 255 if (x - w / 2) ** 2 + (y - h / 2) ** 2 < (min(w, h) / 3) ** 2 else 0]) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

def main():
    subprocess.run(["cargo", "build", "-q", "--manifest-path", "src-tauri/Cargo.toml", "-p", "peta-pass"], cwd=root, check=True)
    peta_pass = root / "src-tauri/target/debug/peta-pass"
    with tempfile.TemporaryDirectory(prefix="peta-sign-pack-test-") as d:
        d = Path(d); r2 = d / "r2"; bin_ = d / "bin"; bin_.mkdir()
        (bin_ / "wrangler").write_text(FAKE_WRANGLER); (bin_ / "open").write_text(FAKE_OPEN)
        for f in bin_.iterdir(): f.chmod(0o755)
        key = d / "disposable.key"
        subprocess.run([peta_pass, "keygen", "--out", key], check=True, capture_output=True)
        secret = key.read_bytes()
        db = sqlite3.connect(d / "d1.sqlite")
        db.executescript((root / "cloudflare/peta-api/migrations/0011_shop_packs.sql").read_text())
        draft, other = "d-0123456789abcdef", "d-00000000000000aa"
        manifest = {"packId": "autumn", "version": 1, "title": "Autumn's Walk", "by": "Peta", "blurb": "Leaves <on> the way home.", "pouch": "matte", "color": "rose", "price": 12,
                    "items": [{"key": "maple", "name": "Maple Leaf", "rarity": "common", "weight": 7}, {"key": "acorn", "name": "Acorn", "rarity": "uncommon"}, {"key": "chestnut", "name": "Chestnut", "rarity": "rare"}]}
        db.execute("INSERT INTO shop_pack_drafts VALUES(?,?,?,?,?,0,0)", (draft, "autumn", 1, "ready", json.dumps(manifest)))
        db.execute("INSERT INTO shop_pack_drafts VALUES(?,?,?,?,?,0,0)", (other, "winter", 1, "draft", "{}"))
        db.commit()
        folder = r2 / "peta-downloads-dev/shop/drafts" / draft; folder.mkdir(parents=True)
        (folder / "pack.json").write_text(json.dumps(manifest))
        for i in manifest["items"]: (folder / f'{i["key"]}.png').write_bytes(png(64, 48))
        env = {**os.environ, "PETA_PASS": str(peta_pass), "PETA_WRANGLER": str(bin_ / "wrangler"), "PETA_OPEN": str(bin_ / "open"), "PETA_SIGNING_KEY": str(key),
               "FAKE_DB": str(d / "d1.sqlite"), "FAKE_R2": str(r2), "FAKE_LOG": str(d / "wrangler.log"), "FAKE_PREVIEW": str(d / "preview.html")}
        run = lambda draft_id, answer: subprocess.run(["bash", "scripts/sign-pack.sh", draft_id, "dev"], cwd=root, env=env, input=answer, text=True, capture_output=True)
        signed = lambda: list(r2.glob("peta-downloads-dev/shop/autumn/*.peta"))

        not_ready = run(other, "y\n")
        assert not_ready.returncode != 0 and "not ready to sign" in not_ready.stderr, not_ready.stderr
        assert run("d-bad", "y\n").returncode == 2

        declined = run(draft, "n\n")
        assert declined.returncode != 0 and "Nothing was signed or uploaded." in declined.stderr, declined.stderr
        assert not signed() and db.execute("SELECT COUNT(*) FROM shop_packs").fetchone()[0] == 0
        assert "r2 object put" not in (d / "wrangler.log").read_text()
        preview = (d / "preview.html").read_text()
        assert 'src="maple.png"' in preview and "Autumn&#x27;s Walk" in preview and "Leaves &lt;on&gt; the way home." in preview and "70.0%" in preview, preview
        assert "Maple Leaf" in declined.stderr and "70.0%" in declined.stderr

        accepted = run(draft, "y\n")
        assert accepted.returncode == 0, accepted.stderr
        [file] = signed(); data = file.read_bytes()
        row = db.execute("SELECT title,size,sha256,price,starts_at,draft_id,key_id FROM shop_packs WHERE pack_id='autumn' AND version=1").fetchone()
        import hashlib
        assert row == ("Autumn's Walk", len(data), hashlib.sha256(data).hexdigest(), 12, None, draft, "k1"), row
        assert db.execute("SELECT state FROM shop_pack_drafts WHERE draft_id=?", (draft,)).fetchone()[0] == "signed"
        public = subprocess.run([peta_pass, "pubkey", key], check=True, capture_output=True, text=True).stdout.split()[0]
        subprocess.run([peta_pass, "verify", file, "--public-key", public], check=True, capture_output=True)

        # Signed already: the draft is no longer ready, and an equal version would be refused by --previous-version.
        db.execute("UPDATE shop_pack_drafts SET state='ready' WHERE draft_id=?", (draft,)); db.commit()
        again = run(draft, "y\n")
        assert again.returncode != 0 and "not newer" in again.stderr, again.stderr
        assert len(signed()) == 1

        # The key never leaves peta-pass: not in any output, the wrangler log, the preview or the uploaded file.
        import base64
        for form in (secret, secret.hex().encode(), base64.b64encode(secret)):
            for blob in (not_ready.stdout + not_ready.stderr, declined.stdout + declined.stderr, accepted.stdout + accepted.stderr, again.stdout + again.stderr):
                assert form not in blob.encode()
            assert form not in (d / "wrangler.log").read_bytes() and form not in (d / "preview.html").read_bytes() and form not in data
        print("sign-pack.sh: ready-only, preview from downloaded files, n uploads nothing, y signs/verifies/uploads/records, older versions refused, key never shown: PASS")

if __name__ == "__main__":
    main()
