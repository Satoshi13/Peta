//! The Cutting Mat (spec §25): the window where a picked image becomes a sticker.
//! Pipeline and rendering live in `peta_core::creator`; this module owns the window, the one active
//! session and the commands the window calls. Nothing is spent until "Make this Peta".

use std::{
    path::PathBuf,
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex, OnceLock},
};

use peta_core::{
    creator::{self, EditorState, Params, Session, DEFAULT_SMOOTH, DEFAULT_STRENGTH},
    daily,
    ids::random_unit,
    materials,
    segment::Segmenter,
    Material, SourceType,
};
use serde::Serialize;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

use crate::{print, store::Store, today};


/// u2netp, 4.5 MB: bundled so cutting out works offline from the first launch.
const BUNDLED_MODEL: &[u8] = include_bytes!("../models/u2netp.onnx");

/// Where the finished sticker goes, and whether it is today's Peta.
#[derive(Clone)]
pub struct Target {
    pub display_id: String,
    pub x: f64,
    pub y: f64,
    /// false for developer tools: the daily rule is bypassed.
    pub counts_for_today: bool,
    /// Preselected material (e.g. the one picked on the Today screen).
    pub material_hint: Option<String>,
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum Phase {
    Idle,
    Loading,
    Ready,
    Failed { error: String },
}

struct Active {
    session: Session,
    target: Target,
    editing_id: Option<String>,
    settings: Option<(f32, f32, f32)>,
}

pub struct Creator {
    phase: Mutex<Phase>,
    active: Mutex<Option<Active>>,
    segmenter: OnceLock<Result<Arc<Segmenter>, String>>,
    generation: AtomicU64,
}

impl Default for Creator {
    fn default() -> Self {
        Creator { phase: Mutex::new(Phase::Idle), active: Mutex::new(None), segmenter: OnceLock::new(), generation: AtomicU64::new(0) }
    }
}

impl Creator {
    /// Loaded on first use (a second or so), then kept.
    fn segmenter(&self, app: &AppHandle) -> Result<Arc<Segmenter>, String> {
        self.segmenter
            .get_or_init(|| {
                let mut dirs: Vec<PathBuf> = Vec::new();
                if let Ok(d) = app.path().app_data_dir() {
                    dirs.push(d.join("models"));
                }
                if let Ok(d) = app.path().resource_dir() {
                    dirs.push(d.join("models"));
                }
                dirs.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/models")));
                creator::load_segmenter(&dirs, BUNDLED_MODEL).map(Arc::new).map_err(|e| e.to_string())
            })
            .clone()
    }

    fn set_phase(&self, app: &AppHandle, phase: Phase) {
        *self.phase.lock().unwrap() = phase;
        let _ = app.emit("creator-changed", ());
    }
}

// ---- starting / ending a session ----

/// Open the Cutting Mat for an image. Returns as soon as the window is up; the analysis runs in the
/// background and the window is told when it is done. Fails with `already_used_today` if today's Peta
/// is already made (and this one would count).
pub fn begin(app: &AppHandle, bytes: Vec<u8>, target: Target) -> Result<(), String> {
    if target.counts_for_today {
        let store = app.state::<Store>();
        let lib = store.lock();
        let available = if let Some(id) = &target.material_hint {
            materials::get(id).is_some() && lib.db().has_material(id).map_err(|e| e.to_string())?
        } else {
            materials::catalog().iter().any(|m| lib.db().has_material(&m.id).unwrap_or(false))
        };
        if !available { return Err(peta_core::Error::MaterialUnavailable.to_string()); }
    }
    let creator = app.state::<Creator>();
    let generation = creator.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *creator.active.lock().unwrap() = None;
    creator.set_phase(app, Phase::Loading);
    open_window(app).map_err(|e| e.to_string())?;

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let creator = app2.state::<Creator>();
        let outcome = creator
            .segmenter(&app2)
            .and_then(|seg| Session::new(&bytes, Some(seg.as_ref())).map_err(|e| e.to_string()));
        let mut active = creator.active.lock().unwrap();
        if creator.generation.load(Ordering::SeqCst) != generation { return; }
        match outcome {
            Ok(session) => {
                *active = Some(Active { session, target, editing_id: None, settings: None });
                creator.set_phase(&app2, Phase::Ready);
            }
            Err(error) => creator.set_phase(&app2, Phase::Failed { error }),
        }
    });
    Ok(())
}

