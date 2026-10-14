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
unsigned=false
case "${3:-}" in --unsigned) unsigned=true;; '') ;; *) echo 'The third argument can only be --unsigned.' >&2; exit 2;; esac
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

size=$(stat -f %z "$dmg")
sha=$(shasum -a 256 "$dmg" | cut -d' ' -f1)
manifest=$(mktemp "${TMPDIR:-/tmp}/peta-latest.XXXXXX")
notarized=true; $unsigned && notarized=false
python3 - "$manifest" "$version" "$file" "$size" "$sha" "$minimum" "$archs" "$notarized" <<'PY'
import json,sys,datetime
out,version,file,size,sha,minimum,archs,notarized=sys.argv[1:]
json.dump({"version":version,"file":file,"size":int(size),"sha256":sha,"minimumSystemVersion":minimum,
  "architectures":sorted(a for a in archs.split() if a in ("arm64","x86_64")),
  "publishedAt":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),"notarized":notarized=="true"},open(out,"w"),indent=1)
PY
cat "$manifest"
printf '\nUpload %s (%s bytes) to %s and switch the %s download page to it? [y/N] ' "$file" "$size" "$bucket" "$target"
read -r answer
[[ $answer == y || $answer == Y ]] || { echo 'Nothing was uploaded.'; exit 1; }
cd "$root/cloudflare/peta-download"
npx wrangler r2 object put "$bucket/releases/$file" --file "$dmg" --content-type application/x-apple-diskimage --remote
npx wrangler r2 object put "$bucket/releases/latest.json" --file "$manifest" --content-type application/json --remote
rm -f "$manifest"
printf 'Published %s. Friends see it on the next page load.\n' "$file"
