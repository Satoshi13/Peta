# Desktop envelope hover crash

The Developer edition on `claude/relaxed-dijkstra-ocnjzu` draws the arrival envelope on the existing primary desktop layer. Its hit watcher used to call `platform::apply_layer_mode` directly from a worker thread as soon as the pointer entered or left the envelope. That function sends `NSWindow` messages (`setLevel:`, `setCollectionBehavior:`, etc.) directly, and requires the macOS main thread. Tauri's thread-safe window getters do not make those subsequent AppKit calls safe.

The watcher now dispatches each complete hover check and mode change through `AppHandle::run_on_main_thread`. It waits for completion before scheduling the next check, preventing queued stale updates. The dispatched check uses the current windows and checks Edit/Print priority again. The macOS adapter rejects off-thread calls before touching AppKit and callers report errors to stderr.

## Regression check

Run `python3 scripts/check-arrival-threading.py` with Rust installed. It compiles the actual `arrival.rs` against a small fake Tauri event loop. Native layer mode changes require the test's main thread. The check covers entering/leaving the envelope, repeated hover, Retina hit coordinates, pending-task backpressure, Edit/Print priority, rebuilt layers, shell overlap, and hiding the arrival. The previous watcher fails this same harness on an off-thread native mode change; the fixed watcher passes.

The Developer edition also passed `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin --features developer` from Linux. This verifies types; it does not run AppKit or reproduce the user's macOS 27.0 (26A428) runtime.

## Native verification still required

After updating `claude/relaxed-dijkstra-ocnjzu`, launch `npm run dev:developer`, move the pointer onto and off the desktop envelope repeatedly, then click it. Repeat with Edit Mode and a pending printed sticker, and with the main shell covering the envelope. The process should remain running and the envelope should open Today/Gifts. Test display reconnection as well. If the process still exits, obtain the macOS crash report from Console or `~/Library/Logs/DiagnosticReports/`; silent terminal output alone cannot identify the remaining native exception.