/// Start cutting whatever picture is on the clipboard. The pasteboard is read on the main thread; call this off it.
pub async fn begin_from_clipboard(app: &AppHandle, material_hint: Option<String>) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || { let _ = tx.send(crate::platform::clipboard_image()); }).map_err(|e| e.to_string())?;
    let bytes = rx.recv().ok().flatten().ok_or("There is no picture on the clipboard.")?;
    let layers = app.state::<crate::layers::Layers>();
    begin(app, bytes, Target { display_id: layers.primary_display_id(), x: 0.5, y: 0.5, counts_for_today: true, material_hint })
}

#[tauri::command]
pub async fn creator_begin_clipboard(app: AppHandle, material_id: String) -> Result<(), String> {
    begin_from_clipboard(&app, Some(material_id)).await
}

const MAX_IMAGE_BYTES: u64 = 80 * 1024 * 1024;

/// Is this a picture file the cutter can read?
pub fn is_cuttable_image(path: &std::path::Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
}

/// A picture handed to Peta by Finder ("Open With", or dropped on the app icon) is cut out like a picked image.
/// Returns false when the file is not a picture, so the caller can try other file kinds.
pub fn open_image_file(app: &AppHandle, path: &std::path::Path) -> bool {
    if !is_cuttable_image(path) { return false; }
    let outcome = (|| -> Result<(), String> {
        let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        if size > MAX_IMAGE_BYTES { return Err("That picture is too large to cut out.".into()); }
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let layers = app.state::<crate::layers::Layers>();
        begin(app, bytes, Target { display_id: layers.primary_display_id(), x: 0.5, y: 0.5, counts_for_today: true, material_hint: None })
    })();
    if let Err(error) = outcome {
        use tauri_plugin_dialog::DialogExt;
        app.dialog().message(error).title("Peta").show(|_| {});
    }
    true
}

fn open_window(app: &AppHandle) -> tauri::Result<()> {
    crate::app_window::open(app, "create")
}

/// The window was closed (or cancelled): forget the session. Nothing was spent.
pub fn clear(app: &AppHandle) {
    let creator = app.state::<Creator>();
    creator.generation.fetch_add(1, Ordering::SeqCst);
    *creator.active.lock().unwrap() = None;
    *creator.phase.lock().unwrap() = Phase::Idle;
}

// ---- commands ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorInfo {
    #[serde(flatten)]
    phase: Phase,
    width: usize,
    height: usize,
    had_alpha: bool,
    counts_for_today: bool,
    materials: Vec<Material>,
    default_material: String,
    default_strength: f32,
    default_smooth: f32,
    default_outline: f32,
    editing_sticker_id: Option<String>,
}

#[tauri::command]
pub fn creator_info(app: AppHandle, creator: State<Creator>, store: State<Store>) -> CreatorInfo {
    let phase = creator.phase.lock().unwrap().clone();
    // today::status takes the library lock itself, so ask it before taking ours (holding both deadlocked
    // and left the Cutting Mat spinning forever).
    let todays = today::status(&app).ok().and_then(|s| s.material.map(|m| m.id));
    let active = creator.active.lock().unwrap();
    let lib = store.lock();
    // only what can be used right now: plain paper, and anything still in stock
    let unlocked: Vec<Material> = lib
        .db()
        .unlocked_material_ids()
        .unwrap_or_default()
        .iter()
        .filter_map(|id| lib.db().material_with_stock(id).ok().flatten())
        .filter(|m| m.available() || active.as_ref().is_some_and(|a| a.editing_id.is_some() && a.target.material_hint.as_deref() == Some(m.id.as_str())))
        .collect();
    let (counts, hint) = active
        .as_ref()
        .map(|a| (a.target.counts_for_today, a.target.material_hint.clone()))
        .unwrap_or((true, None));
    let default_material = [hint, if counts { todays } else { None }]
        .into_iter()
        .flatten()
        .find(|id| unlocked.iter().any(|m| &m.id == id))
        .unwrap_or_else(|| materials::DEFAULT_MATERIAL.to_owned());
    let (width, height, had_alpha) = active
        .as_ref()
        .map(|a| (a.session.analysis.w, a.session.analysis.h, a.session.analysis.had_alpha))
        .unwrap_or((0, 0, false));
    CreatorInfo {
        phase,
        width,
        height,
        had_alpha,
        counts_for_today: counts,
        materials: unlocked,
        default_material,
        default_strength: active.as_ref().and_then(|a| a.settings).map(|s| s.2).unwrap_or(DEFAULT_STRENGTH),
        default_smooth: active.as_ref().and_then(|a| a.settings).map(|s| s.1).unwrap_or(DEFAULT_SMOOTH),
        default_outline: active.as_ref().and_then(|a| a.settings).map(|s| s.0).unwrap_or(20.0),
        editing_sticker_id: active.as_ref().and_then(|a| a.editing_id.clone()),
    }
}

