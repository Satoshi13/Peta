//! A small envelope-only window. Its native level never changes the sticker layers.
use std::{cell::Cell, time::{Duration, Instant}};
use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "arrival-notification";
// The window ends exactly at the display edge; the tilted artwork is clipped there.
// Keep the 250 x 220 logical viewport in sync with arrival.css.
const WINDOW_WIDTH: f64 = 250.0;
const WINDOW_HEIGHT: f64 = 220.0;
const BOTTOM: f64 = 90.0;
thread_local! {
    static CLOSE_AT: Cell<Option<Instant>> = const { Cell::new(None) };
}

/// Main thread only. Return the notification and whether it was just created.
pub fn sync(app: &AppHandle, primary: Option<&WebviewWindow>, visible: bool)
    -> Result<Option<(WebviewWindow, bool)>, String>
{
    let existing = app.get_webview_window(LABEL);
    let Some(primary) = primary.filter(|_| visible) else {
        if let Some(window) = existing {
            // Allow the frontend's 280ms exit to finish; release input immediately.
            window.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
            let now = Instant::now();
            let deadline = CLOSE_AT.with(|at| {
                let deadline = at.get().unwrap_or(now + Duration::from_millis(340));
                at.set(Some(deadline)); deadline
            });
            if now >= deadline { window.destroy().map_err(|e| e.to_string())?; }
        } else { CLOSE_AT.with(|at| at.set(None)); }
        return Ok(None);
    };
    CLOSE_AT.with(|at| at.set(None));
    let pos = primary.outer_position().map_err(|e| e.to_string())?;
    let size = primary.inner_size().map_err(|e| e.to_string())?;
    let scale = primary.scale_factor().map_err(|e| e.to_string())?;
    let x = (pos.x as f64 + size.width as f64) / scale - WINDOW_WIDTH;
    let y = (pos.y as f64 + size.height as f64) / scale - BOTTOM - WINDOW_HEIGHT;
    let position = LogicalPosition::new(x, y);
    if let Some(window) = existing {
        let current = window.outer_position().map_err(|e| e.to_string())?;
        if (current.x as f64 - x * scale).abs() > 1.0 || (current.y as f64 - y * scale).abs() > 1.0 {
            window.set_position(position).map_err(|e| e.to_string())?;
        }
        return Ok(Some((window, false)));
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("arrival.html".into()))
        .title("Peta arrival")
        .decorations(false).transparent(true).shadow(false).resizable(false)
        .skip_taskbar(true).focused(false).accept_first_mouse(true).visible(false)
        .position(x, y).inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .build().map_err(|e| e.to_string())?;
    // Only this envelope-sized window sits above desktop icons, one level above the editing sticker layers.
    // No stickers are rendered in it.
    if let Err(error) = crate::platform::apply_layer_mode(&window, crate::platform::LayerMode::Notice)
        .and_then(|_| window.set_ignore_cursor_events(true).map_err(|e| e.to_string()))
        .and_then(|_| window.show().map_err(|e| e.to_string()))
    {
        let _ = window.destroy();
        return Err(error);
    }
    Ok(Some((window, true)))
}
