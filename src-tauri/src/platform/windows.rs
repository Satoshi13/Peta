//! Windows adapter — NOT implemented in this spike (macOS first, per product owner).
//!
//! Plan for the Windows spike (spec §71, spike step 02):
//! - Find the desktop `WorkerW` window (send 0x052C to `Progman`, then enumerate for the
//!   `WorkerW` that hosts `SHELLDLL_DefView`'s sibling) and `SetParent` the layer window to it,
//!   which puts it above the wallpaper and below the desktop icons.
//! - Resting: `WS_EX_TRANSPARENT | WS_EX_LAYERED` for click-through.
//! - Editing: un-parent / raise above icons, drop `WS_EX_TRANSPARENT`.
//! - Per-monitor DPI: use physical px and `GetDpiForMonitor`; relative coordinates make this safe.
//! Until then this is a no-op so the crate still compiles on Linux/Windows.

use tauri::WebviewWindow;

use super::LayerMode;

pub fn apply_layer_mode(window: &WebviewWindow, mode: LayerMode) -> Result<(), String> {
    window
        .set_ignore_cursor_events(mode == LayerMode::Resting)
        .map_err(|e| e.to_string())
}

pub fn activate_app() {}

/// Permanent identities are only implemented for macOS in this build.
pub fn stable_display_ids(_monitors: &[tauri::Monitor]) -> Result<Option<Vec<String>>, String> {
    Ok(None)
}
