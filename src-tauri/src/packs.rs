//! Packs (Phase 6, local only): open one sticker from a pack, at random, as today's Peta.
//! The rules and storage live in `peta_core::pack` / the database; this module loads the picture, makes the
//! sticker and hands it to the same Print -> Grab -> Paste flow as a created one (nothing is stuck for you).

use peta_core::{daily, ids::random_unit, pack, PackSummary, SourceType};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{store::Store, today};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackStatus {
    pub packs: Vec<PackSummary>,
    /// Welcome's independent daily allowance; other packs depend only on remaining items.
    pub can_open: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub sticker_id: String,
    pub pack_title: String,
    pub remaining: i64,
    pub rarity: Option<String>,
}

#[tauri::command]
pub fn pack_status(app: AppHandle, store: tauri::State<Store>) -> Result<PackStatus, String> {
    let can_open = store.lock().db().welcome_available(&app.state::<today::Today>().date()).map_err(|e|e.to_string())?;
    let packs = store.lock().db().packs().map_err(|e| e.to_string())?;
    Ok(PackStatus { packs, can_open })
}

/// The picture of a pack item, from the assets shipped with the app.
fn item_bytes(app: &AppHandle, key: &str) -> Option<Vec<u8>> {
    let path = pack::welcome_item_path(key);
    let resolver = app.asset_resolver();
    resolver.get(path.clone()).or_else(|| resolver.get(format!("/{path}"))).map(|a| a.bytes)
}

#[tauri::command]
pub async fn pack_open(app: AppHandle, pack_id: String) -> Result<Opened, String> {
    let (item_id, key, title, by) = {
        let store = app.state::<Store>();
        let lib = store.lock();
        if pack_id==pack::WELCOME_PACK_ID && !lib.db().welcome_available(&app.state::<today::Today>().date()).map_err(|e|e.to_string())? { return Err("welcome_already_opened_today".into()); }
        let pack_row = lib.db().packs().map_err(|e| e.to_string())?.into_iter().find(|p| p.id == pack_id).ok_or("unknown pack")?;
        let (id, key) = lib.db().pack_pick(&pack_id, random_unit()).map_err(|e| e.to_string())?.ok_or("pack_empty")?;
        (id, key, pack_row.title, pack_row.by)
    };
    let stored={let store=app.state::<Store>();let lib=store.lock();pack::stored_item(lib.db(),item_id).map_err(|e|e.to_string())?};
    let bytes = if let Some(item)=&stored {app.state::<Store>().lock().read_asset(&item.png_path).map_err(|e|e.to_string())?} else {item_bytes(&app,&key).ok_or_else(||format!("the picture for {key} is missing"))?};

    let to_render = bytes.clone();
    let rendered = tauri::async_runtime::spawn_blocking(move || pack::render_pack_sticker(&to_render))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let date = app.state::<today::Today>().date();
    let remaining = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        if pack_id==pack::WELCOME_PACK_ID && !lib.db().welcome_available(&date).map_err(|e|e.to_string())? { return Err("welcome_already_opened_today".into()); }
        if !lib.db().pack_item_available(item_id).map_err(|e|e.to_string())? { return Err("that pack item was already opened".into()); }
        let sticker = lib
            .add_from_pack(&rendered, &bytes, "png", &title, &by, peta_core::materials::DEFAULT_MATERIAL)
            .map_err(|e| e.to_string())?;
        lib.db_mut().pack_open_on(item_id, &sticker.id, &date).map_err(|e| e.to_string())?;
        daily::confirm(lib.db_mut(), &date, &sticker.id, SourceType::Pack, random_unit()).map_err(|e| e.to_string())?;
        let remaining = lib.db().packs().map_err(|e| e.to_string())?.into_iter().find(|p| p.id == pack_id).map(|p| p.remaining).unwrap_or(0);
        (sticker.id, remaining)
    };
    today::announce(&app);
    // The ceremony hands it to the print layer after the main window closes.
    Ok(Opened { sticker_id: remaining.0, pack_title: title, remaining: remaining.1, rarity: stored.map(|i|i.rarity) })
}

// Static, free catalog entries are local packs. Paid entries and creator accounts stay UI-only.
#[tauri::command]
pub fn pack_install_demo(app: AppHandle, pack_id: String) -> Result<(), String> {
    let p = pack::market_pack(&pack_id).ok_or("This pack is not available yet")?;
    app.state::<Store>().lock().db_mut().pack_install(p.id,p.title,p.by,p.keys).map_err(|e|e.to_string())?;
    today::announce(&app);
    Ok(())
}
