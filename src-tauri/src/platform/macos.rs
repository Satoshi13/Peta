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

// NSEvent and NSWindow both return logical screen points, including on Retina displays.
use super::coordinates::{Point, Size, Frame};
use objc2::encode::{Encode, Encoding};
unsafe impl Encode for Point { const ENCODING: Encoding = Encoding::Struct("CGPoint", &[Encoding::Double, Encoding::Double]); }
unsafe impl Encode for Size { const ENCODING: Encoding = Encoding::Struct("CGSize", &[Encoding::Double, Encoding::Double]); }
unsafe impl Encode for Frame { const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]); }

/// Main thread only. Coordinates are relative to the main display's bottom-left origin.
pub fn cursor_position() -> Option<Point> {
    let point: Point = unsafe { msg_send![objc2::class!(NSEvent), mouseLocation] };
    (point.x.is_finite() && point.y.is_finite()).then_some(point)
}

pub fn layer_frame(window: &WebviewWindow) -> Option<Frame> {
    let ns_window = window.ns_window().ok()? as *mut AnyObject;
    if ns_window.is_null() { return None; }
    Some(unsafe { msg_send![ns_window, frame] })
}

/// Main thread only. The default performer ignores feedback on unsupported devices.
pub fn haptic(kind: &str) {
    let Some(manager) = objc2::runtime::AnyClass::get(c"NSHapticFeedbackManager") else { return };
    unsafe {
        let performer: *mut AnyObject = msg_send![manager, defaultPerformer];
        if !performer.is_null() {
            let pattern: isize = if kind == "paste" { 2 } else { 0 };
            let _: () = msg_send![performer, performFeedbackPattern: pattern, performanceTime: 0isize];
        }
    }
}
