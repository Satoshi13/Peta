# Native port comparisons

The right-hand images are captures of `src/app.html` in the **real debug Tauri application / WebKitGTK**, using Rust IPC and a temporary SQLite library. No mock bridge or prototype desktop is rendered there. The original golden JPGs remain unchanged. Window comparisons crop their 1060×700 app rectangle at (190,79); capture files retain the native screenshot separately.

Reproduce on a desktop with Rust, Tauri's platform dependencies, Python/Pillow, ImageMagick and xdotool (Linux):

1. `python3 scripts/port-fixture.py /tmp/peta-port-data/app.peta.desktop`
2. Build with `cargo build --manifest-path src-tauri/Cargo.toml`.
3. Run the debug binary with `XDG_DATA_HOME=/tmp/peta-port-data PETA_PORT_CAPTURE_DIR=/tmp/peta-capture` (create the capture directory first).
4. `python3 scripts/port-capture.py 1 studio-20-settings`. The capture bridge is disabled in release builds and unless explicitly enabled in the debug process environment.

The fixture is isolated under `/tmp`; its sample PNGs are copied unchanged into the test library. It does not replace runtime data. Differences in fixture sticker IDs, titles and history are not fabricated to match the prototype. The Linux WebKit system sans font has different metrics from the golden Chromium font; the specified `--sys` stack and numerical sizes are preserved. Klee One and Special Elite are bundled for offline use (see `src/fonts/NOTICE.md` for the upstream licensing discrepancy).

## Slice 1

- One native Studio/Desk shell, navigation and persisted Settings; native hide/minimize/maximize/drag/resize and tray routes.
- `slice-01-{studio,desk}-20-settings.jpg`: golden / native comparisons.
- `slice-01-audit.json`: **0 issues** in Settings for both shells, at 1060×700 and 720×520, using the original prototype scanner inside the actual webview.
- Existing tests: 80 Rust core tests and 13 placement tests passed. Native debug build passed.

## Slice 2

- Today’s complete envelope → horizontal tear → pull → Keep it → material tray flow ran with native mouse gestures in both shells. Material ownership/counts come from `daily_open_material` / `material_book`; the UI does not award stock itself.
- Ten comparison states (01–05, both shells); Today/Settings audit: 0 issues at both sizes.
- The initial slice-2 captures had a ceremony limited to the app webview. Slice 5 fixes the viewport geometry, and `slice-07-*-02/03/04/05-*` captures verify Today again after that fix. Accent-font glyphs also differ because the native app loads the bundled Klee One rather than the golden’s apparent cursive fallback. These differences are visible, not claimed as pixel equality.

## Slice 3

- Book month tabs/details/turn-over, Materials stock and sealed Gifts now use real library commands. Gift import/export use native file dialogs; the previous Collection page was removed.
- Eight native/golden comparisons (09, 10, 15, 19, both shells). Back-card history comes from provenance, rather than invented names or timestamps. The fixture's PNGs have their original alpha; golden stickers were outlined by the prototype renderer.
- At both sizes: 0 text/layout issues, with known WebKit false positives from the paper button artwork (`::before` inset -3px -4px). Raw entries and the exact exclusion reason are retained in the audit JSON; CSS values are unchanged.

## Slice 4

- Native Create retains the prototype DOM, sliders (outline 4–64/default 20), material tray and brush gestures. Rust performs all real cutting/rendering/history; sample backgrounds alone use the original `fakePhoto` display helper.
- Four comparisons (06–07, both shells); audit at both sizes: 0 issues apart from the documented paper-art false positives. The original 31vh pane height uses display height, matching the prototype's surrounding desktop viewport.
- `slice-04-controls.json`: a native mouse Erase stroke changed Rust PNG bytes; Cmd-Z restored identical bytes and Shift-Cmd-Z restored the edited bytes. Restore and the outline control were also exercised. The Rust material renderer naturally differs from the prototype's reference canvas renderer.

## Slice 5

- Packs shelf and the full tear → sleeve pull → reveal → Later flow ran with native mouse gestures in both shells; eight comparisons (11–14), audit: 0 issues at both sizes.
- The same main native window now expands temporarily for the original display-wide ceremony and restores its prior size/position. This corrects the geometry limitation recorded for slice 2; no extra content window or simulated desktop was added.
- Pack/Gift commands keep the pending sticker without activating the desktop layer during the ceremony. `Stick it` closes the main window before resuming print, preventing the print layer from intercepting the pull gesture.
- The isolated fixture includes actual Tokyo/Coffee pack rows. Stock, remaining counts, randomly drawn art and back identifiers remain real backend values and can differ from the reference state.

## Slice 6

- Static Market Packs/Materials/Creators and pack details copy the original data/DOM. Six comparisons (16–18, both shells), audit: 0 issues at both sizes.
- Free local demo packs can be added to the actual shelf. Paid packs, material purchases and creator accounts retain `TODO(owner)` and do not pretend to transact.
- Static catalog previews use the original cached canvas renderer, preserving its outline and scaling values. Real uploads/cutting/saved stickers continue to use Rust. Capture waits for all preview images; ownership labels reflect the fixture's real shelf.


## Slice 7

- Print slot/backing sheet/hint, 2400ms stepped feed, grab/return, 900ms retract, 340ms settle and four English Peta! tag variants copy the original desktop presentation. The existing real sticker layer handles placement/drag/Peel; there is still one main content window.
- `slice-07-{studio,desk}-08-printed.jpg` compares the complete golden desktop and actual native layers. The black background is the real X11 desktop; the prototype wallpaper/menu/toolbar are deliberately excluded from the application. Native screenshots and post-paste captures are retained separately.
- Both `*-flow.json` records prove Make → Print → 160ms grab at 1.08× → 260ms return without placement → native mouse Grab/Paste → persistent move → keyboard Peel. The displayed print scale is preserved in the saved Rust placement. The hint fades over 200ms; paste waits 450ms before the original 900ms retraction.
- `slice-07-motion.json` verifies two queued native pastes wait for the preceding retraction before feeding the next sheet, and that returning an already-placed Book reprint retains its original placement before a subsequent paste moves it. Reproduce after all eight slices using an empty disposable v7 queue with `python3 scripts/port-verify-print.py`.
- `slice-07-window.json`: native drag, resize/minimum 720×520, maximize/restore, minimize/resume, red/Esc/outside hide, and persisted Sound off/Reduce motion in both main window and desktop layer passed under an X11 window manager. Native gestures use mouse events with default selection prevented; the desktop arrival envelope cannot intercept the main window's resize corner.
- `slice-07-gift-file.json`: Book's native Save dialog → finished PNG unchanged in the gift package → Gifts' native Open dialog → sealed Inbox entry. No original photograph is exported.
- Today was recaptured through tear/pull/Keep in both shells, preserving the expanded scene until the card's 640ms flight into the tray finishes.
- Full eight-page audit at both sizes/both shells: 0 actionable issues; raw paper-art false positives remain documented. Placement tests: 13 passed. Physical audio output and macOS native behavior cannot be verified on this Linux capture host.
- Remaining visible differences are the real fixture's stock/history/sticker identities, platform sans/font glyph metrics, and Rust's real cutout/material renderer versus the reference canvas renderer. Missing sticky-note/notebook/tag art retains the original CSS with `TODO(art)`.
