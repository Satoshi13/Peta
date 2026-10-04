//! The Sticker Book and the back of stickers: what the Collection window and the "turn over" gesture read.
//! The rules (which month a sticker belongs to, what is printed on a back) live in `peta_core::{book, back}`.

use peta_core::{
    back::{self, local_ymd},
    book, materials, BookEntry, Material, MonthIndex, StickerBack,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{store::Store};


/// Months that have a page, newest first.
#[tauri::command]
pub fn book_index(store: State<Store>) -> Result<Vec<MonthIndex>, String> {
    let lib = store.lock();
    let entries = book::entries_local(lib.db()).map_err(|e| e.to_string())?;
    Ok(book::index(&entries))
}

/// One month's page, oldest first.
#[tauri::command]
pub fn book_page(store: State<Store>, year: i32, month: u32) -> Result<Vec<BookItem>, String> {
    let lib = store.lock();
    let entries = book::entries_local(lib.db()).map_err(|e| e.to_string())?;
    book::page(&entries, year, month).into_iter().map(|entry| {
        let sticker = lib.db().sticker(&entry.sticker_id).map_err(|e| e.to_string())?;
        let can_manage = sticker.as_ref().is_some_and(|s| s.source_type == peta_core::SourceType::Created);
        let created_at = sticker.map(|s| s.created_at);
        let pack_name=peta_core::pack::item_name(lib.db(),&entry.sticker_id).map_err(|e|e.to_string())?;
        Ok(BookItem { entry, can_manage, created_at,pack_name })
    }).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookItem { #[serde(flatten)] entry: BookEntry, can_manage: bool, created_at: Option<String>,pack_name:Option<String> }

#[tauri::command]
pub fn sticker_delete_original(app: AppHandle, store: State<Store>, sticker_id: String) -> Result<(), String> {
    store.lock().delete_original(&sticker_id).map_err(|e| e.to_string())?;
    let _ = app.emit("sticker-updated", &sticker_id);
    if crate::print::pending(&app)?.is_none() { crate::layers::set_print(&app, false); }
    crate::today::announce(&app);
    Ok(())
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
            if let Some(full) = lib.db().material_with_stock(&m.id).map_err(|e| e.to_string())? {
                m = full;
            }
            Ok(MaterialBookEntry { unlocked: m.unlocked_at.is_some(), material: m })
        })
        .collect()
}

#[tauri::command]
pub fn scrap_status(store: State<Store>) -> Result<peta_core::scraps::Status, String> {
    store.lock().db().scrap_status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scrap_trade(app: AppHandle, store: State<Store>, trade: peta_core::scraps::Trade, request_id: String) -> Result<peta_core::scraps::Receipt, String> {
    let receipt = store.lock().db_mut().scrap_trade(&trade, &request_id).map_err(|e| e.to_string())?;
    crate::today::announce(&app);
    Ok(receipt)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub display_name: String,
    pub icon_sticker_id: Option<String>,
}

#[tauri::command]
pub fn profile_get(store: State<Store>) -> Result<Profile, String> {
    let lib = store.lock();
    let display_name = lib.db().display_name().map_err(|e| e.to_string())?;
    let icon_sticker_id = lib.db().profile_icon().map_err(|e| e.to_string())?;
    Ok(Profile { display_name, icon_sticker_id })
}

#[tauri::command]
pub fn profile_set_icon(app: AppHandle, store: State<Store>, sticker_id: Option<String>) -> Result<Profile, String> {
    store.lock().db_mut().set_profile_icon(sticker_id.as_deref()).map_err(|e| e.to_string())?;
    let profile = profile_get(store)?;
    let _ = app.emit("profile-changed", &profile);
    Ok(profile)
}

/// The name printed on the back of stickers you make from now on. Empty = back to the OS user name.
#[tauri::command]
pub fn profile_set(store: State<Store>, display_name: String) -> Result<Profile, String> {
    store.lock().db_mut().set_display_name(&display_name).map_err(|e| e.to_string())?;
    profile_get(store)
}
