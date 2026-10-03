//! Arrival over notification (spec §35-36): while today's envelope is still closed, a small kraft envelope
//! sits in a corner of the main display. Clicking it opens Today's Peta. It is its own tiny window (not part of
//! the click-through layer), so only the envelope itself takes mouse events and the rest of the desktop stays usable.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{
    gifts,
    platform::{self, LayerMode},
    today,
};

/// What the envelope in the corner announces.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ArrivalKind {
    /// Today's material has arrived (kraft envelope).
    Material,
    /// A gift is waiting, still sealed (cream envelope).
    Gift,
}

impl ArrivalKind {
    fn page(self) -> &'static str {
        match self {
            ArrivalKind::Material => "arrival.html",
            ArrivalKind::Gift => "arrival.html?kind=gift",
        }
    }
}

#[derive(Default)]
struct Shown(Mutex<Option<ArrivalKind>>);

pub const ARRIVAL_LABEL: &str = "arrival";
const WIDTH: f64 = 150.0;
const HEIGHT: f64 = 110.0;
const MARGIN_RIGHT: f64 = 26.0;
const MARGIN_TOP: f64 = 44.0; // below the menu bar

/// Show the envelope while there is something to announce (a sealed gift first, then today's material), remove it
/// when there is not. Safe from any thread.
pub fn sync(app: &AppHandle) {
    let wanted = if gifts::unopened_count(app) > 0 {
        Some(ArrivalKind::Gift)
    } else if matches!(today::status(app), Ok(s) if !s.material_opened) {
        Some(ArrivalKind::Material)
    } else {
        None
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if handle.try_state::<Shown>().is_none() {
            handle.manage(Shown::default());
        }
        let shown = handle.state::<Shown>();
        let mut current = shown.0.lock().unwrap();
        let exists = handle.get_webview_window(ARRIVAL_LABEL);
        match (wanted, exists) {
            (Some(kind), None) => match show(&handle, kind) {
                Ok(()) => *current = Some(kind),
                Err(e) => eprintln!("[peta] could not show the arrival envelope: {e}"),
            },
            (Some(kind), Some(window)) if *current != Some(kind) => {
                // the kind of envelope changed: same window, other picture
                let _ = window.eval(&format!("location.replace('{}')", kind.page()));
                *current = Some(kind);
            }
            (None, Some(window)) => {
                let _ = window.destroy();
                *current = None;
            }
            _ => {}
        }
    });
}

fn show(app: &AppHandle, kind: ArrivalKind) -> tauri::Result<()> {    let Some(monitor) = app.primary_monitor()?.or_else(|| app.available_monitors().ok().and_then(|m| m.into_iter().next())) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    let window = WebviewWindowBuilder::new(app, ARRIVAL_LABEL, WebviewUrl::App(kind.page().into()))
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
    let page = if gifts::unopened_count(&app) > 0 { "gifts" } else { "today" };
    if let Err(e) = crate::app_window::open(&app, page) {
        eprintln!("[peta] could not open Today: {e}");
    }
}
