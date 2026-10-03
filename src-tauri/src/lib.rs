mod app_window;
mod port_capture;
mod arrival;
mod collection;
mod creator;
mod gifts;
mod layers;
mod packs;
mod platform;
mod print;
mod store;
mod today;
mod tray;

use creator::Creator;
use layers::Layers;
use peta_core::Placement;
use store::Store;
use today::Today;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State, WebviewWindow};

#[tauri::command]
fn layer_info(window: WebviewWindow, layers: State<Layers>) -> Result<layers::LayerInfo, String> {
    layers.info(window.label()).ok_or_else(|| format!("unknown layer {}", window.label()))
}

/// A placement plus what the layer needs to dress the sticker (its material).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlacedSticker {
    #[serde(flatten)]
    placement: Placement,
    material_id: Option<String>,
}

/// Stickers this layer should draw, bottom -> top.
#[tauri::command]
fn layer_placements(window: WebviewWindow, layers: State<Layers>, store: State<Store>) -> Vec<PlacedSticker> {
    let placements = layers.placements_for(window.label(), &store);
    let lib = store.lock();
    placements
        .into_iter()
        .map(|p| {
            let material_id = lib.db().material_of(&p.sticker_id).ok().flatten();
            PlacedSticker { placement: p, material_id }
        })
        .collect()
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
fn peel_sticker(app: AppHandle, store: State<Store>, sticker_id: String) -> Result<(), String> {
    store.lock().db_mut().peel(&sticker_id).map_err(|e| e.to_string())?;
    let _ = app.emit("placements-changed", ()); // the Sticker Book shows what is on the desktop
    Ok(())
}

/// The rendered PNG of a sticker, as raw bytes (no base64).
#[tauri::command]
fn sticker_asset(store: State<Store>, sticker_id: String) -> Result<Response, String> {
    let bytes = store.lock().read_rendered(&sticker_id).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// An image file dropped onto a layer is a Create: it opens on the Cutting Mat, and becomes today's Peta
/// if you finish it. `x` / `y` are the drop point as 0..1 of that display.
/// Fails with `already_used_today` if today's Peta is already made.
#[tauri::command]
async fn import_dropped(
    window: WebviewWindow,
    app: AppHandle,
    layers: State<'_, Layers>,
    paths: Vec<String>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let info = layers.info(window.label()).ok_or("unknown layer")?;
    let Some(first) = paths.into_iter().next() else { return Ok(()) }; // one new Peta per day
    let bytes = std::fs::read(&first).map_err(|e| format!("could not read {first}: {e}"))?;
    creator::begin(
        &app,
        bytes,
        creator::Target { display_id: info.display_id, x, y, counts_for_today: true, material_hint: None },
    )
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
        .manage(Today::default())
        .manage(Creator::default())
        .invoke_handler(tauri::generate_handler![
            port_capture::port_capture_report,
            layer_info,
            layer_placements,
            save_placement,
            peel_sticker,
            sticker_asset,
            import_dropped,
            exit_edit_mode,
            today::daily_status,
            today::daily_open_material,
            today::daily_create,
            today::collection_unused,
            today::daily_stick_from_collection,
            creator::creator_begin_path,
            creator::creator_begin_bytes,
            creator::creator_info,
            creator::creator_original,
            creator::creator_render,
            creator::creator_stroke,
            creator::creator_clear_edits,
            creator::creator_finish,
            creator::creator_undo,
            creator::creator_redo,
            creator::creator_cancel,
            arrival::arrival_open,
            gifts::gift_send,
            gifts::gift_receive_file,
            gifts::gift_inbox,
            gifts::gift_open,
            packs::pack_install_demo,
            packs::pack_status,
            packs::pack_open,
            print::print_resume,
            print::print_pending,
            print::print_paste,
            print::print_later,
            collection::book_index,
            collection::book_page,
            collection::sticker_back,
            collection::material_book,
            collection::profile_get,
            collection::profile_set
        ])
        .on_window_event(|window, event| {
            // closing the Cutting Mat with the window button is a cancel: nothing was spent
            if window.label() == app_window::APP_LABEL && matches!(event, tauri::WindowEvent::Destroyed) {
                creator::clear(window.app_handle());
            }
        })
        .setup(|app| {
            // Menu-bar-only app: no Dock icon, no app menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.state::<Store>().open(app.handle())?;
            tray::build(app.handle())?;
            layers::sync(app.handle())?;
            layers::spawn_monitor_watcher(app.handle().clone());
            today::roll_day(app.handle()); // draws today's material; sets the menu indicator
            today::spawn_day_watcher(app.handle().clone());
            port_capture::start(app.handle());
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
