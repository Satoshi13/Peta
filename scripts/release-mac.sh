#!/bin/bash
# Explicit owner-run Developer ID signing and notarization. No credentials are stored here.
set -euo pipefail
umask 077
mode=${1:-beta}
case "$mode" in beta) build=build:beta;; offline) build=build;; *) echo 'Usage: bash scripts/release-mac.sh [beta|offline]' >&2; exit 2;; esac
if [[ ${APPLE_SIGNING_IDENTITY:-} != 'Developer ID Application: '* || -z ${PETA_NOTARY_PROFILE:-} ]]; then
  cat >&2 <<'HELP'
Set APPLE_SIGNING_IDENTITY to your Developer ID Application certificate name,
and PETA_NOTARY_PROFILE to a profile stored in your keychain.
One-time owner setup: enroll in Apple Developer Program, install a Developer ID
Application certificate with its private key, then run:
  xcrun notarytool store-credentials "Peta-notary"
Credentials are missing; no build, signing or Apple connection was attempted.
See docs/distribution-howto.md. Never put passwords or private keys in this repository.
HELP
  exit 2
fi
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
app=${PETA_APP_PATH:-$root/src-tauri/target/universal-apple-darwin/release/bundle/macos/Peta.app}
version=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$root/src-tauri/tauri.conf.json")
name=Peta-$version; [[ $mode == offline ]] && name=Peta-offline-$version
output=${PETA_RELEASE_OUTPUT:-$root/src-tauri/target/release/distribution/$name.dmg}
if [[ -e "$output" ]]; then echo 'Choose a new PETA_RELEASE_OUTPUT or raise the version; this disk image already exists.' >&2; exit 2; fi
if ! security find-identity -v -p codesigning | /usr/bin/grep -F -- "\"$APPLE_SIGNING_IDENTITY\"" >/dev/null; then
  echo 'The requested certificate and private key are unavailable in the keychain. Install them before releasing.' >&2; exit 2
fi
if [[ -n ${PETA_ENTITLEMENTS:-} && ! -f "$PETA_ENTITLEMENTS" ]]; then echo 'PETA_ENTITLEMENTS must name an existing reviewed plist.' >&2; exit 2; fi
npm run "$build"
python3 scripts/check-binary-paths.py "$app"
args=(--force --deep --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY")
if [[ -n ${PETA_ENTITLEMENTS:-} ]]; then args+=(--entitlements "$PETA_ENTITLEMENTS"); fi
codesign "${args[@]}" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
work=$(mktemp -d "${TMPDIR:-/tmp}/peta-release.XXXXXX")
trap 'rm -rf "$work"' EXIT
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/submission.zip"
xcrun notarytool submit "$work/submission.zip" --keychain-profile "$PETA_NOTARY_PROFILE" --wait --output-format json > "$work/notary.json"
accepted() { python3 - "$1" <<'PY'
import json,sys
result=json.load(open(sys.argv[1]))
print('Notarization status:',result.get('status','unknown'))
if result.get('status')!='Accepted':
    print('No disk image was created. Review the submission in notarytool history/log.',file=sys.stderr)
    raise SystemExit(1)
PY
}
accepted "$work/notary.json"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -vv --type execute "$app"
# The disk image holds the stapled app, so it opens offline once copied to Applications; the image itself is signed,
# notarized and stapled too, so Gatekeeper accepts the download before it is opened.
bash "$root/scripts/make-dmg.sh" "$app" "$work/Peta.dmg"
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$work/Peta.dmg"
codesign --verify --strict --verbose=2 "$work/Peta.dmg"
xcrun notarytool submit "$work/Peta.dmg" --keychain-profile "$PETA_NOTARY_PROFILE" --wait --output-format json > "$work/notary-dmg.json"
accepted "$work/notary-dmg.json"
xcrun stapler staple "$work/Peta.dmg"
xcrun stapler validate "$work/Peta.dmg"
spctl -a -vv --type open --context context:primary-signature "$work/Peta.dmg"
mkdir -p "$(dirname "$output")"
mv "$work/Peta.dmg" "$output"
printf 'Verified disk image: %s\nPublish it with: bash scripts/publish-release.sh %q prod\n' "$output" "$output"
