//! Packs (Phase 6, local only): open one sticker from a pack, at random, as today's Peta.
//! The rules and storage live in `peta_core::pack` / the database; this module loads the picture, makes the
//! sticker and hands it to the same Print -> Grab -> Paste flow as a created one (nothing is stuck for you).

use peta_core::{daily, ids::random_unit, pack, PackSummary, SourceType};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{print, store::Store, today};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackStatus {
    pub packs: Vec<PackSummary>,
    /// Today's new Peta is still free, so a pack can be opened.
    pub can_open: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub sticker_id: String,
    pub pack_title: String,
    pub remaining: i64,
}

#[tauri::command]
pub fn pack_status(app: AppHandle, store: tauri::State<Store>) -> Result<PackStatus, String> {
    let can_open = today::status(&app)?.can_create; // before taking the library lock (status takes it too)
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
    if !today::status(&app)?.can_create {
        return Err(today::ALREADY_USED.into());
    }
    let (item_id, key, title, by) = {
        let store = app.state::<Store>();
        let lib = store.lock();
        let pack_row = lib.db().packs().map_err(|e| e.to_string())?.into_iter().find(|p| p.id == pack_id).ok_or("unknown pack")?;
        let (id, key) = lib.db().pack_pick(&pack_id, random_unit()).map_err(|e| e.to_string())?.ok_or("pack_empty")?;
        (id, key, pack_row.title, pack_row.by)
    };
    let bytes = item_bytes(&app, &key).ok_or_else(|| format!("the picture for {key} is missing"))?;

    let to_render = bytes.clone();
    let rendered = tauri::async_runtime::spawn_blocking(move || pack::render_pack_sticker(&to_render))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let date = app.state::<today::Today>().date();
    let remaining = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
        if !record.slot(false).can_add_new() {
            return Err(today::ALREADY_USED.into()); // spent elsewhere while this was rendering
        }
        let sticker = lib
            .add_from_pack(&rendered, &bytes, "png", &title, &by, peta_core::materials::DEFAULT_MATERIAL)
            .map_err(|e| e.to_string())?;
        lib.db_mut().pack_mark_opened(item_id, &sticker.id).map_err(|e| e.to_string())?;
        daily::confirm(lib.db_mut(), &date, &sticker.id, SourceType::Pack, random_unit()).map_err(|e| e.to_string())?;
        let remaining = lib.db().packs().map_err(|e| e.to_string())?.into_iter().find(|p| p.id == pack_id).map(|p| p.remaining).unwrap_or(0);
        (sticker.id, remaining)
    };
    today::announce(&app);
    print::begin(&app); // it is printed at the slot and waits to be grabbed
    Ok(Opened { sticker_id: remaining.0, pack_title: title, remaining: remaining.1 })
}
