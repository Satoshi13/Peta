//! Runs the production arrival watcher against a fake event loop, without GTK or macOS.
//! Native mode changes assert thread affinity; this reproduces the original off-thread calls.
extern crate self as tauri;
pub use tauri_test_macros::command;
use std::{collections::HashMap, sync::{Arc, Mutex, mpsc, atomic::{AtomicBool, Ordering}}, thread::{self, ThreadId}, time::Duration};
type Task = Box<dyn FnOnce() + Send>;
#[derive(Clone)]
pub struct AppHandle {
    queue: mpsc::Sender<Task>,
    windows: Arc<Mutex<HashMap<String, WebviewWindow>>>,
    layers: Arc<layers::Layers>,
    material_opened: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
}
pub trait Manager {
    fn state<T: Send + Sync + 'static>(&self) -> Arc<T>;
    fn webview_windows(&self) -> HashMap<String, WebviewWindow>;
    fn get_webview_window(&self, label: &str) -> Option<WebviewWindow>;
}
impl Manager for AppHandle {
    fn state<T: Send + Sync + 'static>(&self) -> Arc<T> {
        let state: Arc<dyn std::any::Any + Send + Sync> = self.layers.clone();
        state.downcast().ok().unwrap()
    }
    fn webview_windows(&self) -> HashMap<String, WebviewWindow> {
        self.windows.lock().unwrap().clone()
    }
    fn get_webview_window(&self, label: &str) -> Option<WebviewWindow> {
        self.webview_windows().get(label).cloned()
    }
}
pub trait Emitter { fn emit<T>(&self, _: &str, _: T) -> Result<(), String> { Ok(()) } }
impl Emitter for AppHandle {}
impl AppHandle {
    pub fn run_on_main_thread(&self, task: impl FnOnce() + Send + 'static) -> Result<(), String> {
        if self.stopped.load(Ordering::Relaxed) { return Err("stopped".into()); }
        self.queue.send(Box::new(task)).map_err(|e| e.to_string())
    }
}
#[derive(Clone, Copy)]
pub struct Point { pub x: f64, pub y: f64 }
#[derive(Clone, Copy)]
pub struct Size { pub width: u32, pub height: u32 }
#[derive(Clone)]
pub struct WebviewWindow {
    label: String, main: ThreadId, pointer: Arc<Mutex<Point>>, position: Point, size: Size,
    modes: Arc<Mutex<Vec<(String, platform::LayerMode)>>>,
    reads: Arc<Mutex<Vec<ThreadId>>>,
}
impl WebviewWindow {
    fn assert_main(&self) { assert_eq!(thread::current().id(), self.main, "native window operation off main thread"); }
    fn record_read(&self) { self.reads.lock().unwrap().push(thread::current().id()); }
    pub fn label(&self) -> &str { &self.label }
    pub fn cursor_position(&self) -> Result<Point, String> { self.record_read(); Ok(*self.pointer.lock().unwrap()) }
    pub fn outer_position(&self) -> Result<Point, String> { self.record_read(); Ok(self.position) }
    pub fn inner_size(&self) -> Result<Size, String> { self.record_read(); Ok(self.size) }
    pub fn outer_size(&self) -> Result<Size, String> { self.inner_size() }
    pub fn scale_factor(&self) -> Result<f64, String> { self.record_read(); Ok(2.0) }
    pub fn is_visible(&self) -> Result<bool, String> { self.record_read(); Ok(true) }
    pub fn is_minimized(&self) -> Result<bool, String> { self.record_read(); Ok(false) }
}
mod platform {
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum LayerMode { Resting, Editing }
    pub fn apply_layer_mode(window: &super::WebviewWindow, mode: LayerMode) -> Result<(), String> {
        window.assert_main();
        window.modes.lock().unwrap().push((window.label.clone(), mode));
        Ok(())
    }
}
mod layers {
    use super::*;
    pub struct LayerInfo { pub is_primary: bool }
    #[derive(Default)]
    pub struct Layers { pub interactive: AtomicBool }
    impl Layers {
        pub fn interactive(&self) -> bool { self.interactive.load(Ordering::Relaxed) }
        pub fn info(&self, label: &str) -> Option<LayerInfo> {
            label.starts_with("layer-").then_some(LayerInfo { is_primary: true })
        }
    }
}
mod gifts { pub fn unopened_count(_: &super::AppHandle) -> usize { 0 } }
mod today {
    pub struct Status { pub material_opened: bool, pub bonus_envelopes: usize }
    pub fn status(app: &super::AppHandle) -> Result<Status, String> {
        Ok(Status { material_opened: app.material_opened.load(super::Ordering::Relaxed), bonus_envelopes: 0 })
    }
}
mod app_window {
    pub const APP_LABEL: &str = "peta-app";
    pub fn open(_: &super::AppHandle, _: &str) -> Result<(), String> { Ok(()) }
}
#[path = "../src-tauri/src/arrival.rs"]
#[allow(dead_code)]
mod arrival;

