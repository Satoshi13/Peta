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