/// The photo, downscaled (JPEG): the Cutting Mat's left pane.
#[tauri::command]
pub fn creator_original(creator: State<Creator>) -> Result<Response, String> {
    let active = creator.active.lock().unwrap();
    let a = active.as_ref().ok_or("no image is open")?;
    a.session.original_jpeg().map(Response::new).map_err(|e| e.to_string())
}

fn params_for(material_id: &str, strength: f32, smooth: f32, outline: Option<f32>) -> Params {
    let material = materials::get(material_id).or_else(|| materials::get(materials::DEFAULT_MATERIAL)).expect("default material exists");
    let mut recipe = material.recipe;
    if let (Some(width), Some(border)) = (outline, recipe.border.as_mut()) { border.width = width.clamp(4.0, 64.0) as f64 / 520.0; }
    Params { strength, smooth, recipe }
}

/// Wire format: 4-byte big-endian JSON length, JSON `{ stickerLen, cutoutLen, width, height, coverage }`,
/// then the sticker PNG, then the cutout PNG.
fn pack(r: &creator::Rendered) -> Vec<u8> {
    let header = serde_json::json!({
        "stickerLen": r.sticker_png.len(), "cutoutLen": r.cutout_png.len(),
        "width": r.width, "height": r.height, "coverage": r.coverage,
    })
    .to_string();
    let mut out = Vec::with_capacity(4 + header.len() + r.sticker_png.len() + r.cutout_png.len());
    out.extend_from_slice(&(header.len() as u32).to_be_bytes());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(&r.sticker_png);
    out.extend_from_slice(&r.cutout_png);
    out
}

/// Re-render with the current settings. `preview` = half size, fast (live feedback).
#[tauri::command]
pub async fn creator_render(app: AppHandle, material_id: String, strength: f32, smooth: f32, preview: bool, outline: Option<f32>) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let creator = app.state::<Creator>();
        // Copy only the render inputs; release the session lock before the expensive work.
        // Painting / undo can continue while a stale preview finishes in the background.
        let (analysis, edits) = {
            let active = creator.active.lock().unwrap();
            active.as_ref().ok_or("no image is open")?.session.render_inputs(preview)
        };
        let params = params_for(&material_id, strength, smooth, outline);
        let rendered = peta_core::creator::render(&analysis, Some(&edits), &params);
        rendered.map(|r| Response::new(pack(&r))).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A brush stroke; points and radius are fractions of the image width / height (radius: of the width).
///
/// `new_stroke` starts a new undo step; the pieces that follow it (a stroke is streamed while it is painted) belong to it.
#[tauri::command]
pub async fn creator_stroke(app: AppHandle, points: Vec<(f32, f32)>, radius: f32, restore: bool, new_stroke: bool) -> Result<History, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let creator = app.state::<Creator>();
        let mut active = creator.active.lock().unwrap();
        let a = active.as_mut().ok_or("no image is open")?;
        let (w, h) = a.session.size();
        let px: Vec<(f32, f32)> = points.iter().map(|(x, y)| (x * w as f32, y * h as f32)).collect();
        a.session.stroke(&px, radius * w as f32, restore, new_stroke);
        Ok(History::of(&a.session))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn creator_clear_edits(creator: State<Creator>) -> Result<History, String> {
    let mut active = creator.active.lock().unwrap();
    let a = active.as_mut().ok_or("no image is open")?;
    a.session.clear_edits();
    Ok(History::of(&a.session))
}