#[test]
fn hover_reads_and_modes_stay_on_main_thread_with_current_window_and_mode() {
    use platform::LayerMode::{Editing, Resting};
    let (queue, tasks) = mpsc::channel::<Task>();
    let main = thread::current().id();
    let pointer = Arc::new(Mutex::new(Point { x: 2700.0, y: 1500.0 }));
    let modes = Arc::new(Mutex::new(Vec::new()));
    let reads = Arc::new(Mutex::new(Vec::new()));
    let layer = WebviewWindow {
        label: "layer-1-0".into(), main, pointer: pointer.clone(),
        position: Point { x: 0.0, y: 0.0 }, size: Size { width: 2880, height: 1800 }, modes: modes.clone(), reads: reads.clone(),
    };
    let app = AppHandle {
        queue, windows: Arc::new(Mutex::new(HashMap::from([(layer.label.clone(), layer.clone())]))),
        layers: Arc::new(layers::Layers::default()), material_opened: Arc::new(AtomicBool::new(false)),
        stopped: Arc::new(AtomicBool::new(false)),
    };
    arrival::sync(&app);
    arrival::spawn_hit_watcher(app.clone());
    let tick = || tasks.recv_timeout(Duration::from_secs(2)).expect("watcher must dispatch a main-thread task")();
    tick();
    assert_eq!(*modes.lock().unwrap(), vec![("layer-1-0".into(), Editing)]);
    *pointer.lock().unwrap() = Point { x: 0.0, y: 0.0 };
    tick();
    assert_eq!(modes.lock().unwrap().last().unwrap().1, Resting);
    modes.lock().unwrap().clear();

    // Retina physical coordinates land inside the bottom-right logical envelope.
    *pointer.lock().unwrap() = Point { x: 2700.0, y: 1500.0 };
    tick();
    assert_eq!(*modes.lock().unwrap(), vec![("layer-1-0".into(), Editing)]);
    tick();
    assert_eq!(modes.lock().unwrap().len(), 1, "remaining hovered must not reapply the mode");
    *pointer.lock().unwrap() = Point { x: 0.0, y: 0.0 };
    tick();
    assert_eq!(modes.lock().unwrap().last().unwrap().1, Resting);

    // A busy main thread may have at most one pending tick; mode changes win before it runs.
    let pending = tasks.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(tasks.recv_timeout(Duration::from_millis(120)).is_err(), "stale tasks accumulated");
    app.layers.interactive.store(true, Ordering::Relaxed);
    *pointer.lock().unwrap() = Point { x: 2700.0, y: 1500.0 };
    let before = modes.lock().unwrap().len();
    pending();
    tick();
    assert_eq!(modes.lock().unwrap().len(), before, "hover must not override Print/Edit");
    app.layers.interactive.store(false, Ordering::Relaxed);
    tick();
    assert_eq!(modes.lock().unwrap().last().unwrap().1, Editing);

    // Read the latest rebuilt layer in the dispatched task, never a stale NSWindow handle.
    let pending = tasks.recv_timeout(Duration::from_secs(2)).unwrap();
    let mut replacement = layer.clone(); replacement.label = "layer-2-0".into();
    *app.windows.lock().unwrap() = HashMap::from([(replacement.label.clone(), replacement)]);
    pending();
    assert_eq!(modes.lock().unwrap().last().unwrap(), &("layer-2-0".into(), Editing));

    // A shell over the envelope and a disappeared notification both release click interception.
    let mut shell = layer.clone(); shell.label = app_window::APP_LABEL.into();
    app.windows.lock().unwrap().insert(shell.label.clone(), shell);
    tick();
    assert_eq!(modes.lock().unwrap().last().unwrap().1, Resting);
    app.windows.lock().unwrap().remove(app_window::APP_LABEL);
    tick();
    assert_eq!(modes.lock().unwrap().last().unwrap().1, Editing);
    app.material_opened.store(true, Ordering::Relaxed);
    arrival::sync(&app);
    tick();
    assert_eq!(modes.lock().unwrap().last().unwrap().1, Resting);
    assert!(reads.lock().unwrap().iter().all(|id| *id == main), "window reads must also use the main thread");
    app.stopped.store(true, Ordering::Relaxed);
}
