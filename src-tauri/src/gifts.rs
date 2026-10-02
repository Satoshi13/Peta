//! Gift (Phase 7, without accounts): send a copy of a sticker as a sealed `.peta` file, and receive one.
//! The rules, the file format and the provenance live in `peta_core::gift`; this module owns the dialogs and the
//! hand-off to the same Print -> Grab -> Paste flow as every other new Peta. Accounts and a server would only change
//! how the file travels, not what is in it.

use peta_core::{daily, gift, ids::random_unit, IncomingGift, SourceType};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::{print, store::Store, today};

const EXT: &str = "peta";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    pub saved_to: String,
    pub edition: i64,
}

/// Seal a copy for `to` and ask where to save the file. Cancelling the dialog does nothing (no edition is used up).
#[tauri::command]
pub async fn gift_send(window: WebviewWindow, app: AppHandle, sticker_id: String, to: String, note: Option<String>) -> Result<Option<Sent>, String> {
    let to = to.trim().to_owned();
    if to.is_empty() {
        return Err("who is it for?".into());
    }
    let Some(path) = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Peta gift", &[EXT])
        .set_file_name(format!("Peta for {to}.{EXT}"))
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    let (edition, bytes) = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        let (id, bytes) = gift::build_gift(&mut lib, &sticker_id, &to, note.as_deref()).map_err(|e| e.to_string())?;
        let edition = gift::decode_gift(&bytes).map_err(|e| e.to_string())?.header.edition;
        let _ = id;
        (edition, bytes)
    };
    std::fs::write(&path, bytes).map_err(|e| format!("could not save the gift: {e}"))?;
    Ok(Some(Sent { saved_to: path.display().to_string(), edition }))
}

/// Receive a gift file (the Inbox's "Open a gift file…" and the menu bar's "Open Gift…").
#[tauri::command]
pub async fn gift_receive_file(app: AppHandle) -> Result<Option<IncomingGift>, String> {
    let picked = app.dialog().file().add_filter("Peta gift", &[EXT]).blocking_pick_file().and_then(|p| p.into_path().ok());
    let Some(path) = picked else { return Ok(None) };
    receive_path(&app, &path).map(Some)
}

pub fn receive_path(app: &AppHandle, path: &std::path::Path) -> Result<IncomingGift, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let incoming = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        gift::receive_gift(&mut lib, &bytes).map_err(|e| e.to_string())?
    };
    today::announce(app); // the envelope arrives
    Ok(incoming)
}

#[tauri::command]
pub fn gift_inbox(store: State<Store>) -> Result<Vec<IncomingGift>, String> {
    store.lock().db().gifts_received().map_err(|e| e.to_string())
}

/// How many gifts are still sealed.
pub fn unopened_count(app: &AppHandle) -> usize {
    app.state::<Store>().lock().db().gifts_received().map(|g| g.iter().filter(|g| g.opened_at.is_none()).count()).unwrap_or(0)
}

/// Break the seal: the gift becomes today's Peta (like opening a pack), printed at the slot to be stuck down.
#[tauri::command]
pub async fn gift_open(app: AppHandle, gift_id: String) -> Result<String, String> {
    if !today::status(&app)?.can_create {
        return Err(today::ALREADY_USED.into());
    }
    let date = app.state::<today::Today>().date();
    let sticker_id = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
        if !record.slot(false).can_add_new() {
            return Err(today::ALREADY_USED.into());
        }
        let sticker = gift::open_gift(&mut lib, &gift_id).map_err(|e| e.to_string())?;
        daily::confirm(lib.db_mut(), &date, &sticker.id, SourceType::Gift, random_unit()).map_err(|e| e.to_string())?;
        sticker.id
    };
    today::announce(&app);
    print::begin(&app);
    Ok(sticker_id)
}

/// Menu bar "Open Gift…": receive a file, then show the Inbox (Today's Peta).
pub fn menu_open_gift(app: &AppHandle) {
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        match gift_receive_file(app2.clone()).await {
            Ok(Some(_)) => {
                let _ = today::open_window(&app2);
            }
            Ok(None) => {}
            Err(e) => eprintln!("[peta] could not receive the gift: {e}"),
        }
    });
}