/// Ctrl/Cmd+Z: take back the last stroke.
#[tauri::command]
pub fn creator_undo(creator: State<Creator>) -> Result<History, String> {
    let mut active = creator.active.lock().unwrap();
    let a = active.as_mut().ok_or("no image is open")?;
    a.session.undo();
    Ok(History::of(&a.session))
}

/// Shift+Ctrl/Cmd+Z (or Ctrl+Y): put it back.
#[tauri::command]
pub fn creator_redo(creator: State<Creator>) -> Result<History, String> {
    let mut active = creator.active.lock().unwrap();
    let a = active.as_mut().ok_or("no image is open")?;
    a.session.redo();
    Ok(History::of(&a.session))
}

/// What the Undo / Redo buttons need to know.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    can_undo: bool,
    can_redo: bool,
}

impl History {
    fn of(session: &Session) -> Self {
        History { can_undo: session.can_undo(), can_redo: session.can_redo() }
    }
}

/// "Make this Peta": render at full size, keep it in the library, consume one material (except Matte), and enqueue it for printing.
#[tauri::command]
pub async fn creator_finish(app: AppHandle, material_id: String, strength: f32, smooth: f32, outline: Option<f32>) -> Result<(), String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || finish(&app2, &material_id, strength, smooth, outline))
        .await
        .map_err(|e| e.to_string())??;
    clear(&app);
    Ok(())
}

fn finish(app: &AppHandle, material_id: &str, strength: f32, smooth: f32, outline: Option<f32>) -> Result<(), String> {
    let creator = app.state::<Creator>();
    let (rendered, original, ext, target, editor) = {
        let active = creator.active.lock().unwrap();
        let a = active.as_ref().ok_or("no image is open")?;
        if a.editing_id.is_some() { return Err("save changes to the original instead of making a new sticker".into()); }
        let rendered = a.session.render(&params_for(material_id, strength, smooth, outline)).map_err(|e| e.to_string())?;
        let editor = EditorState::capture(&a.session, outline.unwrap_or(20.0).clamp(4.0, 64.0), smooth, strength);
        (rendered, a.session.original.clone(), a.session.original_ext, a.target.clone(), editor)
    };
    let material = materials::get(material_id).map(|m| m.id).unwrap_or_else(|| materials::DEFAULT_MATERIAL.to_owned());

    let date = app.state::<today::Today>().date();
    let store = app.state::<Store>();
    let mut made_id = None;
    {
        let mut lib = store.lock();
        if target.counts_for_today && !lib.db().has_material(&material).map_err(|e| e.to_string())? {
            return Err(peta_core::Error::MaterialUnavailable.to_string()); // used up elsewhere while the Cutting Mat was open
        }
        let sticker = lib.add_made_with_editor(&rendered, &original, ext, &material, &editor).map_err(|e| e.to_string())?;
        if !target.counts_for_today {
            // developer tools: no daily rule, no print — straight onto the desktop
            lib.stick_new(&sticker, &target.display_id, target.x, target.y).map_err(|e| e.to_string())?;
        } else {
            // the material is used up by making a sticker with it (plain paper never is)
            lib.db_mut().consume_material(&material).map_err(|e| e.to_string())?;
            // Keep every creation in the durable queue and Book; no daily sticker quota.
            daily::confirm(lib.db_mut(), &date, &sticker.id, SourceType::Created, random_unit()).map_err(|e| e.to_string())?;
            // What was just made prints first, even when older stickers are still waiting.
            lib.db_mut().print_prioritize(&[sticker.id.as_str()]).map_err(|e| e.to_string())?;
            made_id = Some(sticker.id.clone());
        }
    }
    today::announce(app);
    if made_id.is_some() {
        print::begin(app);
    }
    Ok(())
}

