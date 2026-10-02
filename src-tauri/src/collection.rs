//! The Sticker Book and the back of stickers: what the Collection window and the "turn over" gesture read.
//! The rules (which month a sticker belongs to, what is printed on a back) live in `peta_core::{book, back}`.

use peta_core::{
    back::{self, local_ymd},
    book, materials, BookEntry, Material, MonthIndex, StickerBack,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::{platform, store::Store};

pub const COLLECTION_LABEL: &str = "collection";

pub fn open_window(app: &AppHandle) -> tauri::Result<()> {
    platform::activate_app();
    if let Some(w) = app.get_webview_window(COLLECTION_LABEL) {
        w.show()?;
        return w.set_focus();
    }
    WebviewWindowBuilder::new(app, COLLECTION_LABEL, WebviewUrl::App("collection.html".into()))
        .title("Sticker Book")
        .inner_size(1040.0, 740.0)
        .min_inner_size(820.0, 560.0)
        .center()
        .build()?;
    Ok(())
}

/// Months that have a page, newest first.
#[tauri::command]
pub fn book_index(store: State<Store>) -> Result<Vec<MonthIndex>, String> {
    let lib = store.lock();
    let entries = book::entries_local(lib.db()).map_err(|e| e.to_string())?;
    Ok(book::index(&entries))
}

/// One month's page, oldest first.
#[tauri::command]
pub fn book_page(store: State<Store>, year: i32, month: u32) -> Result<Vec<BookEntry>, String> {
    let lib = store.lock();
    let entries = book::entries_local(lib.db()).map_err(|e| e.to_string())?;
    Ok(book::page(&entries, year, month))
}

/// What is printed on the back of a sticker (ORIGINAL / Received, who, when, which material, history).
#[tauri::command]
pub fn sticker_back(store: State<Store>, sticker_id: String) -> Result<Option<StickerBack>, String> {
    let lib = store.lock();
    let name = lib.db().display_name().map_err(|e| e.to_string())?;
    back::sticker_back(lib.db(), &sticker_id, &name, &local_ymd).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialBookEntry {
    pub material: Material,
    pub unlocked: bool,
}

/// Every material there is, and whether you have it yet (the Material Book).
#[tauri::command]
pub fn material_book(store: State<Store>) -> Result<Vec<MaterialBookEntry>, String> {
    let lib = store.lock();
    materials::catalog()
        .into_iter()
        .map(|mut m| {
            m.unlocked_at = lib.db().material_unlocked_at(&m.id).map_err(|e| e.to_string())?;
            Ok(MaterialBookEntry { unlocked: m.unlocked_at.is_some(), material: m })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub display_name: String,
}

#[tauri::command]
pub fn profile_get(store: State<Store>) -> Result<Profile, String> {
    let display_name = store.lock().db().display_name().map_err(|e| e.to_string())?;
    Ok(Profile { display_name })
}

/// The name printed on the back of stickers you make from now on. Empty = back to the OS user name.
#[tauri::command]
pub fn profile_set(store: State<Store>, display_name: String) -> Result<Profile, String> {
    store.lock().db_mut().set_display_name(&display_name).map_err(|e| e.to_string())?;
    profile_get(store)
}
