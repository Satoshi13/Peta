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
/// Reject incorrect callers before sending any AppKit messages.
pub fn apply_layer_mode(window: &WebviewWindow, mode: LayerMode) -> Result<(), String> {
    let _main_thread = objc2::MainThreadMarker::new()
        .ok_or_else(|| "desktop layer mode must be applied on the main thread".to_owned())?;

    let level: isize = unsafe {
        match mode {
            LayerMode::Resting => CGWindowLevelForKey(DESKTOP_WINDOW_LEVEL_KEY) as isize + 10,
            LayerMode::Editing => CGWindowLevelForKey(DESKTOP_ICON_WINDOW_LEVEL_KEY) as isize + 1,
            LayerMode::Notice => CGWindowLevelForKey(DESKTOP_ICON_WINDOW_LEVEL_KEY) as isize + 2,
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

/// Main thread only. Shows or hides a "sidebar" material behind the transparent web view, so the page's translucent
/// Studio sidebar picks up the desktop behind the window. The view is created on first use and only hidden afterwards.
/// Returns whether the material is showing; `false` leaves the page opaque.
pub fn set_sidebar_vibrancy(window: &WebviewWindow, enabled: bool, corner_radius: f64) -> bool {
    if objc2::MainThreadMarker::new().is_none() { return false; }
    invalidate_shadow(window);
    let Some(class) = objc2::runtime::AnyClass::get(c"NSVisualEffectView") else { return false };
    let ns_window = match window.ns_window() { Ok(w) => w as *mut AnyObject, Err(_) => return false };
    if ns_window.is_null() { return false; }
    unsafe {
        let content: *mut AnyObject = msg_send![ns_window, contentView];
        if content.is_null() { return false; }
        let subviews: *mut AnyObject = msg_send![content, subviews];
        let count: usize = if subviews.is_null() { 0 } else { msg_send![subviews, count] };
        for i in 0..count {
            let view: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
            let is_effect: Bool = msg_send![view, isKindOfClass: class];
            if is_effect.as_bool() {
                let _: () = msg_send![view, setHidden: Bool::new(!enabled)];
                return enabled;
            }
        }
        if !enabled { return false; }
        let bounds: Frame = msg_send![content, bounds];
        let alloc: *mut AnyObject = msg_send![class, alloc];
        let view: *mut AnyObject = msg_send![alloc, initWithFrame: bounds];
        if view.is_null() { return false; }
        let _: () = msg_send![view, setMaterial: 7isize];          // NSVisualEffectMaterialSidebar
        let _: () = msg_send![view, setBlendingMode: 0isize];      // behind the window
        let _: () = msg_send![view, setState: 0isize];             // follows the window's active state
        let _: () = msg_send![view, setAutoresizingMask: 18usize]; // width and height follow the window
        let _: () = msg_send![view, setWantsLayer: Bool::YES];
        let layer: *mut AnyObject = msg_send![view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: corner_radius];
            let _: () = msg_send![layer, setMasksToBounds: Bool::YES];
        }
        let none: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![content, addSubview: view, positioned: -1isize, relativeTo: none]; // below the web view
        let _: () = msg_send![view, release];
        true
    }
}

/// Main thread only. The picture on the general pasteboard (a screenshot or a copied image) as PNG or JPEG bytes, if any.
/// TIFF-only pasteboards are skipped: the cutter reads PNG, JPEG and WebP.
pub fn clipboard_image() -> Option<Vec<u8>> {
    unsafe {
        let board: *mut AnyObject = msg_send![objc2::class!(NSPasteboard), generalPasteboard];
        if board.is_null() { return None; }
        for uti in [c"public.png", c"public.jpeg"] {
            let kind: *mut AnyObject = msg_send![objc2::class!(NSString), stringWithUTF8String: uti.as_ptr()];
            let data: *mut AnyObject = msg_send![board, dataForType: kind];
            if data.is_null() { continue; }
            let len: usize = msg_send![data, length];
            let bytes: *const u8 = msg_send![data, bytes];
            if !bytes.is_null() && len > 0 { return Some(std::slice::from_raw_parts(bytes, len).to_vec()); }
        }
        None
    }
}

/// Main thread only. A transparent window's shadow follows what was painted when it was computed (the rounded page),
/// so ask AppKit to compute it again after the page has painted or the window changed size.
pub fn invalidate_shadow(window: &WebviewWindow) {
    let Ok(ns_window) = window.ns_window() else { return };
    let ns_window = ns_window as *mut AnyObject;
    if ns_window.is_null() { return; }
    unsafe { let _: () = msg_send![ns_window, invalidateShadow]; }
}

