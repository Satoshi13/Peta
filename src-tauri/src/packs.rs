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
    pub limits:Limits,
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Limits {copies_per_design:u32,pack_slots:u32,prizes:u32}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub sticker_id: Option<String>,
    pub kind:String,
    pub material_id:Option<String>,
    pub pack_title: String,
    pub remaining: i64,
    pub rarity: Option<String>,
    pub name: Option<String>,
}

#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn pack_status(app: AppHandle, store: tauri::State<Store>) -> Result<PackStatus, String> {
    let can_open = store.lock().db().welcome_available(&app.state::<today::Today>().date()).map_err(|e|e.to_string())?;
    store.lock().db_mut().replenish_developer_packs().map_err(|e|e.to_string())?;
    let packs = store.lock().db().packs().map_err(|e| e.to_string())?;
    Ok(PackStatus { packs, can_open,limits:Limits{copies_per_design:peta_core::edition_pack::MAX_COPIES_PER_DESIGN,pack_slots:peta_core::edition_pack::MAX_PACK_SLOTS,prizes:peta_core::edition_pack::MAX_PRIZES} })
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
pub async fn pack_open_free(app: AppHandle, pack_id: String, queue: Option<bool>) -> Result<Opened, String> {
    open(app, pack_id, true, queue.unwrap_or(true)).await
}

async fn open(app: AppHandle, pack_id: String, free: bool, queue: bool) -> Result<Opened, String> {
    let app2=app.clone();let id2=pack_id.clone();
    let edition=tauri::async_runtime::spawn_blocking(move|| -> Result<Option<Opened>,String> {
        let app=app2;let pack_id=id2;
        crate::referee_access::before_operation(&app);
    {
        let store=app.state::<Store>();let mut lib=store.lock();
        peta_core::edition_pack::ensure_can_open(&lib,&pack_id).map_err(|e|e.to_string())?;
        if peta_core::edition_pack::is_v2(lib.db(),&pack_id).map_err(|e|e.to_string())? {
            let title=lib.db().packs().map_err(|e|e.to_string())?.into_iter().find(|p|p.id==pack_id).ok_or("Unknown pack")?.title;
            let referee=crate::referee_access::active(&mut lib).map_err(|e|e.to_string())?;
            let award=peta_core::edition_pack::open(&mut lib,&pack_id,random_unit(),free,&app.state::<today::Today>().date(),queue,&referee).map_err(|e|e.to_string())?;
            drop(lib);today::announce(&app);return Ok(Some(Opened{sticker_id:award.sticker_id,kind:award.kind,material_id:award.material_id,pack_title:title,remaining:award.remaining,rarity:Some(award.rarity),name:Some(award.name)}));
        }
    }
        Ok(None)
    }).await.map_err(|e|e.to_string())??;
    if let Some(edition)=edition{return Ok(edition);}
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
    Ok(Opened { sticker_id: Some(remaining.0),kind:"sticker".into(),material_id:None, pack_title: title, remaining: remaining.1, rarity: stored.as_ref().map(|i|peta_core::materials::rarity_name(&i.material_id)), name:stored.map(|i|i.name) }) // the rarity of a pull is the rarity of its material
}

// Free acquisition is separate from the atomic Scraps exchange.
#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn pack_install_demo(app: AppHandle, pack_id: String) -> Result<(), String> {
    let p = pack::market_pack(&pack_id).ok_or("This pack is not available yet")?;
    if !p.free { return Err("Exchange Scraps for this pack.".into()); }
    app.state::<Store>().lock().db_mut().pack_install(p.id,p.title,p.by,p.keys).map_err(|e|e.to_string())?;
    today::announce(&app);
    Ok(())
}

/// One picture on a pack's card (Studio's "A peek inside"): which item, and what it is called.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeekItem { pub item_id: i64, pub name: String, pub material: String }

/// Up to three pictures of a signed pack: its cover, then the items that come out most often (the rarest stay a surprise).
#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn pack_peek(store: tauri::State<Store>, pack_id: String) -> Result<Vec<PeekItem>, String> {
    let lib = store.lock();
    Ok(peta_core::creator_pack::peek(lib.db(), &pack_id).map_err(|e| e.to_string())?
        .into_iter().map(|(item_id, name, _path, material)| PeekItem { item_id, name, material }).collect())
}

/// A small picture of one of those items.
#[tauri::command]
pub async fn pack_peek_picture(store: tauri::State<'_, Store>, item_id: i64) -> Result<tauri::ipc::Response, String> {
    let bytes = { let lib = store.lock(); let item = pack::stored_item(lib.db(), item_id).map_err(|e| e.to_string())?.ok_or("unknown pack item")?; lib.read_asset(&item.png_path).map_err(|e| e.to_string())? };
    let small = tauri::async_runtime::spawn_blocking(move || peta_core::thumb::thumbnail_png(&bytes, 384)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(small))
}

#[tauri::command]
pub async fn pack_cover_picture(store:tauri::State<'_,Store>,pack_id:String)->Result<tauri::ipc::Response,String> {
    let bytes={let lib=store.lock();peta_core::edition_pack::cover_picture(&lib,&pack_id).map_err(|e|e.to_string())?.ok_or("No cover sticker")?};
    let small=tauri::async_runtime::spawn_blocking(move||peta_core::thumb::thumbnail_png(&bytes,512)).await.map_err(|e|e.to_string())?.map_err(|e|e.to_string())?;
    Ok(tauri::ipc::Response::new(small))
}
