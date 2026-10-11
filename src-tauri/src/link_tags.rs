//! Link tags (the rules are in `peta_core::link_tag`): the commands for the window and the one thing that touches the outside world, opening a target.
//! A tag only ever opens: an app by its bundle, a web address, a folder. It cannot run a file or a command.
use peta_core::link_tag::{self, Attach, LinkTag, Stock};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use crate::Store;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { pub stock: Stock, pub tags: Vec<LinkTag> }

#[tauri::command]
pub fn link_tag_status(store: State<Store>) -> Result<Status, String> {
    let lib = store.lock();
    Ok(Status { stock: lib.db().link_tag_stock().map_err(|e| e.to_string())?, tags: lib.db().link_tags().map_err(|e| e.to_string())? })
}

#[tauri::command]
pub fn link_tag_attach(app: AppHandle, store: State<Store>, request: Attach) -> Result<LinkTag, String> {
    let tag = store.lock().db_mut().link_tag_attach(&request.sticker_id, &request.kind, &request.target, &request.label, request.show_in_collection).map_err(|e| e.to_string())?;
    let _ = app.emit("link-tags-changed", ());
    Ok(tag)
}

#[tauri::command]
pub fn link_tag_set_show(app: AppHandle, store: State<Store>, sticker_id: String, show: bool) -> Result<(), String> {
    store.lock().db_mut().link_tag_set_show(&sticker_id, show).map_err(|e| e.to_string())?;
    let _ = app.emit("link-tags-changed", ());
    Ok(())
}

#[tauri::command]
pub fn link_tag_remove(app: AppHandle, store: State<Store>, sticker_id: String) -> Result<bool, String> {
    let removed = store.lock().db_mut().link_tag_remove(&sticker_id).map_err(|e| e.to_string())?;
    let _ = app.emit("link-tags-changed", ());
    Ok(removed)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picked { pub target: String, pub label: String }

/// Ask for an app (a .app) or a folder. Cancelling returns None.
#[tauri::command]
pub async fn link_tag_pick(window: WebviewWindow, app: AppHandle, kind: String) -> Result<Option<Picked>, String> {
    let dialog = app.dialog().file().set_parent(&window);
    let path = match kind.as_str() {
        "app" => dialog.set_directory("/Applications").add_filter("Application", &["app"]).blocking_pick_file(),
        "folder" => dialog.blocking_pick_folder(),
        _ => return Err("Choose an app or a folder.".into()),
    };
    let Some(path) = path.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let target = path.to_string_lossy().into_owned();
    let label = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default().chars().take(40).collect::<String>();
    link_tag::validate(&kind, &target, if label.is_empty() { "x" } else { &label }).map_err(|e| e.to_string())?;
    Ok(Some(Picked { target, label }))
}

/// Open what the tag points at. Re-checked here, from the saved record, so the window can never ask for anything else to be opened.
#[tauri::command]
pub fn link_tag_open(store: State<Store>, sticker_id: String) -> Result<(), String> {
    let tag = store.lock().db().link_tag(&sticker_id).map_err(|e| e.to_string())?.ok_or("This sticker has no link tag.")?;
    link_tag::validate(&tag.kind, &tag.target, &tag.label).map_err(|e| e.to_string())?;
    open(&tag).map_err(|e| format!("Could not open {}: {e}", tag.label))
}

fn open(tag: &LinkTag) -> std::io::Result<()> {
    use std::{path::Path, process::Command};
    let mut cmd = Command::new("/usr/bin/open");
    match tag.kind.as_str() {
        "app" => { if !Path::new(&tag.target).is_dir() { return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "that app is no longer there")); } cmd.arg("-a").arg(&tag.target); }
        "folder" => { if !Path::new(&tag.target).is_dir() { return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "that folder is no longer there")); } cmd.arg(&tag.target); }
        _ => { cmd.arg(&tag.target); }
    }
    let status = cmd.status()?;
    if status.success() { Ok(()) } else { Err(std::io::Error::other("the system could not open it")) }
}

/// The icon of a tagged app, as a small PNG (the one Finder shows, made once and kept under `<library>/tag-icons`). Empty for websites, folders and apps without one.
#[tauri::command]
pub async fn link_tag_icon(app: AppHandle, sticker_id: String) -> Result<tauri::ipc::Response, String> {
    let (tag, dir) = { let store = app.state::<Store>(); let lib = store.lock(); (lib.db().link_tag(&sticker_id).map_err(|e| e.to_string())?, lib.root().join("tag-icons")) };
    let Some(tag) = tag.filter(|t| t.kind == "app") else { return Ok(tauri::ipc::Response::new(Vec::<u8>::new())) };
    let png = tauri::async_runtime::spawn_blocking(move || app_icon_png(&tag.target, &dir)).await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(png.unwrap_or_default()))
}

/// The same picture for an app that has just been chosen in the attach dialog, before any tag is saved.
#[tauri::command]
pub async fn link_tag_app_icon(app: AppHandle, target: String) -> Result<tauri::ipc::Response, String> {
    link_tag::validate("app", &target, "x").map_err(|e| e.to_string())?;
    let dir = { let store = app.state::<Store>(); let lib = store.lock(); lib.root().join("tag-icons") };
    let png = tauri::async_runtime::spawn_blocking(move || app_icon_png(&target, &dir)).await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(png.unwrap_or_default()))
}

/// Asks the system for the app's icon, so apps that keep it in an asset catalog (not an .icns) and the current look both come out right.
const ICON_JXA: &str = r#"ObjC.import('AppKit');
function run(a) {
  const img = $.NSWorkspace.sharedWorkspace.iconForFile(a[0]), n = 160;
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel($(), n, n, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, n, n), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(a[1], true);
}"#;

fn app_icon_png(app: &str, dir: &std::path::Path) -> Option<Vec<u8>> {
    use std::{path::Path, process::Command};
    if !Path::new(app).is_dir() { return None; }
    let key: String = app.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3)).to_string();
    let out = dir.join(format!("{key}-v2.png"));
    if let Ok(hit) = std::fs::read(&out) { return Some(hit); }
    std::fs::create_dir_all(dir).ok()?;
    let ok = Command::new("/usr/bin/osascript").args(["-l", "JavaScript", "-e", ICON_JXA]).arg(app).arg(&out).output().ok()?.status.success();
    if ok { std::fs::read(&out).ok().filter(|b| !b.is_empty()) } else { None }
}
