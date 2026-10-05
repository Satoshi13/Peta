//! macOS desktop layer: NSWindow level + collection behavior (spike steps 01, 04, 05).
//!
//! Window levels (CoreGraphics `CGWindowLevelForKey`):
//!   kCGDesktopWindowLevelKey      (2)  wallpaper
//!   kCGDesktopIconWindowLevelKey  (18) Finder desktop icons
//! Resting  = wallpaper + 10  -> above the wallpaper, below the icons  (spec §6)
//! Editing  = icon level + 1  -> above the icons so stickers can be grabbed, still below normal apps

use objc2::{msg_send, runtime::{AnyObject, Bool}};
use tauri::WebviewWindow;

use super::LayerMode;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
}

const DESKTOP_WINDOW_LEVEL_KEY: i32 = 2;
const DESKTOP_ICON_WINDOW_LEVEL_KEY: i32 = 18;

// NSWindowCollectionBehavior bits
const CAN_JOIN_ALL_SPACES: usize = 1 << 0; // show on every Space
const STATIONARY: usize = 1 << 4; // does not move with Space transitions (like the wallpaper)
const IGNORES_CYCLE: usize = 1 << 6; // not reachable via Cmd+`

/// Must be called on the main thread (the callers use `run_on_main_thread`).
pub fn apply_layer_mode(window: &WebviewWindow, mode: LayerMode) -> Result<(), String> {
    let level: isize = unsafe {
        match mode {
            LayerMode::Resting => CGWindowLevelForKey(DESKTOP_WINDOW_LEVEL_KEY) as isize + 10,
            LayerMode::Editing => CGWindowLevelForKey(DESKTOP_ICON_WINDOW_LEVEL_KEY) as isize + 1,
        }
    };

    // Click-through is handled by Tauri (NSWindow ignoresMouseEvents).
    window
        .set_ignore_cursor_events(mode == LayerMode::Resting)
        .map_err(|e| e.to_string())?;

    let ns_window = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
    if ns_window.is_null() {
        return Err("NSWindow pointer was null".into());
    }
    unsafe {
        let behavior: usize = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE;
        let _: () = msg_send![ns_window, setLevel: level];
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setHasShadow: Bool::NO];
        let _: () = msg_send![ns_window, setOpaque: Bool::NO];
    }
    Ok(())
}

/// A menu-bar-only (Accessory) app isn't frontmost, so a file dialog would open behind other windows.
/// Bring the app forward first. Main thread only.
pub fn activate_app() {
    unsafe {
        let ns_app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
        if !ns_app.is_null() {
            let _: () = msg_send![ns_app, activateIgnoringOtherApps: Bool::YES];
        }
    }
}

/// Match Tauri monitors to CoreGraphics by logical origin (the same geometry Tao uses),
/// then store the system's UUID rather than its transient CGDirectDisplayID.
/// Names, enumeration order, resolution and scale are not part of the identity.
pub fn stable_display_ids(monitors: &[tauri::Monitor]) -> Result<Option<Vec<String>>, String> {
    use core_foundation::{base::{CFRelease, TCFType}, string::CFString};
    use core_graphics::display::CGDisplay;
    use std::ffi::c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGDisplayCreateUUIDFromDisplayID(display: u32) -> *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFUUIDCreateString(allocator: *const c_void, uuid: *const c_void) -> core_foundation::string::CFStringRef;
    }

    let active = CGDisplay::active_displays().map_err(|e| format!("reading display identities failed: {e}"))?;
    let native: Vec<_> = active.iter().map(|&id| {
        let bounds = CGDisplay::new(id).bounds();
        (id, bounds.origin.x, bounds.origin.y)
    }).collect();
    let ids = monitors.iter().map(|monitor| {
        let id = peta_core::display::match_native_origin(&native,
            (monitor.position().x, monitor.position().y), monitor.scale_factor()).map_err(|e| e.to_string())?;
        unsafe {
            let uuid = CGDisplayCreateUUIDFromDisplayID(id);
            if uuid.is_null() { return Err("display UUID was unavailable".into()); }
            let raw = CFUUIDCreateString(std::ptr::null(), uuid);
            CFRelease(uuid);
            if raw.is_null() { return Err("display UUID could not be read".into()); }
            let uuid = CFString::wrap_under_create_rule(raw).to_string();
            Ok(format!("macos:{uuid}"))
        }
    }).collect::<Result<Vec<_>, String>>()?;
    Ok(Some(ids))
}
