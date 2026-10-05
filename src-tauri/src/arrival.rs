//! Desktop arrival notification on the existing primary sticker layer; opens a page in the one main shell.
use tauri::{AppHandle,Emitter,Manager};
use std::sync::atomic::{AtomicBool,Ordering};
static VISIBLE:AtomicBool=AtomicBool::new(false);
use crate::{gifts,today,layers::Layers};
fn wanted(app:&AppHandle)->Option<&'static str> {
    if gifts::unopened_count(app)>0 {Some("gift")}
    else if matches!(today::status(app),Ok(s) if s.material_opened && s.bonus_envelopes>0) {Some("extra")}
    else if matches!(today::status(app),Ok(s) if !s.material_opened) {Some("material")}
    else {None}
}
pub fn sync(app:&AppHandle) { let kind=wanted(app); VISIBLE.store(kind.is_some(),Ordering::Relaxed); let _=app.emit("arrival-changed",kind); }
#[tauri::command]
pub fn arrival_status(app:AppHandle)->Option<String> {wanted(&app).map(str::to_owned)}
#[tauri::command]
pub fn arrival_open(app:AppHandle) {
    let page=if gifts::unopened_count(&app)>0 {"gifts"} else {"today"};
    if let Err(e)=crate::app_window::open(&app,page) {eprintln!("[peta] could not open arrival: {e}");}
}
/// Resting layers pass clicks through except while the pointer is over the notification.
/// This uses the existing layer, not an additional Arrival content window. Print/Edit keep priority.
pub fn spawn_hit_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut hovered = String::new();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(40));
            let handle = app.clone();
            let (done, completed) = std::sync::mpsc::channel();
            // AppKit reads and writes must run together on the main thread. In particular,
            // applying a layer mode sends NSWindow messages directly, without Tauri dispatch.
            // Wait for completion so a busy event loop cannot accumulate stale hover updates.
            if app.run_on_main_thread(move || {
                let next = update_hover(&handle, &hovered);
                let _ = done.send(next);
            }).is_err() {
                break;
            }
            match completed.recv() {
                Ok(next) => hovered = next,
                Err(_) => break,
            }
        }
    });
}

/// Called only inside the main-thread task. Recheck Print/Edit before touching any window,
/// so a queued hover update cannot undo a mode change or operate on a rebuilt layer.
fn update_hover(app: &AppHandle, hovered: &str) -> String {
    if app.state::<Layers>().interactive() {
        return String::new();
    }
    let visible = VISIBLE.load(Ordering::Relaxed);
    let windows = app.webview_windows();
    let layer = windows.values().find(|w| {
        app.state::<Layers>().info(w.label()).is_some_and(|i| i.is_primary)
    });
    let hit = layer.is_some_and(|w| visible && match (
        w.cursor_position(), w.outer_position(), w.inner_size(), w.scale_factor(),
    ) {
        (Ok(pointer), Ok(pos), Ok(size), Ok(scale)) => {
            // Keep the shell's resize corner usable when it overlaps the envelope.
            let over_shell = app.get_webview_window(crate::app_window::APP_LABEL).is_some_and(|main| {
                if !main.is_visible().unwrap_or(false) || main.is_minimized().unwrap_or(false) {
                    return false;
                }
                match (main.outer_position(), main.outer_size()) {
                    (Ok(p), Ok(s)) => pointer.x >= p.x as f64
                        && pointer.x <= p.x as f64 + s.width as f64
                        && pointer.y >= p.y as f64
                        && pointer.y <= p.y as f64 + s.height as f64,
                    _ => false,
                }
            });
            let x = (pointer.x - pos.x as f64) / scale;
            let y = (pointer.y - pos.y as f64) / scale;
            let width = size.width as f64 / scale;
            let height = size.height as f64 / scale;
            !over_shell && x >= width - 26.0 - 190.0 && x <= width - 26.0
                && y >= height - 90.0 - 190.0 * 340.0 / 480.0 - 16.0 && y <= height - 90.0
        }
        _ => false,
    });
    let now = if hit { layer.unwrap().label() } else { "" };
    if hovered != now {
        if let Some(old) = windows.get(hovered) {
            set_hover_mode(old, crate::platform::LayerMode::Resting);
        }
        if hit {
            set_hover_mode(layer.unwrap(), crate::platform::LayerMode::Editing);
        }
    }
    now.to_owned()
}

fn set_hover_mode(window: &tauri::WebviewWindow, mode: crate::platform::LayerMode) {
    if let Err(e) = crate::platform::apply_layer_mode(window, mode) {
        eprintln!("[peta] arrival hover ({mode:?}) failed on {}: {e}", window.label());
    }
}
