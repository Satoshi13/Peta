# Native port comparisons

[最新: Scrapsの分解・引換と素材プレビュー](review-13/README.md)。[ネイティブ窓の四隅の尖りを除去](review-12/README.md)。[素材選択の黒枠を除去](review-11/README.md)。[素材選択とホバーの安定化](review-10/README.md)。[印刷後の自動給紙停止](review-09/README.md)。[カウントダウン札の配置と固定幅](review-08/README.md)。[Market購入済みラベルとPacksへの移動](review-07/README.md)。[Option剥がしの紙カール・巻戻し・Reduce motion](review-06/README.md)。[ホロ・触覚・カウントダウン・Book・素材の検証記録](upgrade-2026-10-04/README.md)。

[前回: Book click-to-flip, consistent actions and original cutout editing/deletion](review-05/README.md). Original-only editing was explicitly requested as cutout/outline re-editing; title naming remains undecided.

[Previous owner-requested corrections: Pack rows, window-bounded opening, persistent main window and notebook left edge](review-03/README.md). [Image layout, pen-circle selection, fast thin brush and minimal tray](review-02/README.md). [Previous corrections and cutout zoom](review-01/README.md). The original slice captures below document the initial port; the review captures show the subsequent UI changes.

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


## Slice 8

- Rust now permits unlimited Create/Book reprints, bounded only by selected material stock; Matte never runs out. Daily material remains one envelope. Welcome has its own local-date ledger; Market packs and Gifts have no daily sticker quota and consume no materials.
- Schema v7 adds a durable FIFO print queue, complete per-day Book entries, and the separate Welcome ledger. It migrates pending v6 confirmations (including previous days), Book history and opened Welcome dates without resetting ownership, material stock, sticker numbering or gift provenance. Prototype material draw weights are 50/32/18.
- `slice-08-{studio,desk}-11-packs-shelf-{before,used}.jpg` compares the unchanged golden with the real native shelf before/after Welcome's allowance is claimed. Counts and disabled states show actual Rust data, so the used state intentionally differs from the unused golden.
- `slice-08-rules.json`: one daily material; two Matte creations without cost; Kraft/Holographic creations consume one each; exhausted Kraft is refused; two Market openings; Welcome once after those other operations; two full Gift wax/pull/reveal/Later ceremonies; nine retained print jobs/Book entries; two native mouse FIFO pastes; seven pending prints and Welcome's used allowance survive a native process restart. A received sticker reprinted from Book keeps its received presentation.
- Final workspace Rust tests: **83 passed** (including migration, FIFO/restart/day-roll, independent quotas and existing cutout/gift/material/placement behavior). Placement JS tests: **13 passed**. Native debug build passed without warnings. Final all-page/two-size/two-shell audit: **0 actionable issues**, with only the unchanged paper-button artwork false positives.

To reproduce the rule regression, seed a **fresh** disposable directory with `port-fixture.py`, build/run the native debug binary using that directory as `XDG_DATA_HOME`, then run `python3 scripts/port-verify-rules.py`. Restart the native process using the same directory and run `python3 scripts/port-verify-rules.py restart`. This test does not reset real user data or mock Rust IPC.

## Review 03 — current opening behavior

The owner's latest review replaces the display-wide opening and automatic window closing described in slices 5 / 7 above. Opening and Gift sealing now stay inside the existing native window, including at 720×520; completion keeps that window open. Explicit close / Esc / the outside-click preference remain available. Pack shelf rows reserve the same bag / label / action height, and the notebook left edge uses a single continuous binding without an inner paper seam or framed cover.

[Before/after native captures, unchanged golden comparisons, physical opening and window checks](review-03/README.md). Delivered artwork files are unchanged; cover-edge is unused again because it framed the opened notebook.

## Review 04 — Create sticker ratio

[Current correction: Create's finished preview preserves the PNG aspect ratio](review-04/README.md). The inherited 100% height stretched the wrapper and image; native overrides now retain the natural height and uniformly fit both frame dimensions, including after resizing. Real PNG / image / sheen ratios pass in 24 states; the rendered PNG bytes are unchanged.

## Review 14 — Creator icons and material card outlines

[Native captures and verification](review-14/README.md). Settings and Market's Creators can choose an owned original as the local profile icon. References survive restart, follow original edits, and clear atomically on deletion. Material cards share an outline, corner radius and label across pages using the delivered textures; artwork files and sticker manufacturing rules are unchanged.
