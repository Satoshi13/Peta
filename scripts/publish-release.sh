#!/bin/bash
# Put a finished Peta disk image on the friends-only download page (cloudflare/peta-download).
# The image goes to the private R2 bucket first; releases/latest.json, written last, switches the page to it.
# Usage: bash scripts/publish-release.sh <Peta-x.y.z.dmg> [prod|dev] [--unsigned]
# Production refuses an image that is not signed, notarized and stapled, unless --unsigned says it was built without the
# Apple Developer Program (release-mac.sh --unsigned); the page then shows friends how to open it the first time. Nothing here holds credentials:
# wrangler uses your own Cloudflare login.
set -euo pipefail
dmg=${1:?Usage: publish-release.sh <Peta-x.y.z.dmg> [prod|dev] [--unsigned]}
target=${2:-prod}
unsigned=false; notes=''; keep=3
shift $(( $# >= 2 ? 2 : 1 ))
while [[ $# -gt 0 ]]; do
  case "$1" in
    --unsigned) unsigned=true; shift;;
    --notes) notes=${2:?Supply English release notes.}; shift 2;;
    --keep) keep=${2:?Supply a number of versions to keep.}; shift 2;;
    *) echo 'Use --unsigned, --notes "...", or --keep N.' >&2; exit 2;;
  esac
done
[[ $keep =~ ^[1-9][0-9]*$ ]] || { echo 'Keep at least one version.' >&2; exit 2; }
case "$target" in prod|dev) ;; *) echo 'The target is prod or dev.' >&2; exit 2;; esac
root=$(cd "$(dirname "$0")/.." && pwd)
bucket=peta-downloads-$target
file=$(basename "$dmg")
[[ -f "$dmg" ]] || { echo "No such file: $dmg" >&2; exit 2; }
[[ $file =~ ^[A-Za-z0-9._-]{1,80}\.dmg$ ]] || { echo 'Name the image like Peta-0.1.0.dmg (letters, digits, . _ -).' >&2; exit 2; }

hdiutil verify -quiet "$dmg"
if [[ $target == prod ]] && ! $unsigned; then
  codesign --verify --strict "$dmg"
  xcrun stapler validate -q "$dmg"
  spctl -a -t open --context context:primary-signature "$dmg"
fi

# Read the real version, minimum macOS and architectures from the app inside, never from a guess.
mnt=$(mktemp -d "${TMPDIR:-/tmp}/peta-publish.XXXXXX")
trap 'hdiutil detach "$mnt" -quiet -force 2>/dev/null || true; rmdir "$mnt" 2>/dev/null || true' EXIT
hdiutil attach "$dmg" -readonly -nobrowse -noautoopen -mountpoint "$mnt" -quiet
app="$mnt/Peta.app"
[[ -d $app ]] || { echo 'The image has no Peta.app at its top level.' >&2; exit 2; }
plist="$app/Contents/Info.plist"
identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")
[[ $identifier == app.peta.desktop ]] || { echo 'Only the distribution Peta app can be published. Developer and updater-test builds are not releases.' >&2; exit 2; }
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")
minimum=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist")
binary=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")
archs=$(lipo -archs "$app/Contents/MacOS/$binary")
if [[ $target == prod ]] && ! $unsigned; then
  codesign --verify --deep --strict "$app"
  xcrun stapler validate -q "$app"
else
  codesign --verify --deep --strict "$app"   # an ad-hoc signature still has to be intact
fi
hdiutil detach "$mnt" -quiet
[[ $file == *"$version"* ]] || { echo "The file name should carry the app's version ($version)." >&2; exit 2; }

archive=${dmg%.dmg}.app.tar.gz
signature_file=''
if [[ $file != Peta-offline-* ]]; then
signature_file=$archive.sig
[[ " $archs " == *" arm64 "* && " $archs " == *" x86_64 "* ]] || { echo 'Beta updater archives must contain both Mac architectures.' >&2; exit 2; }
[[ -s $archive && -s $archive.sig ]] || { echo 'The beta updater archive and signature must be beside the disk image.' >&2; exit 2; }
python3 - "$archive" "$version" <<'PYARCH'
import sys,tarfile,plistlib
with tarfile.open(sys.argv[1],'r:gz') as t:
 p=plistlib.loads(t.extractfile('Peta.app/Contents/Info.plist').read())
 if p['CFBundleShortVersionString']!=sys.argv[2]:raise SystemExit('Updater and disk image versions differ.')
PYARCH
fi
size=$(stat -f %z "$dmg")
sha=$(shasum -a 256 "$dmg" | cut -d' ' -f1)
manifest=$(mktemp "${TMPDIR:-/tmp}/peta-latest.XXXXXX")
notarized=true; $unsigned && notarized=false
python3 - "$manifest" "$version" "$file" "$size" "$sha" "$minimum" "$archs" "$notarized" "$signature_file" "$notes" <<'PY'
import json,sys,datetime
out,version,file,size,sha,minimum,archs,notarized,sig,notes=sys.argv[1:]
signature=open(sig).read().strip() if sig else None
import re
if signature is not None and not re.fullmatch(r"[A-Za-z0-9+/=]{40,4096}",signature):raise SystemExit("Invalid updater signature file.")
if len(notes)>8000:raise SystemExit("Release notes must be at most 8000 characters.")
value={"version":version,"file":file,"size":int(size),"sha256":sha,"minimumSystemVersion":minimum,
  "architectures":sorted(a for a in archs.split() if a in ("arm64","x86_64")),
  "publishedAt":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),"notarized":notarized=="true","update":{"version":version,"file":f"updates/{version}/Peta.app.tar.gz","signature":signature,"notes":notes}}
if signature is None:value.pop("update")
json.dump(value,open(out,"w"),indent=1)
PY
cat "$manifest"
printf '\nUpload %s (%s bytes) to %s and switch the %s download page to it? [y/N] ' "$file" "$size" "$bucket" "$target"
read -r answer
[[ $answer == y || $answer == Y ]] || { echo 'Nothing was uploaded.'; exit 1; }
cd "$root/cloudflare/peta-download"
npx wrangler r2 object put "$bucket/releases/$file" --file "$dmg" --content-type application/x-apple-diskimage --remote
if [[ -n $signature_file ]]; then
npx wrangler r2 object put "$bucket/releases/updates/$version/Peta.app.tar.gz" --file "$archive" --content-type application/gzip --remote
npx wrangler r2 object put "$bucket/releases/updates/$version/Peta.app.tar.gz.sig" --file "$archive.sig" --content-type text/plain --remote
fi
npx wrangler r2 object put "$bucket/releases/latest.json" --file "$manifest" --content-type application/json --remote
python3 "$root/scripts/prune-releases.py" "$target" "$manifest" --keep "$keep"
rm -f "$manifest"
printf 'Published %s. Friends see it on the next page load.\n' "$file"
