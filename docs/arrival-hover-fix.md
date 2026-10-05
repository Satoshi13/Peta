# Desktop envelope hover

The original Developer-edition arrival watcher called `platform::apply_layer_mode` from a worker thread. That function sends `NSWindow` messages directly and requires the macOS main thread. The watcher now dispatches the entire check through `AppHandle::run_on_main_thread` and waits for completion before scheduling another, preventing stale queued updates. The macOS adapter also rejects off-thread calls before touching AppKit.

Changing the primary sticker layer to Editing on hover raised every sticker above Finder's icons. The envelope now has its own small transparent window (`arrival-notification`), drawing only the envelope. It stays at desktop-icon level plus one; its hover watcher changes only its click-through flag. The sticker layers' level and mouse handling are untouched. Edit/Print take input priority; overlapping main-shell windows block envelope clicks. The notification follows the primary layer's geometry when displays change and is destroyed when no arrival remains.

The desktop artwork is tilted at the right display edge, with part of the envelope tucked out of view. The pill label is replaced by handwritten text on the envelope's paper. Entry, continuous floating, hover lift and the fixed tilt use separate nested elements. Hover never changes animation duration, start time or the fixed button hit area. Today also floats again: its hover lift wraps the floating artwork, while material extraction remains still. Both the app's reduced-motion setting and the OS setting disable floating and hover movement.

## Motion and one-shot dismissal

Today travels 18 logical pixels vertically over a 2.8-second cycle; desktop arrival travels 14 over 2.6 seconds. Both have a gentle roll and keep their ambient clock through hover. Hover lifts vertically with an eased 380ms response. The desktop hover state comes from the native hit watcher, with an initial IPC snapshot, so disabling mouse input does not leave a stale WebKit `:hover` pose.

A successful `arrival_open` dismisses the current notice for this app session without opening/consuming its material. Same-day status refreshes keep it dismissed; a new day or a new gift can notify again. Opening failure preserves the notification. The frontend exits from its current entry pose over 280ms, and the native window releases input immediately and waits 340ms before destruction. Repeated clicks are blocked while opening. Reduced motion hides immediately.

Settings → Peta Developer → **Show desktop envelope once** requests one desktop notice and hides the shell so it is visible. It works after today's material was opened or the notice dismissed, does not advance the day, and does not change material state. Multiple requests reuse the single notification window. Clicking consumes the preview. The distribution edition rejects the command in Rust and hides the control.

## Checks

- `python3 scripts/check-arrival-threading.py` requires Rust, without GTK or macOS. It compiles the actual watcher and notification-window code against a fake Tauri event loop. Native changes assert thread affinity. Checks cover entering/leaving/repeated hover, Retina geometry, pending-task backpressure, Edit/Print priority, rebuilt displays, shell overlap and hiding the arrival. It also checks opening failure/success, dismissal refreshes, next-day/new-gift notices, one-shot Developer previews, distribution rejection and that hover never changes any sticker window's level or click-through state.
- `python3 scripts/check-arrival-ui.py` requires Python Playwright and Chromium (`PETA_CHROMIUM` can specify the binary). It loads the actual frontend with mocked Tauri IPC. It checks visible floating travel, a stable clock through 30 desktop and 20 Today hover transitions, native hover clearing, fixed hit areas, material/gift/extra labels, failed/successful mouse and keyboard opening, mid-entry dismissal, reduced motion, still extraction and the Developer Settings control. Add `--screenshot /tmp/peta-envelope.png` for a desktop preview.
- Both standard and Developer editions passed macOS-target `cargo check` from Linux. These checks verify types; they do not run AppKit.

## Native verification

Launch `npm run dev:developer`, move onto and off the desktop envelope repeatedly, then click it. Stickers must remain below Finder icons throughout; the envelope must open Today/Gifts. Repeat in Edit Mode, with a pending print, with the main shell covering the envelope, and after changing displays. The macOS 27.0 (26A428) runtime still needs this verification on a Mac.
