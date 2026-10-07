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
    pub name: Option<String>,
}

#[tauri::command]
pub fn pack_status(app: AppHandle, store: tauri::State<Store>) -> Result<PackStatus, String> {
    let can_open = store.lock().db().welcome_available(&app.state::<today::Today>().date()).map_err(|e|e.to_string())?;
    store.lock().db_mut().replenish_developer_packs().map_err(|e|e.to_string())?;
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
/// `queue: false` keeps the sticker in the Collection without adding it to the print queue (ten at once never queue ten prints).
pub async fn pack_open(app: AppHandle, pack_id: String, queue: Option<bool>) -> Result<Opened, String> {
    open(app, pack_id, false, queue.unwrap_or(true)).await
}

#[tauri::command]
pub async fn pack_open_free(app: AppHandle, pack_id: String) -> Result<Opened, String> {
    open(app, pack_id, true, true).await
}

async fn open(app: AppHandle, pack_id: String, free: bool, queue: bool) -> Result<Opened, String> {
    let (item_id, key, title, by) = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        lib.db_mut().replenish_developer_packs().map_err(|e|e.to_string())?;
        if free && lib.db().pack_free_openings(&pack_id).map_err(|e|e.to_string())?==0 { return Err("No free opening is ready for this pack.".into()); }
        if !free && pack_id==pack::WELCOME_PACK_ID && !lib.db().welcome_available(&app.state::<today::Today>().date()).map_err(|e|e.to_string())? { return Err("welcome_already_opened_today".into()); }
        let pack_row = lib.db().packs().map_err(|e| e.to_string())?.into_iter().find(|p| p.id == pack_id).ok_or("unknown pack")?;
        let chosen = if free { peta_core::creator_pack::pick_bonus(lib.db(),&pack_id,random_unit(),random_unit()) } else { peta_core::creator_pack::pick(lib.db(),&pack_id,random_unit(),random_unit()) };
        let (id, key) = chosen.map_err(|e| e.to_string())?.ok_or("pack_empty")?;
        (id, key, pack_row.title, pack_row.by)
    };
    let stored={let store=app.state::<Store>();let lib=store.lock();pack::stored_item(lib.db(),item_id).map_err(|e|e.to_string())?};
    let bytes = if let Some(item)=&stored {app.state::<Store>().lock().read_asset(&item.png_path).map_err(|e|e.to_string())?} else {item_bytes(&app,&key).ok_or_else(||format!("the picture for {key} is missing"))?};

    let rendered=if stored.as_ref().is_some_and(|i|i.finished){None}else {
        let to_render=bytes.clone();Some(tauri::async_runtime::spawn_blocking(move || pack::render_pack_sticker(&to_render)).await.map_err(|e|e.to_string())?.map_err(|e|e.to_string())?)
    };

    let date = app.state::<today::Today>().date();
    let remaining = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        if free && lib.db().pack_free_openings(&pack_id).map_err(|e|e.to_string())?==0 { return Err("No free opening is ready for this pack.".into()); }
        if !free && pack_id==pack::WELCOME_PACK_ID && !lib.db().welcome_available(&date).map_err(|e|e.to_string())? { return Err("welcome_already_opened_today".into()); }
        if !free && !lib.db().pack_item_available(item_id).map_err(|e|e.to_string())? { return Err("that pack item was already opened".into()); }
        if free { daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e|e.to_string())?; }
        let sticker=if let Some(item)=stored.as_ref().filter(|i|i.finished) {
            let mask=item.mask_path.as_ref().map(|p|lib.read_asset(p)).transpose().map_err(|e|e.to_string())?.unwrap_or_default();
            lib.add_finished_from_pack(&bytes,&mask,&title,&by,&item.material_id)
        }else {lib.add_from_pack(rendered.as_ref().expect("catalog render"),&bytes,"png",&title,&by,peta_core::materials::DEFAULT_MATERIAL)}.map_err(|e|e.to_string())?;
        if free {
            if let Err(error) = lib.db_mut().claim_pack_free_opening(&pack_id, item_id, &sticker.id, &date) {
                lib.discard_unconfirmed_pack(&sticker.id).map_err(|cleanup| format!("{error}; {cleanup}"))?;
                return Err(error.to_string());
            }
        }
        else {
            lib.db_mut().pack_open_on(item_id, &sticker.id, &date).map_err(|e|e.to_string())?;
            if queue { daily::confirm(lib.db_mut(), &date, &sticker.id, SourceType::Pack, random_unit()).map_err(|e|e.to_string())?; }
        }
        let remaining = lib.db().packs().map_err(|e| e.to_string())?.into_iter().find(|p| p.id == pack_id).map(|p| p.remaining).unwrap_or(0);
        (sticker.id, remaining)
    };
    today::announce(&app);
    // The ceremony hands it to the print layer after the main window closes.
    Ok(Opened { sticker_id: remaining.0, pack_title: title, remaining: remaining.1, rarity: stored.as_ref().map(|i|i.rarity.clone()), name:stored.map(|i|i.name) })
}

// Free acquisition is separate from the atomic Scraps exchange.
#[tauri::command]
pub fn pack_install_demo(app: AppHandle, pack_id: String) -> Result<(), String> {
    let p = pack::market_pack(&pack_id).ok_or("This pack is not available yet")?;
    if !p.free { return Err("Exchange Scraps for this pack.".into()); }
    app.state::<Store>().lock().db_mut().pack_install(p.id,p.title,p.by,p.keys).map_err(|e|e.to_string())?;
    today::announce(&app);
    Ok(())
}
