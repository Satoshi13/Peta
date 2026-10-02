//! Arrival over notification (spec §35-36): while today's envelope is still closed, a small kraft envelope
//! sits in a corner of the main display. Clicking it opens Today's Peta. It is its own tiny window (not part of
//! the click-through layer), so only the envelope itself takes mouse events and the rest of the desktop stays usable.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{
    platform::{self, LayerMode},
    today,
};

pub const ARRIVAL_LABEL: &str = "arrival";
const WIDTH: f64 = 150.0;
const HEIGHT: f64 = 110.0;
const MARGIN_RIGHT: f64 = 26.0;
const MARGIN_TOP: f64 = 44.0; // below the menu bar

/// Show the envelope while today's material is unopened, remove it once it is opened. Safe from any thread.
pub fn sync(app: &AppHandle) {
    let wanted = matches!(today::status(app), Ok(s) if !s.material_opened);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let exists = handle.get_webview_window(ARRIVAL_LABEL);
        match (wanted, exists) {
            (true, None) => {
                if let Err(e) = show(&handle) {
                    eprintln!("[peta] could not show the arrival envelope: {e}");
                }
            }
            (false, Some(window)) => {
                let _ = window.destroy();
            }
            _ => {}
        }
    });
}

fn show(app: &AppHandle) -> tauri::Result<()> {
    let Some(monitor) = app.primary_monitor()?.or_else(|| app.available_monitors().ok().and_then(|m| m.into_iter().next())) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    let window = WebviewWindowBuilder::new(app, ARRIVAL_LABEL, WebviewUrl::App("arrival.html".into()))
        .title("Peta")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .position(pos.x + size.width - WIDTH - MARGIN_RIGHT, pos.y + MARGIN_TOP)
        .inner_size(WIDTH, HEIGHT)
        .build()?;
    // above the desktop icons (it has to be clickable), below normal app windows
    if let Err(e) = platform::apply_layer_mode(&window, LayerMode::Editing) {
        eprintln!("[peta] arrival window level failed: {e}");
    }
    Ok(())
}

/// The envelope was clicked.
#[tauri::command]
pub fn arrival_open(app: AppHandle) {
    if let Err(e) = today::open_window(&app) {
        eprintln!("[peta] could not open Today: {e}");
    }
}
