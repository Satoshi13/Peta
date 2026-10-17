#!/bin/bash
# Sign a ready official shop pack on this Mac and put it in the shop's storage (docs/official-packs-howto.md).
# Usage: bash scripts/sign-pack.sh <draftId> [prod|dev]
#
# 1. Fetches the draft made on the admin page (D1 row, pack.json and pictures in R2) with your own wrangler login.
# 2. Checks it with peta-pass (the app's limits, and that the version is newer than any signed one).
# 3. Opens a preview here, from the downloaded files, and asks before anything is signed. Look at every picture:
#    the server held the draft, and this is the last chance to catch a picture that was changed there.
# 4. peta-pass signs with the official key (prod: k2, dev: the public test key k1). The key file is read only by peta-pass;
#    this script passes its path and never opens, copies or prints it.
# 5. Verifies the signed file, puts it at shop/<packId>/<version>.peta and records it as signed (not yet on sale).
# The period is set on the admin page.
#
# PETA_SIGNING_KEY  key file (default /Volumes/Peta-private/official.key)
# PETA_KEY_ID       key number (default k2 for prod, k1 for dev)
# PETA_PASS         a built peta-pass (default: built here with cargo)
# PETA_WRANGLER     the wrangler command (default: npx wrangler, run in cloudflare/peta-api)
# PETA_OPEN         what opens the preview (default: open)
set -euo pipefail
draft=${1:?Usage: sign-pack.sh <draftId> [prod|dev]}
target=${2:-prod}
case "$target" in prod|dev) ;; *) echo 'The target is prod or dev.' >&2; exit 2;; esac
[[ $draft =~ ^d-[a-f0-9]{16}$ ]] || { echo 'Copy the draft ID from the admin page (it looks like d-0123456789abcdef).' >&2; exit 2; }
root=$(cd "$(dirname "$0")/.." && pwd)
db=peta-$target
bucket=peta-downloads-$target
key_id=${PETA_KEY_ID:-$([[ $target == prod ]] && echo k2 || echo k1)}
key=${PETA_SIGNING_KEY:-/Volumes/Peta-private/official.key}
read -r -a wrangler <<< "${PETA_WRANGLER:-npx wrangler}"
opener=${PETA_OPEN:-open}
work=$(mktemp -d "${TMPDIR:-/tmp}/peta-sign-pack.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir "$work/pack"

if [[ -n ${PETA_PASS:-} ]]; then peta_pass=$PETA_PASS
else
  echo 'Building peta-pass…' >&2
  cargo build --release -q --manifest-path "$root/src-tauri/Cargo.toml" -p peta-pass
  peta_pass=$root/src-tauri/target/release/peta-pass
fi
wr() { (cd "$root/cloudflare/peta-api" && "${wrangler[@]}" "$@"); }
sql() { wr d1 execute "$db" --remote --json --command "$1"; }
# The first result row of a `wrangler d1 execute --json` answer, as KEY=VALUE lines (keys and values are checked below).
row() { python3 -c 'import json,sys
rows=json.load(sys.stdin)[0]["results"]
for k,v in (rows[0] if rows else {}).items(): print(f"{k}={v}")'; }

# 1. The draft, as the admin page left it.
eval_row() { local line; while IFS= read -r line; do printf -v "row_${line%%=*}" '%s' "${line#*=}"; done; }
row_pack_id=''; row_version=''; row_state=''
eval_row < <(sql "SELECT pack_id,version,state FROM shop_pack_drafts WHERE draft_id='$draft'" | row)
[[ -n $row_pack_id ]] || { echo "No draft $draft in $target." >&2; exit 1; }
[[ $row_pack_id =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$ && $row_version =~ ^[1-9][0-9]{0,8}$ ]] || { echo 'The draft row is damaged.' >&2; exit 1; }
[[ $row_state == ready ]] || { echo "This draft is \"$row_state\", not ready to sign. Press Ready to sign on the admin page first." >&2; exit 1; }
pack=$row_pack_id; version=$row_version
row_v=0
eval_row < <(sql "SELECT COALESCE(MAX(version),0) AS v FROM shop_packs WHERE pack_id='$pack'" | row)
previous=$row_v
[[ $previous =~ ^[0-9]+$ ]] || { echo 'Could not read the signed versions.' >&2; exit 1; }

wr r2 object get "$bucket/shop/drafts/$draft/pack.json" --remote --file "$work/pack/pack.json" >/dev/null
keys=$(python3 - "$work/pack/pack.json" "$pack" "$version" <<'PY'
import json,re,sys
p=json.load(open(sys.argv[1]))
if p.get("packId")!=sys.argv[2] or p.get("version")!=int(sys.argv[3]): raise SystemExit("pack.json does not match the draft row.")
for i in p.get("items",[]):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}",str(i.get("key",""))): raise SystemExit("pack.json has an invalid sticker key.")
    print(i["key"])
PY
)
for k in $keys; do wr r2 object get "$bucket/shop/drafts/$draft/$k.png" --remote --file "$work/pack/$k.png" >/dev/null; done

# 2. The app's limits, checked here on the downloaded files.
summary=$("$peta_pass" shop-pack --check --json --dir "$work/pack" --previous-version "$previous")

# 3. Look before signing.
python3 - "$work/pack" "$summary" "$target" "$key_id" > "$work/pack/preview.html" <<'PY'
import html,json,sys
folder,summary,target,key_id=sys.argv[1],json.loads(sys.argv[2]),sys.argv[3],sys.argv[4]
e=html.escape
cards="".join(f'<figure><img src="{e(i["key"])}.png" alt=""><figcaption><b>{e(i["name"])}</b><br>{e(i["rarity"])} · {i["chance"]*100:.1f}%</figcaption></figure>' for i in summary["items"])
print(f'''<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"><title>Check before signing</title>
<style>body{{font:15px/1.6 -apple-system,sans-serif;background:#f8f4eb;color:#2d2c29;max-width:900px;margin:40px auto;padding:0 20px}}small{{color:#7d776b;letter-spacing:.14em}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}}figure{{margin:0;padding:10px;border:1px solid #d9d2c3;border-radius:6px;background:repeating-conic-gradient(#eee8db 0 25%,#fbf8f1 0 50%) 0 0/16px 16px}}
img{{display:block;width:100%;height:150px;object-fit:contain}}figcaption{{font-size:12px;margin-top:6px}}</style>
<small>CHECK BEFORE SIGNING · {e(target.upper())} · KEY {e(key_id)}</small>
<h1>{e(summary["title"])} <span style="font-weight:400">v{summary["version"]}</span></h1>
<p>{e(summary["packId"])} · by {e(summary["by"])} · {("Free (one set per Mac)" if summary.get("free") else str(summary["price"]) + " Scraps")} · {e(summary["pouch"])}{(" (" + e(summary["color"]) + ")") if summary.get("color") else ""} · {len(summary["items"])} stickers</p>
<p>{e(summary["blurb"])}</p><div class="grid">{cards}</div>
<p><small>THESE ARE THE FILES ON THIS MAC THAT WILL BE SIGNED. IF ANY PICTURE OR WORD LOOKS WRONG, ANSWER N.</small></p>''')
PY
python3 - "$summary" <<'PY' >&2
import json,sys
s=json.loads(sys.argv[1])
cost = "Free (one set per Mac)" if s.get("free") else str(s["price"]) + " Scraps"
print(f'\n{s["title"]} v{s["version"]} ({s["packId"]}) by {s["by"]} · {cost} · {s["pouch"]}' + (f' ({s["color"]})' if s.get("color") else ""))
if s["blurb"]: print(f'  "{s["blurb"]}"')
for i in s["items"]: print(f'  {i["name"]:<40} {i["rarity"]:<9} {i["chance"]*100:5.1f}%')
PY
"$opener" "$work/pack/preview.html" >/dev/null 2>&1 || echo "Open $work/pack/preview.html to check the pictures." >&2
printf '\nSign this pack with %s and put it in %s? [y/N] ' "$key_id" "$target" >&2
read -r answer || answer=''
[[ $answer == y || $answer == Y ]] || { echo 'Nothing was signed or uploaded.' >&2; exit 1; }

# 4. Sign. Only peta-pass reads the key file.
[[ -f $key ]] || { echo "No key file at $key. Connect the encrypted disk, or set PETA_SIGNING_KEY." >&2; exit 1; }
out=$work/$pack-$version.peta
signed=$("$peta_pass" shop-pack --key "$key" --key-id "$key_id" --dir "$work/pack" --previous-version "$previous" --out "$out" --json)
read -r size sha public price free title < <(python3 - "$signed" <<'PY'
import json,sys
s=json.loads(sys.argv[1])
# The title goes into SQL below: quotes are doubled; peta-pass already refused control characters and lengths over 40.
print(s["size"],s["sha256"],s["publicKey"],s["price"],int(s["free"]),json.dumps(s["title"].replace("'","''")))
PY
)
[[ $size =~ ^[0-9]+$ && $sha =~ ^[0-9a-f]{64}$ && $price =~ ^[0-9]+$ && $free =~ ^[01]$ ]] || { echo 'peta-pass gave an unexpected summary.' >&2; exit 1; }

# 5. Check the written file again, then put it in place and record it as signed (not on sale until the admin page says so).
"$peta_pass" verify "$out" --public-key "$public" >/dev/null
title=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]))' "$title")
wr r2 object put "$bucket/shop/$pack/$version.peta" --file "$out" --content-type application/octet-stream --remote >/dev/null
now=$(date +%s)
sql "INSERT INTO shop_packs(pack_id,version,title,file,size,sha256,price,created_at,draft_id,key_id,free) VALUES('$pack',$version,'$title','shop/$pack/$version.peta',$size,'$sha',$price,$now,'$draft','$key_id',$free); UPDATE shop_pack_drafts SET state='signed',updated_at=$now WHERE draft_id='$draft' AND state='ready';" >/dev/null
echo "Signed $pack v$version ($size bytes, sha256 $sha) and put it in $target. Choose its period on the admin page's Packs tab." >&2
