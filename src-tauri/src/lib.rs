mod layers;
mod placements;
mod platform;
mod tray;

use layers::Layers;
use placements::{Placement, Store};
use tauri::{Manager, State, WebviewWindow};

#[tauri::command]
fn layer_info(window: WebviewWindow, layers: State<Layers>) -> Result<layers::LayerInfo, String> {
    layers.info(window.label()).ok_or_else(|| format!("unknown layer {}", window.label()))
}

#[tauri::command]
fn layer_placements(window: WebviewWindow, layers: State<Layers>, store: State<Store>) -> Vec<Placement> {
    layers.placements_for(window.label(), &store)
}

/// Called when a drag / resize / rotate ends. The sticker now belongs to the display it was edited on.
#[tauri::command]
fn save_placement(window: WebviewWindow, layers: State<Layers>, store: State<Store>, mut placement: Placement) -> Result<(), String> {
    let info = layers.info(window.label()).ok_or("unknown layer")?;
    placement.display_id = info.display_id;
    store.upsert(placement).map_err(|e| e.to_string())
}

/// Peel off: the sticker leaves the desktop.
#[tauri::command]
fn delete_placement(store: State<Store>, sticker_id: String) -> Result<(), String> {
    store.remove(&sticker_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_edit_mode(app: tauri::AppHandle) {
    layers::set_edit_mode(&app, false);
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(Store::default())
        .manage(Layers::default())
        .invoke_handler(tauri::generate_handler![layer_info, layer_placements, save_placement, delete_placement, exit_edit_mode])
        .setup(|app| {
            // Menu-bar-only app: no Dock icon, no app menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.state::<Store>().load(app.handle())?;
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
