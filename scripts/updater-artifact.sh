#!/bin/bash
# Repackage only the final signed (and, when applicable, stapled) app. Never print signing credentials.
set -euo pipefail
umask 077
app=${1:?Usage: updater-artifact.sh Peta.app version output.tar.gz}
version=${2:?}; output=${3:?}
root=$(cd "$(dirname "$0")/.." && pwd)
[[ -f ${TAURI_SIGNING_PRIVATE_KEY_PATH:-} ]] || { echo 'Select the updater key on your encrypted disk with TAURI_SIGNING_PRIVATE_KEY_PATH.' >&2; exit 2; }
[[ ! -e $output && ! -e $output.sig ]] || { echo 'Choose a new updater output.' >&2; exit 2; }
mkdir -p "$(dirname "$output")"
# macOS bsdtar preserves the app bundle, including the stapled notarization ticket.
tar -czf "$output" -C "$(dirname "$app")" "$(basename "$app")"
if ! "$root/node_modules/.bin/tauri" signer sign --app-version "$version" "$output" >/dev/null; then
  rm -f "$output" "$output.sig"; echo 'Updater signing failed. Check the encrypted key and password.' >&2; exit 1
fi
[[ -s $output.sig ]] || { rm -f "$output"; echo 'The updater signature was not created.' >&2; exit 1; }
