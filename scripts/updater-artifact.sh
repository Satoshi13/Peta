#!/bin/bash
# Repackage only the final signed (and, when applicable, stapled) app. Never print signing credentials.
set -euo pipefail
umask 077
app=${1:?Usage: updater-artifact.sh Peta.app version output.tar.gz}
version=${2:?}; output=${3:?}
root=$(cd "$(dirname "$0")/.." && pwd)
[[ -f ${TAURI_SIGNING_PRIVATE_KEY_PATH:-} ]] || { echo 'Select the updater key on your encrypted disk with TAURI_SIGNING_PRIVATE_KEY_PATH.' >&2; exit 2; }
[[ ! -e $output && ! -e $output.sig ]] || { echo 'Choose a new updater output.' >&2; exit 2; }
python3 - "$app" "$version" <<'PYINFO'
import pathlib,plistlib,sys
info=plistlib.loads((pathlib.Path(sys.argv[1])/'Contents/Info.plist').read_bytes())
if info.get('CFBundleShortVersionString')!=sys.argv[2]:raise SystemExit('The app and updater version differ.')
allowed=info.get('CFBundleIdentifier')=='app.peta.desktop' or (info.get('CFBundleIdentifier')=='app.peta.updater-test' and sys.argv[2].endswith('-test'))
if not allowed:raise SystemExit('This app is not a Peta beta or isolated updater test.')
PYINFO
mkdir -p "$(dirname "$output")"
# Keep bundle files (including Contents/CodeResources), but omit AppleDouble metadata.
# Updater strips the app root; a top-level ._Peta.app would otherwise unpack onto its temp directory.
COPYFILE_DISABLE=1 tar -czf "$output" -C "$(dirname "$app")" "$(basename "$app")"
if ! env -u TAURI_SIGNING_PRIVATE_KEY "$root/node_modules/.bin/tauri" signer sign --app-version "$version" "$output" >/dev/null; then
  rm -f "$output" "$output.sig"; echo 'Updater signing failed. Check the encrypted key and password.' >&2; exit 1
fi
[[ -s $output.sig ]] || { rm -f "$output"; echo 'The updater signature was not created.' >&2; exit 1; }
