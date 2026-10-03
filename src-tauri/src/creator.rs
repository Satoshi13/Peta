//! The Cutting Mat (spec §25): the window where a picked image becomes a sticker.
//! Pipeline and rendering live in `peta_core::creator`; this module owns the window, the one active
//! session and the commands the window calls. Nothing is spent until "Make this Peta".

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};

use peta_core::{
    creator::{self, Params, Session, DEFAULT_SMOOTH, DEFAULT_STRENGTH},
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
}

pub struct Creator {
    phase: Mutex<Phase>,
    active: Mutex<Option<Active>>,
    segmenter: OnceLock<Result<Arc<Segmenter>, String>>,
}

impl Default for Creator {
    fn default() -> Self {
        Creator { phase: Mutex::new(Phase::Idle), active: Mutex::new(None), segmenter: OnceLock::new() }
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
    let creator = app.state::<Creator>();
    *creator.active.lock().unwrap() = None;
    creator.set_phase(app, Phase::Loading);
    open_window(app).map_err(|e| e.to_string())?;

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let creator = app2.state::<Creator>();
        let outcome = creator
            .segmenter(&app2)
            .and_then(|seg| Session::new(&bytes, Some(seg.as_ref())).map_err(|e| e.to_string()));
        match outcome {
            Ok(session) => {
                *creator.active.lock().unwrap() = Some(Active { session, target });
                creator.set_phase(&app2, Phase::Ready);
            }
            Err(error) => creator.set_phase(&app2, Phase::Failed { error }),
        }
    });
    Ok(())
}

fn open_window(app: &AppHandle) -> tauri::Result<()> {
    crate::app_window::open(app, "create")
}

/// The window was closed (or cancelled): forget the session. Nothing was spent.
pub fn clear(app: &AppHandle) {
    let creator = app.state::<Creator>();
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
        .filter(Material::available)
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
        default_strength: DEFAULT_STRENGTH,
        default_smooth: DEFAULT_SMOOTH,
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
    let (rendered, original, ext, target) = {
        let active = creator.active.lock().unwrap();
        let a = active.as_ref().ok_or("no image is open")?;
        let rendered = a.session.render(&params_for(material_id, strength, smooth, outline)).map_err(|e| e.to_string())?;
        (rendered, a.session.original.clone(), a.session.original_ext, a.target.clone())
    };
    let material = materials::get(material_id).map(|m| m.id).unwrap_or_else(|| materials::DEFAULT_MATERIAL.to_owned());

    let date = app.state::<today::Today>().date();
    let store = app.state::<Store>();
    {
        let mut lib = store.lock();
        if target.counts_for_today && !lib.db().has_material(&material).map_err(|e| e.to_string())? {
            return Err(peta_core::Error::MaterialUnavailable.to_string()); // used up elsewhere while the Cutting Mat was open
        }
        let sticker = lib.add_made(&rendered, &original, ext, None, &material).map_err(|e| e.to_string())?;
        if !target.counts_for_today {
            // developer tools: no daily rule, no print — straight onto the desktop
            lib.stick_new(&sticker, &target.display_id, target.x, target.y).map_err(|e| e.to_string())?;
        } else {
            // the material is used up by making a sticker with it (plain paper never is)
            lib.db_mut().consume_material(&material).map_err(|e| e.to_string())?;
            // Keep every creation in the durable queue and Book; no daily sticker quota.
            daily::confirm(lib.db_mut(), &date, &sticker.id, SourceType::Created, random_unit()).map_err(|e| e.to_string())?;
        }
    }
    today::announce(app);
    if target.counts_for_today {
        print::begin(app);
    }
    Ok(())
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
