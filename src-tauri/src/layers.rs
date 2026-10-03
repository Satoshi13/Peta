//! One transparent Desktop Layer window per display (spec §7), kept in sync with the
//! connected monitors (spike steps 11-12).
//!
//! Strategy: whenever the monitor set changes (resolution, arrangement, hot-plug) every layer is
//! destroyed and rebuilt. It's cheap and avoids stale-geometry bugs; stickers reload from the store.

use std::{collections::HashMap, sync::Mutex, thread, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use peta_core::Placement;

use crate::{store::Store, platform::{self, LayerMode}};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerInfo {
    pub display_id: String,
    pub is_primary: bool,
    pub edit_mode: bool,
}

#[derive(Default)]
struct State {
    generation: u32,
    edit_mode: bool,
    /// A new Peta is waiting at the print slot on the primary display: that layer must take mouse events
    /// (so it can be grabbed) even outside Edit Mode.
    print: bool,
    /// window label -> info
    by_label: HashMap<String, LayerInfo>,
    present_display_ids: Vec<String>,
    primary_display_id: String,
    signature: String,
}

#[derive(Default)]
pub struct Layers(Mutex<State>);

impl Layers {
    pub fn info(&self, label: &str) -> Option<LayerInfo> {
        self.0.lock().unwrap().by_label.get(label).cloned()
    }

    /// Placements this layer should draw. Stickers whose display is gone fall back to the
    /// primary display *without* rewriting their stored displayId, so they return home when the
    /// monitor is reconnected (spec §10.2).
    pub fn placements_for(&self, label: &str, store: &Store) -> Vec<Placement> {
        let st = self.0.lock().unwrap();
        let Some(info) = st.by_label.get(label) else { return Vec::new() };
        store
            .on_desktop()
            .into_iter()
            .filter(|p| {
                p.display_id == info.display_id
                    || (info.is_primary && !st.present_display_ids.contains(&p.display_id))
            })
            .collect()
    }

    pub fn primary_display_id(&self) -> String {
        self.0.lock().unwrap().primary_display_id.clone()
    }
    pub fn interactive(&self)->bool { let state=self.0.lock().unwrap(); state.edit_mode||state.print }

}

/// Stable-ish display ids. macOS reports localized names ("Built-in Retina Display");
/// duplicates (two identical externals) get a `#n` suffix in enumeration order.
/// TODO(phase 1): switch to CGDirectDisplayID / EDID-based ids to survive renames and swaps.
fn assign_display_ids(monitors: &[Monitor]) -> Vec<String> {
    let mut seen: HashMap<String, u32> = HashMap::new();
    monitors
        .iter()
        .map(|m| {
            let base = m.name().cloned().unwrap_or_else(|| "display".into());
            let n = seen.entry(base.clone()).or_insert(0);
            *n += 1;
            if *n == 1 { base } else { format!("{base}#{n}") }
        })
        .collect()
}

fn signature(monitors: &[Monitor]) -> String {
    monitors
        .iter()
        .map(|m| format!("{:?}|{:?}|{:?}|{}", m.name(), m.position(), m.size(), m.scale_factor()))
        .collect::<Vec<_>>()
        .join(";")
}

/// Rebuild all layers from the current monitor set. Call on the main thread.
pub fn sync(app: &AppHandle) -> tauri::Result<()> {
    let monitors = app.available_monitors()?;
    if monitors.is_empty() {
        return Ok(());
    }
    let ids = assign_display_ids(&monitors);
    let primary_idx = app
        .primary_monitor()?
        .and_then(|p| monitors.iter().position(|m| m.position() == p.position() && m.size() == p.size()))
        .unwrap_or(0);

    let layers = app.state::<Layers>();
    let (old_labels, generation, edit_mode, print) = {
        let mut st = layers.0.lock().unwrap();
        let old: Vec<String> = st.by_label.keys().cloned().collect();
        st.generation += 1;
        st.by_label.clear();
        st.present_display_ids = ids.clone();
        st.primary_display_id = ids[primary_idx].clone();
        st.signature = signature(&monitors);
        (old, st.generation, st.edit_mode, st.print)
    };

    // First launch only: put the sample cat on the primary display.
    app.state::<Store>().seed_if_needed(&ids[primary_idx]);

    for label in old_labels {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
    }

    for (i, monitor) in monitors.iter().enumerate() {
        let label = format!("layer-{generation}-{i}");
        // Register info BEFORE the webview boots, so its first `layer_info` call succeeds.
        layers.0.lock().unwrap().by_label.insert(
            label.clone(),
            LayerInfo { display_id: ids[i].clone(), is_primary: i == primary_idx, edit_mode },
        );

        let scale = monitor.scale_factor();
        let pos = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);

        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Peta Layer")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .focused(false)
            .accept_first_mouse(true)
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .build()?;

        apply_mode(&window, edit_mode || (print && i == primary_idx));
    }
    Ok(())
}

fn apply_mode(window: &WebviewWindow, edit_mode: bool) {
    let mode = if edit_mode { LayerMode::Editing } else { LayerMode::Resting };
    if let Err(e) = platform::apply_layer_mode(window, mode) {
        eprintln!("[peta] apply_layer_mode({mode:?}) failed on {}: {e}", window.label());
    }
}

/// Enter / leave Edit Mode on every layer (spec §9). Safe to call from any thread.
pub fn set_edit_mode(app: &AppHandle, on: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let layers = handle.state::<Layers>();
        let labels: Vec<String> = {
            let mut st = layers.0.lock().unwrap();
            st.edit_mode = on;
            st.by_label.values_mut().for_each(|i| i.edit_mode = on);
            st.by_label.keys().cloned().collect()
        };
        for label in labels {
            if let Some(w) = handle.get_webview_window(&label) {
                apply_mode(&w, on || print_on(&handle, &label));
                if on {
                    let _ = w.set_focus();
                }
            }
        }
        let _ = handle.emit("edit-mode", on);
        crate::tray::sync_edit_checkbox(&handle, on);
    });
}

/// Is a new Peta waiting at the print slot of this layer (the primary display's)?
fn print_on(app: &AppHandle, label: &str) -> bool {
    let st = app.state::<Layers>();
    let st = st.0.lock().unwrap();
    st.print && st.by_label.get(label).is_some_and(|i| i.is_primary)
}

/// A new Peta is waiting to be grabbed (or has been placed / put aside): the primary layer takes mouse events
/// for as long as it is. Safe to call from any thread.
pub fn set_print(app: &AppHandle, on: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let labels: Vec<String> = {
            let layers = handle.state::<Layers>();
            let mut st = layers.0.lock().unwrap();
            st.print = on;
            st.by_label.keys().cloned().collect()
        };
        for label in labels {
            if let Some(w) = handle.get_webview_window(&label) {
                let edit = handle.state::<Layers>().0.lock().unwrap().edit_mode;
                apply_mode(&w, edit || print_on(&handle, &label));
                if on && print_on(&handle, &label) {
                    let _ = w.set_focus();
                }
            }
        }
        let _ = handle.emit("print-changed", on);
    });
}

/// Poll for monitor changes (Tauri has no display-change event). 2s is plenty for hot-plug.
pub fn spawn_monitor_watcher(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let Ok(monitors) = app.available_monitors() else { continue };
        let current = signature(&monitors);
        let changed = current != app.state::<Layers>().0.lock().unwrap().signature;
        if changed && !monitors.is_empty() {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(e) = sync(&handle) {
                    eprintln!("[peta] layer re-sync failed: {e}");
                }
            });
        }
    });
}
