mod layers;
mod platform;
mod store;
mod tray;

use std::path::PathBuf;

use layers::Layers;
use peta_core::Placement;
use store::Store;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State, WebviewWindow};

#[tauri::command]
fn layer_info(window: WebviewWindow, layers: State<Layers>) -> Result<layers::LayerInfo, String> {
    layers.info(window.label()).ok_or_else(|| format!("unknown layer {}", window.label()))
}

/// Stickers this layer should draw, bottom -> top.
#[tauri::command]
fn layer_placements(window: WebviewWindow, layers: State<Layers>, store: State<Store>) -> Vec<Placement> {
    layers.placements_for(window.label(), &store)
}

/// Called when a drag / resize / rotate ends. The sticker now belongs to the display it was edited on,
/// and goes on top of the others.
#[tauri::command]
fn save_placement(window: WebviewWindow, layers: State<Layers>, store: State<Store>, mut placement: Placement) -> Result<(), String> {
    let info = layers.info(window.label()).ok_or("unknown layer")?;
    placement.display_id = info.display_id;
    store.lock().db_mut().place(placement).map(|_| ()).map_err(|e| e.to_string())
}

/// Peel off: the sticker leaves the desktop (it stays in the collection).
#[tauri::command]
fn peel_sticker(store: State<Store>, sticker_id: String) -> Result<(), String> {
    store.lock().db_mut().peel(&sticker_id).map_err(|e| e.to_string())
}

/// The rendered PNG of a sticker, as raw bytes (no base64).
#[tauri::command]
fn sticker_asset(store: State<Store>, sticker_id: String) -> Result<Response, String> {
    let bytes = store.lock().read_rendered(&sticker_id).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// Image files dropped onto a layer. `x` / `y` are the drop point as 0..1 of that display.
#[tauri::command]
async fn import_dropped(
    window: WebviewWindow,
    app: AppHandle,
    layers: State<'_, Layers>,
    store: State<'_, Store>,
    paths: Vec<String>,
    x: f64,
    y: f64,
) -> Result<usize, String> {
    let info = layers.info(window.label()).ok_or("unknown layer")?;
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let n = store.import_paths(&paths, &info.display_id, x, y);
    let _ = app.emit("placements-changed", ());
    Ok(n)
}

#[tauri::command]
fn exit_edit_mode(app: AppHandle) {
    layers::set_edit_mode(&app, false);
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Store::default())
        .manage(Layers::default())
        .invoke_handler(tauri::generate_handler![
            layer_info,
            layer_placements,
            save_placement,
            peel_sticker,
            sticker_asset,
            import_dropped,
            exit_edit_mode
        ])
        .setup(|app| {
            // Menu-bar-only app: no Dock icon, no app menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.state::<Store>().open(app.handle())?;
            tray::build(app.handle())?;
            layers::sync(app.handle())?;
            layers::spawn_monitor_watcher(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Peta");

    app.run(|_app, event| {
        // Layers are destroyed/recreated on display changes; that must not quit the app.
        // Only an explicit `app.exit(..)` (tray -> Quit) carries an exit code.
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
