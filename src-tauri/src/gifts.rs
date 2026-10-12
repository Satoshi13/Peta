//! Gift (Phase 7, without accounts): transfer a real sticker as a sealed `.peta` file, and receive one.
//! The rules, the file format and the provenance live in `peta_core::gift`; this module owns the dialogs and the
//! hand-off to the same Print -> Grab -> Paste flow as every other new Peta. Accounts and a server would only change
//! how the file travels, not what is in it.

use peta_core::{gift, events, IncomingGift};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::{store::Store, today};

const EXT: &str = "peta";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    pub saved_to: String,
    pub edition: Option<i64>,
}

/// Transfer a real sticker to `to` and ask where to save the file. Cancelling the dialog changes nothing.
#[tauri::command]
pub async fn gift_send(window: WebviewWindow, app: AppHandle, sticker_id: String, to: String, note: Option<String>, dress: Option<gift::GiftDress>) -> Result<Option<Sent>, String> {
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
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<Sent>,String> {
    crate::referee_access::before_operation(&app);
    let store = app.state::<Store>();
    let mut lib = store.lock();
    let root=lib.root().to_owned();let mut publication=None;
    let referee=crate::referee_access::active(&mut lib).map_err(|e|e.to_string())?;
    let (_,bytes)=gift::transfer_gift(&mut lib,&sticker_id,&to,note.as_deref(),&dress.unwrap_or_default(),&referee,|bytes| {
        let id=gift::decode_gift(bytes)?.header.gift_id;
        publication=Some(peta_core::export::Export::publish(&root,&path,bytes,&id)?);Ok(())
    }).map_err(|e|format!("Could not save the gift: {e}"))?;
    if let Some(publication)=publication {publication.finish();}
    let edition=gift::decode_gift(&bytes).map_err(|e|e.to_string())?.header.edition;
    drop(lib);let _=app.emit("sticker-updated",&sticker_id);let _=app.emit("link-tags-changed",());
    today::announce(&app);let _=crate::layers::sync(&app);
    Ok(Some(Sent { saved_to: path.display().to_string(), edition }))
    }).await.map_err(|e|e.to_string())?
}

/// Open any supported Peta file. Only a verified official event can grant materials or envelopes.
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct FileResult {pub kind:String,pub result:String,pub pack:Option<PackOffer>}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct PackOffer {pub token:String,pub preview:peta_core::creator_pack::Preview}
#[derive(Default)]
pub struct PendingPack(std::sync::Mutex<Option<(String,Vec<u8>)>>);
#[tauri::command]
pub async fn gift_receive_file(app: AppHandle) -> Result<Option<FileResult>, String> {
    let picked=app.dialog().file().add_filter("Peta file",&[EXT]).blocking_pick_file().and_then(|p|p.into_path().ok());
    let Some(path)=picked else{return Ok(None)};
    tauri::async_runtime::spawn_blocking(move||receive_path(&app,&path).map(Some)).await.map_err(|e|e.to_string())?
}
pub fn read_file(path:&std::path::Path)->Result<Vec<u8>,String> {
    use std::io::Read;
    let mut bytes=Vec::new();std::fs::File::open(path).map_err(|e|format!("Could not read this file: {e}"))?.take((peta_core::sign::MAX_FILE+1) as u64).read_to_end(&mut bytes).map_err(|e|format!("Could not read this file: {e}"))?;
    if bytes.len()>peta_core::sign::MAX_FILE{return Err("This Peta file is too large.".into());}Ok(bytes)
}
pub fn receive_path(app:&AppHandle,path:&std::path::Path)->Result<FileResult,String> {
    crate::referee_access::before_operation(app);
    let bytes=read_file(path)?;
    let result={let store=app.state::<Store>();let mut lib=store.lock();
        if bytes.starts_with(events::MAGIC){
            let verified=events::decode(&bytes).map_err(|e|e.to_string())?;
            let receipt=events::apply_event(&mut lib,&verified,"file",peta_core::events::current_time()).map_err(|e|e.to_string())?;
            FileResult{kind:"event".into(),result:receipt.result,pack:None}
        } else if bytes.starts_with(peta_core::creator_pack::MAGIC) {
            let verified=peta_core::creator_pack::decode(&bytes).map_err(|e|e.to_string())?;
            let preview=peta_core::creator_pack::preview(&lib,&verified).map_err(|e|e.to_string())?;
            let token=peta_core::ids::new_gift_id();*app.state::<PendingPack>().0.lock().unwrap()=Some((token.clone(),bytes));
            FileResult{kind:"pack".into(),result:"Review this pack before adding it.".into(),pack:Some(PackOffer{token,preview})}
        } else {
            let referee=crate::referee_access::active(&mut lib).map_err(|e|e.to_string())?;
            gift::receive_gift_with_referee(&mut lib,&bytes,&referee).map_err(|e|e.to_string())?;
            FileResult{kind:"gift".into(),result:"A sealed gift arrived.".into(),pack:None}
        }
    };
    if result.kind!="pack" {today::announce(app);}Ok(result)
}
#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn redeem_code(app:AppHandle,code:String)->Result<FileResult,String> {
    let verified=events::from_code(&code).map_err(|e|e.to_string())?;
    let receipt={let store=app.state::<Store>();let mut lib=store.lock();events::apply_event(&mut lib,&verified,"code",events::current_time()).map_err(|e|e.to_string())?};
    today::announce(&app);Ok(FileResult{kind:"event".into(),result:receipt.result,pack:None})
}
#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn event_inbox(store:State<Store>)->Result<Vec<events::Receipt>,String> {events::inbox(store.lock().db()).map_err(|e|e.to_string())}
/// OS open-file events arrive after setup, including a launch caused by double-clicking a .peta.
pub fn open_external(app:&AppHandle,path:&std::path::Path) {
    let app=app.clone();let path=path.to_owned();
    tauri::async_runtime::spawn_blocking(move||{
    match receive_path(&app,&path) {
        Ok(result)=>{let _=crate::app_window::open(&app,"gifts");let _=app.emit("distribution-result",&result);},
        Err(error)=>{app.dialog().message(error).title("Peta").show(|_|{});}
    }
    });
}

