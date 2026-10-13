//! Local full-library migration; never contacts the server.
use crate::store::Store;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
pub fn move_bootstrap_done(app: AppHandle) -> Result<(), String> {
    app.state::<Store>().capture_move_bootstrap()
}
#[tauri::command]
pub async fn move_status(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Store>().can_import_move())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn library_move_export(
    window: tauri::WebviewWindow,
    app: AppHandle,
    passphrase: String,
) -> Result<bool, String> {
    if passphrase.chars().count() < peta_core::identity::PASSPHRASE_MIN {
        return Err("Use a passphrase of at least 12 characters.".into());
    }
    let Some(path) = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Peta library move", &["petamove"])
        .set_file_name("Peta library.petamove")
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(false);
    };
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        peta_core::migration::export(&mut store.lock(), &path, &passphrase)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn library_move_import(
    window: tauri::WebviewWindow,
    app: AppHandle,
    passphrase: String,
) -> Result<bool, String> {
    if !app.state::<Store>().can_import_move()? {
        return Err(
            "Restore a move file only on a fresh installation before you start using Peta.".into(),
        );
    }
    let Some(path) = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Peta library move", &["petamove"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(false);
    };
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Store>().import_move(&path, &passphrase)?;
        app.restart()
    })
    .await
    .map_err(|e| e.to_string())?
}
