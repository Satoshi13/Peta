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
- Ceremonies retain the original viewport-relative CSS/JS. The prototype covers the whole simulated desktop; the native ceremony covers the app webview, so its available area and object positions differ in the supplied 1440×900 golden crop. Accent-font glyphs also differ because the native app loads the bundled Klee One rather than the golden’s apparent cursive fallback. These differences are visible, not claimed as pixel equality.

## Slice 3

- Book month tabs/details/turn-over, Materials stock and sealed Gifts now use real library commands. Gift import/export use native file dialogs; the previous Collection page was removed.
- Eight native/golden comparisons (09, 10, 15, 19, both shells). Back-card history comes from provenance, rather than invented names or timestamps. The fixture's PNGs have their original alpha; golden stickers were outlined by the prototype renderer.
- At both sizes: 0 text/layout issues, with known WebKit false positives from the paper button artwork (`::before` inset -3px -4px). Raw entries and the exact exclusion reason are retained in the audit JSON; CSS values are unchanged.

## Slice 4

- Native Create retains the prototype DOM, sliders (outline 4–64/default 20), material tray and brush gestures. Rust performs all real cutting/rendering/history; sample backgrounds alone use the original `fakePhoto` display helper.
- Four comparisons (06–07, both shells); audit at both sizes: 0 issues apart from the documented paper-art false positives. The original 31vh pane height uses display height, matching the prototype's surrounding desktop viewport.
- `slice-04-controls.json`: a native mouse Erase stroke changed Rust PNG bytes; Cmd-Z restored identical bytes and Shift-Cmd-Z restored the edited bytes. Restore and the outline control were also exercised. The Rust material renderer naturally differs from the prototype's reference canvas renderer.