#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn gift_inbox(store: State<Store>) -> Result<Vec<IncomingGift>, String> {
    store.lock().db().gifts_received().map_err(|e| e.to_string())
}

/// Keep a dismissed inbox notice quiet until a new gift arrives, even when seals are opened.
pub fn arrival_token(app: &AppHandle) -> Option<String> {
    let store = app.state::<Store>();
    let gifts = store.lock().db().gifts_received().ok()?;
    if !gifts.iter().any(|gift| gift.opened_at.is_none()) { return None; }
    let newest = gifts.iter().max_by(|a, b| (&a.received_at, &a.gift_id).cmp(&(&b.received_at, &b.gift_id)))?;
    Some(format!("gift:{}", newest.gift_id))
}

/// Break the seal: keep this gift in the Book and print queue. No daily limit or material cost.
#[tauri::command]
pub async fn gift_open(app: AppHandle, gift_id: String) -> Result<String, String> {
    let date = app.state::<today::Today>().date();
    let sticker_id = {
        let store = app.state::<Store>();
        let mut lib = store.lock();
        let sticker = gift::open_gift_print(&mut lib, &gift_id,&date).map_err(|e| e.to_string())?;
        sticker.id
    };
    today::announce(&app);
    // The ceremony hands it to the print layer after the main window closes.
    Ok(sticker_id)
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn file_reader_bounds_size_before_parsing_and_handles_missing_files() {
        let path=std::env::temp_dir().join(format!("peta-file-{}.peta",peta_core::ids::new_sticker_id()));
        let file=std::fs::File::create(&path).unwrap();file.set_len((peta_core::sign::MAX_FILE+1) as u64).unwrap();
        assert!(read_file(&path).unwrap_err().contains("too large"));std::fs::write(&path,b"PETAGIFT").unwrap();assert_eq!(read_file(&path).unwrap(),b"PETAGIFT");
        std::fs::remove_file(&path).unwrap();assert!(read_file(&path).is_err());
    }
}

#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn creator_pack_accept(app:AppHandle,token:String)->Result<String,String> {
    let bytes={let pending=app.state::<PendingPack>();let guard=pending.0.lock().unwrap();
        let (expected,bytes)=guard.as_ref().ok_or("No pack is waiting for confirmation.")?;
        if expected!=&token{return Err("A different pack arrived. Review it before adding it.".into());}bytes.clone()};
    let verified=peta_core::creator_pack::decode(&bytes).map_err(|e|e.to_string())?;
    let id={let store=app.state::<Store>();let mut lib=store.lock();peta_core::creator_pack::install(&mut lib,&verified,true).map_err(|e|e.to_string())?};
    creator_pack_decline(app.clone(),token);today::announce(&app);Ok(id)
}
#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn creator_pack_pending(app:AppHandle)->Result<Option<PackOffer>,String> {
    let offer=app.state::<PendingPack>().0.lock().unwrap().clone();
    let Some((token,bytes))=offer else{return Ok(None)};
    let verified=peta_core::creator_pack::decode(&bytes).map_err(|e|e.to_string())?;
    let preview=peta_core::creator_pack::preview(&app.state::<Store>().lock(),&verified).map_err(|e|e.to_string())?;Ok(Some(PackOffer{token,preview}))
}

