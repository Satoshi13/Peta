#!/bin/bash
# Owner-run only. The encrypted volume and its backup remain under the owner's control.
set -euo pipefail
umask 077
path=${1:?Usage: updater-key.sh /Volumes/encrypted-disk/updater.key}
root=$(cd "$(dirname "$0")/.." && pwd)
python3 - "$path" "$root" <<'PY'
import pathlib,sys,subprocess,plistlib
p=pathlib.Path(sys.argv[1]).resolve(); root=pathlib.Path(sys.argv[2]).resolve()
if not p.is_absolute() or root==p or root in p.parents or p.exists() or pathlib.Path(str(p)+'.pub').exists():
 raise SystemExit('Choose a NEW key file outside the repository on your encrypted disk.')
if not p.parent.is_dir():raise SystemExit('Mount your encrypted disk and choose an existing directory.')
r=subprocess.run(['diskutil','info','-plist',str(p.parent)],capture_output=True)
try: info=plistlib.loads(r.stdout)
except Exception: raise SystemExit('Cannot verify the encrypted volume. No key was created.')
def image_encrypted(mount):
 # An encrypted disk image (Disk Utility, "128-bit AES") encrypts the image, so the volume inside reports Encrypted: No.
 r=subprocess.run(['hdiutil','info','-plist'],capture_output=True)
 try: images=plistlib.loads(r.stdout).get('images',[])
 except Exception: return False
 return any(i.get('image-encrypted') is True and any(e.get('mount-point')==mount for e in i.get('system-entities',[])) for i in images)
if not any(info.get(k) is True for k in ('Encrypted','Encryption','FileVault')) and not (info.get('MountPoint') and image_encrypted(info['MountPoint'])):
 raise SystemExit('This volume does not report encryption. Mount an encrypted disk before creating the key.')
PY
# The CLI prompts for the password. Its output may include key material, so suppress it.
"$root/node_modules/.bin/tauri" signer generate --write-keys "$path" >/dev/null
cat "$path.pub"
printf '\nPut this PUBLIC key in src-tauri/tauri.beta.conf.json (plugins.updater.pubkey).\nKeep the private key and an encrypted backup on your own encrypted disk.\n'
