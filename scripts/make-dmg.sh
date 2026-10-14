#!/bin/bash
# Lay out the Peta disk image: the app, an Applications link, and the paper background from assets-src/dmg.
# Signing and notarizing the image is release-mac.sh's job; this only builds the window.
# Usage: bash scripts/make-dmg.sh <Peta.app> <output.dmg>
set -euo pipefail
umask 022
app=${1:?Usage: make-dmg.sh <Peta.app> <output.dmg>}
output=${2:?Usage: make-dmg.sh <Peta.app> <output.dmg>}
root=$(cd "$(dirname "$0")/.." && pwd)
background="$root/assets-src/dmg/background.tiff"
volume=Peta
[[ -d "$app" && -f "$app/Contents/Info.plist" ]] || { echo "Not an app bundle: $app" >&2; exit 2; }
[[ -f "$background" ]] || { echo "Missing $background" >&2; exit 2; }
[[ ! -e "$output" ]] || { echo "Choose a new output; $output already exists." >&2; exit 2; }
[[ ! -e "/Volumes/$volume" ]] || { echo "Eject the disk named $volume first." >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/peta-dmg.XXXXXX")
device=
cleanup() { [[ -n $device ]] && hdiutil detach "$device" -quiet -force || true; rm -rf "$work"; }
trap cleanup EXIT
stage="$work/stage"
mkdir -p "$stage/.background"
ditto "$app" "$stage/Peta.app"
ln -s /Applications "$stage/Applications"
cp "$background" "$stage/.background/background.tiff"
icon=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$app/Contents/Info.plist" 2>/dev/null || true)
[[ -n $icon && $icon != *.icns ]] && icon="$icon.icns"
[[ -n $icon && -f "$app/Contents/Resources/$icon" ]] && cp "$app/Contents/Resources/$icon" "$stage/.VolumeIcon.icns"

size=$(( $(du -sm "$stage" | cut -f1) + 40 ))
hdiutil create -quiet -srcfolder "$stage" -volname "$volume" -fs HFS+ -format UDRW -size "${size}m" "$work/rw.dmg"
device=$(hdiutil attach "$work/rw.dmg" -readwrite -noverify -noautoopen | awk '/Apple_HFS/{print $1}')
mount="/Volumes/$volume"
[[ -d $mount ]] || { echo "The image did not mount at $mount." >&2; exit 1; }
[[ -f "$mount/.VolumeIcon.icns" ]] && SetFile -a C "$mount" 2>/dev/null || true
# Centers match the artwork (assets-src/dmg/source/installer.css): Peta (213,313), Applications (548,315), 80px icons.
# The window is 768x512 of content plus the title bar.
osascript <<OSA
tell application "Finder"
  tell disk "$volume"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 968, 660}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 80
    set text size of opts to 12
    set background picture of opts to file ".background:background.tiff"
    set position of item "Peta.app" of container window to {213, 313}
    set position of item "Applications" of container window to {548, 315}
    update without registering applications
    delay 1
    close
    -- Finder keeps the window size and chrome only after a second open.
    open
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 968, 660}
    delay 1
    close
  end tell
end tell
OSA
SetFile -a V "$mount/.background" 2>/dev/null || chflags hidden "$mount/.background"
[[ -f "$mount/.VolumeIcon.icns" ]] && { SetFile -a V "$mount/.VolumeIcon.icns" 2>/dev/null || chflags hidden "$mount/.VolumeIcon.icns"; }
rm -rf "$mount/.fseventsd" 2>/dev/null || true
sync
hdiutil detach "$device" -quiet
device=
mkdir -p "$(dirname "$output")"
hdiutil convert -quiet "$work/rw.dmg" -format ULFO -o "$output"
hdiutil verify -quiet "$output"
printf 'Disk image: %s\n' "$output"