#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn creator_pack_decline(app:AppHandle,token:String) {
    let pending=app.state::<PendingPack>();let mut guard=pending.0.lock().unwrap();if guard.as_ref().is_some_and(|(id,_)|id==&token){*guard=None;}
}
#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct SavedPack {pub pack_id:String,pub path:String}

#[tauri::command]
pub async fn creator_pack_save(window:WebviewWindow,app:AppHandle,title:String,pouch:String,items:Vec<peta_core::creator_pack::Selection>,prizes:Vec<peta_core::creator_pack::Prize>,dress:Option<peta_core::creator_pack::Dress>)->Result<Option<SavedPack>,String> {
    let Some(path)=app.dialog().file().set_parent(&window).add_filter("Peta pack",&["peta"]).set_file_name("My Pack.peta").blocking_save_file().and_then(|p|p.into_path().ok()) else{return Ok(None)};
    tauri::async_runtime::spawn_blocking(move|| -> Result<Option<SavedPack>,String> {
    crate::referee_access::before_operation(&app);
    let store=app.state::<Store>();let mut lib=store.lock();let root=lib.root().to_owned();let mut publication=None;
    let referee=crate::referee_access::active(&mut lib).map_err(|e|e.to_string())?;
    let id=peta_core::creator_pack::press(&mut lib,&title,&pouch,&items,&prizes,&dress.unwrap_or_default(),false,&referee,|h,bytes| {
        publication=Some(peta_core::export::Export::publish(&root,&path,bytes,&h.pack_id)?);Ok(())
    }).map_err(|e|e.to_string())?;
    if let Some(publication)=publication {publication.finish();}
    drop(lib);press_announced(&app);Ok(Some(SavedPack{pack_id:id,path:path.display().to_string()}))
    }).await.map_err(|e|e.to_string())?
}

/// My shelf keeps finished packs for later export; only friends can open them.
#[tauri::command]
pub async fn creator_pack_shelve(app:AppHandle,title:String,pouch:String,items:Vec<peta_core::creator_pack::Selection>,prizes:Vec<peta_core::creator_pack::Prize>,dress:Option<peta_core::creator_pack::Dress>)->Result<String,String> {
    tauri::async_runtime::spawn_blocking(move|| -> Result<String,String> {
    crate::referee_access::before_operation(&app);
    let store=app.state::<Store>();let mut lib=store.lock();
    let referee=crate::referee_access::active(&mut lib).map_err(|e|e.to_string())?;
    let id=peta_core::creator_pack::press(&mut lib,&title,&pouch,&items,&prizes,&dress.unwrap_or_default(),true,&referee,|_,_|Ok(())).map_err(|e|e.to_string())?;
    drop(lib);press_announced(&app);Ok(id)
    }).await.map_err(|e|e.to_string())?
}
fn press_announced(app:&AppHandle) {let _=app.emit("sticker-updated",());let _=app.emit("link-tags-changed",());let _=crate::layers::sync(app);today::announce(app);}

/// Export immutable signed bytes from My shelf, without pressing or consuming stock.
#[tauri::command]
pub async fn creator_pack_export(window:WebviewWindow,app:AppHandle,pack_id:String)->Result<Option<String>,String> {
    let Some(path)=app.dialog().file().set_parent(&window).add_filter("Peta pack",&["peta"]).set_file_name("My Pack.peta").blocking_save_file().and_then(|p|p.into_path().ok()) else{return Ok(None)};
    let store=app.state::<Store>();let mut lib=store.lock();
    peta_core::edition_pack::export_archived(&mut lib,&pack_id,&path).map_err(|e|e.to_string())?;Ok(Some(path.display().to_string()))
}
#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn creator_pack_store(app:AppHandle,pack_id:String)->Result<String,String> {
    let id=peta_core::edition_pack::store_archived(&mut app.state::<Store>().lock(),&pack_id).map_err(|e|e.to_string())?;
    today::announce(&app);Ok(id)
}

/// Local Market visibility of a finished own pack; no transfer or stock changes.
#[cfg_attr(feature="server",tauri::command(async))]
#[cfg_attr(not(feature="server"),tauri::command)]
pub fn creator_pack_set_listed(app:AppHandle,pack_id:String,listed:bool)->Result<bool,String> {
    let listed=peta_core::edition_pack::set_listed(&mut app.state::<Store>().lock(),&pack_id,listed).map_err(|e|e.to_string())?;
    today::announce(&app);Ok(listed)
}