/// Reopen the original source and saved cutout, keeping its identity and material.
#[tauri::command]
pub async fn creator_edit_original(app: AppHandle, sticker_id: String) -> Result<(), String> {
    let (sticker, bytes, mask, editor) = app.state::<Store>().lock().original_for_edit(&sticker_id).map_err(|e| e.to_string())?;
    let creator = app.state::<Creator>();
    let generation = creator.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *creator.active.lock().unwrap() = None; creator.set_phase(&app, Phase::Loading);
    open_window(&app).map_err(|e| e.to_string())?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let creator = app2.state::<Creator>();
        let outcome = (|| -> Result<Active, String> {
            let seg = creator.segmenter(&app2)?;
            let mut session = Session::new(&bytes, Some(seg.as_ref())).map_err(|e| e.to_string())?;
            let settings = if let Some(editor) = editor {
                editor.restore(&mut session).map_err(|e| e.to_string())?;
                (editor.outline, editor.smooth, editor.strength)
            } else {
                if let Some(mask) = mask { session.restore_mask(&mask).map_err(|e| e.to_string())?; }
                (20.0, 0.0, DEFAULT_STRENGTH)
            };
            Ok(Active { session, target: Target { display_id: String::new(), x: 0.5, y: 0.5, counts_for_today: false,
                material_hint: Some(sticker.material_id.unwrap_or_else(|| "matte".into())) }, editing_id: Some(sticker_id), settings: Some(settings) })
        })();
        let mut slot = creator.active.lock().unwrap();
        if creator.generation.load(Ordering::SeqCst) != generation { return; }
        match outcome {
            Ok(active) => { *slot = Some(active); creator.set_phase(&app2, Phase::Ready); }
            Err(error) => creator.set_phase(&app2, Phase::Failed { error }),
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn creator_save_original(app: AppHandle, material_id: String, strength: f32, smooth: f32, outline: f32) -> Result<String, String> {
    if !strength.is_finite() || !(0.0..=1.0).contains(&strength) || !smooth.is_finite() || !(0.0..=1.0).contains(&smooth) || !outline.is_finite() || !(4.0..=64.0).contains(&outline) {
        return Err("invalid cutout settings".into());
    }
    let app2 = app.clone();
    let id = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let creator = app2.state::<Creator>();
        let (id, rendered, editor) = {
            let active = creator.active.lock().unwrap(); let a = active.as_ref().ok_or("no image is open")?;
            let id = a.editing_id.clone().ok_or("no original is being edited")?;
            if a.target.material_hint.as_deref() != Some(material_id.as_str()) { return Err("keep the original material when editing".into()); }
            let rendered = a.session.render(&params_for(&material_id, strength, smooth, Some(outline))).map_err(|e| e.to_string())?;
            let editor = EditorState::capture(&a.session, outline.clamp(4.0, 64.0), smooth, strength);
            (id, rendered, editor)
        };
        app2.state::<Store>().lock().update_original(&id, &rendered, &editor).map_err(|e| e.to_string())?;
        Ok(id)
    }).await.map_err(|e| e.to_string())??;
    clear(&app); let _ = app.emit("sticker-updated", &id); today::announce(&app);
    Ok(id)
}

/// Cancel: close the window, keep everything as it was.
#[tauri::command]
pub fn creator_cancel(app: AppHandle) {
    clear(&app);
}

#[tauri::command]
pub fn creator_begin_bytes(app: AppHandle, layers: State<crate::layers::Layers>, bytes: Vec<u8>, material_id: String) -> Result<(), String> {
    begin(&app, bytes, Target { display_id: layers.primary_display_id(), x: 0.5, y: 0.5, counts_for_today: true, material_hint: Some(material_id) })
}

#[tauri::command]
pub fn creator_begin_path(app: AppHandle, layers: State<crate::layers::Layers>, path: String, material_id: String) -> Result<(), String> {
    let bytes=std::fs::read(path).map_err(|e|e.to_string())?;
    begin(&app,bytes,Target {display_id:layers.primary_display_id(),x:0.5,y:0.5,counts_for_today:true,material_hint:Some(material_id)})
}

#[cfg(test)]
mod open_image_tests {
    use super::is_cuttable_image;
    use std::path::Path;

    #[test]
    fn only_formats_the_cutter_reads_are_taken() {
        for ok in ["a.png", "b.JPG", "c.jpeg", "d.WebP", "/x/y z/e.png"] { assert!(is_cuttable_image(Path::new(ok)), "{ok}"); }
        for no in ["a.peta", "b.gif", "c.heic", "d", "e.png.txt", ".png"] { assert!(!is_cuttable_image(Path::new(no)), "{no}"); }
    }
}

