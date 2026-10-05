//! Runs the production arrival watcher against a fake event loop, without GTK or macOS.
//! Native operations assert thread affinity; notification hover must never raise a sticker layer.
extern crate self as tauri;
pub use tauri_test_macros::command;
use std::{collections::HashMap, sync::{Arc, Mutex, mpsc, atomic::{AtomicBool, Ordering}}, thread::{self, ThreadId}, time::Duration};
type Task = Box<dyn FnOnce() + Send>;
#[derive(Clone)]
pub struct AppHandle {
    queue: mpsc::Sender<Task>,
    windows: Arc<Mutex<HashMap<String, WebviewWindow>>>,
    layers: Arc<layers::Layers>,
    arrival: Arc<arrival::Arrival>,
    date: Arc<Mutex<String>>,
    fail_open: Arc<AtomicBool>,
    gift_token: Arc<Mutex<Option<String>>>,
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
        let state: Arc<dyn std::any::Any + Send + Sync> = if std::any::TypeId::of::<T>() == std::any::TypeId::of::<arrival::Arrival>() {
            self.arrival.clone()
        } else { self.layers.clone() };
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
impl Emitter for WebviewWindow { fn emit<T>(&self, _: &str, _: T) -> Result<(), String> { self.assert_main(); Ok(()) } }
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
    label: String, main: ThreadId, pointer: Arc<Mutex<Point>>, position: Arc<Mutex<Point>>, size: Size,
    registry: std::sync::Weak<Mutex<HashMap<String, WebviewWindow>>>,
    clicks: Arc<Mutex<Vec<(String, bool)>>>,
    modes: Arc<Mutex<Vec<(String, platform::LayerMode)>>>,
    reads: Arc<Mutex<Vec<ThreadId>>>,
}
impl WebviewWindow {
    fn assert_main(&self) { assert_eq!(thread::current().id(), self.main, "native window operation off main thread"); }
    fn record_read(&self) { self.reads.lock().unwrap().push(thread::current().id()); }
    pub fn label(&self) -> &str { &self.label }
    pub fn cursor_position(&self) -> Result<Point, String> { self.record_read(); Ok(*self.pointer.lock().unwrap()) }
    pub fn outer_position(&self) -> Result<Point, String> { self.record_read(); Ok(*self.position.lock().unwrap()) }
    pub fn inner_size(&self) -> Result<Size, String> { self.record_read(); Ok(self.size) }
    pub fn outer_size(&self) -> Result<Size, String> { self.inner_size() }
    pub fn set_position(&self, position: LogicalPosition) -> Result<(), String> {
        self.assert_main(); *self.position.lock().unwrap() = Point { x: position.x * 2.0, y: position.y * 2.0 }; Ok(())
    }
    pub fn set_ignore_cursor_events(&self, ignore: bool) -> Result<(), String> {
        self.assert_main(); self.clicks.lock().unwrap().push((self.label.clone(), ignore)); Ok(())
    }
    pub fn show(&self) -> Result<(), String> { self.assert_main(); Ok(()) }
    pub fn destroy(&self) -> Result<(), String> {
        self.assert_main(); self.registry.upgrade().unwrap().lock().unwrap().remove(&self.label); Ok(())
    }
    pub fn scale_factor(&self) -> Result<f64, String> { self.record_read(); Ok(2.0) }
    pub fn is_visible(&self) -> Result<bool, String> { self.record_read(); Ok(true) }
    pub fn is_minimized(&self) -> Result<bool, String> { self.record_read(); Ok(false) }
}
pub struct LogicalPosition { x: f64, y: f64 }
impl LogicalPosition { pub fn new(x: f64, y: f64) -> Self { Self { x, y } } }
pub enum WebviewUrl { App(std::path::PathBuf) }
pub struct WebviewWindowBuilder { app: AppHandle, label: String, x: f64, y: f64, width: f64, height: f64 }
macro_rules! builder_bool {
    ($($method:ident),*) => { $(pub fn $method(self, _: bool) -> Self { self })* };
}
impl WebviewWindowBuilder {
    pub fn new(app: &AppHandle, label: &str, url: WebviewUrl) -> Self {
        let WebviewUrl::App(path) = url; assert_eq!(path.to_str(), Some("arrival.html"));
        Self { app: app.clone(), label: label.into(), x: 0.0, y: 0.0, width: 0.0, height: 0.0 }
    }
    pub fn title(self, _: &str) -> Self { self }
    builder_bool!(decorations, transparent, shadow, resizable, skip_taskbar, focused, accept_first_mouse, visible);
    pub fn position(mut self, x: f64, y: f64) -> Self { self.x = x; self.y = y; self }
    pub fn inner_size(mut self, width: f64, height: f64) -> Self { self.width = width; self.height = height; self }
    pub fn build(self) -> Result<WebviewWindow, String> {
        let mut window = self.app.webview_windows().into_values().find(|w| w.label.starts_with("layer-")).unwrap();
        window.assert_main();
        window.label = self.label;
        window.position = Arc::new(Mutex::new(Point { x: self.x * 2.0, y: self.y * 2.0 }));
        window.size = Size { width: (self.width * 2.0) as u32, height: (self.height * 2.0) as u32 };
        window.registry = Arc::downgrade(&self.app.windows);
        self.app.windows.lock().unwrap().insert(window.label.clone(), window.clone());
        Ok(window)
    }
}
#[path = "../src-tauri/src/arrival_window.rs"]
mod arrival_window;

mod platform {
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    #[allow(dead_code)]
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
mod gifts { pub fn arrival_token(app: &super::AppHandle) -> Option<String> { app.gift_token.lock().unwrap().clone() } }
mod today {
    pub struct Status { pub date: String, pub material_opened: bool, pub bonus_envelopes: usize }
    pub fn status(app: &super::AppHandle) -> Result<Status, String> {
        Ok(Status { date: app.date.lock().unwrap().clone(), material_opened: app.material_opened.load(super::Ordering::Relaxed), bonus_envelopes: 0 })
    }
}
mod app_window {
    pub const APP_LABEL: &str = "peta-app";
    pub fn open(app: &super::AppHandle, _: &str) -> Result<(), String> { if app.fail_open.load(super::Ordering::Relaxed) { Err("open failed".into()) } else { Ok(()) } }
}
#[path = "../src-tauri/src/arrival.rs"]
#[allow(dead_code)]
mod arrival;

#[test]
fn hover_keeps_stickers_below_icons_and_dispatches_native_operations_to_main_thread() {
    use platform::LayerMode::Editing;
    let (queue, tasks) = mpsc::channel::<Task>();
    let main = thread::current().id();
    let pointer = Arc::new(Mutex::new(Point { x: 2700.0, y: 1500.0 }));
    let modes = Arc::new(Mutex::new(Vec::new()));
    let clicks = Arc::new(Mutex::new(Vec::new()));
    let reads = Arc::new(Mutex::new(Vec::new()));
    let layer = WebviewWindow {
        label: "layer-1-0".into(), main, pointer: pointer.clone(),
        position: Arc::new(Mutex::new(Point { x: 0.0, y: 0.0 })), size: Size { width: 2880, height: 1800 },
        modes: modes.clone(), clicks: clicks.clone(), reads: reads.clone(), registry: Default::default(),
    };
    let app = AppHandle {
        queue, windows: Arc::new(Mutex::new(HashMap::from([(layer.label.clone(), layer.clone())]))),
        layers: Arc::new(layers::Layers::default()), arrival: Arc::new(arrival::Arrival::default()),
        date: Arc::new(Mutex::new("2026-10-06".into())), fail_open: Arc::new(AtomicBool::new(false)), gift_token: Arc::new(Mutex::new(None)), material_opened: Arc::new(AtomicBool::new(false)),
        stopped: Arc::new(AtomicBool::new(false)),
    };
    arrival::sync(&app);
    arrival::spawn_hit_watcher(app.clone());
    let tick = || tasks.recv_timeout(Duration::from_secs(2)).expect("watcher must dispatch a main-thread task")();
    let receives_clicks = || { assert_eq!(clicks.lock().unwrap().last().unwrap(), &(arrival_window::LABEL.into(), false)); };
    let passes_clicks = || { assert_eq!(clicks.lock().unwrap().last().unwrap(), &(arrival_window::LABEL.into(), true)); };
    tick();
    assert_eq!(*modes.lock().unwrap(), vec![(arrival_window::LABEL.into(), Editing)], "only the envelope may be raised");
    receives_clicks();
    let notification = app.get_webview_window(arrival_window::LABEL).unwrap();
    assert_eq!(notification.size.width, 500, "envelope-only viewport at 2x Retina");
    assert_eq!(notification.outer_position().unwrap().x, 2380.0);

    let before = clicks.lock().unwrap().len();
    tick();
    assert_eq!(clicks.lock().unwrap().len(), before, "hover must not repeatedly apply native state");
    *pointer.lock().unwrap() = Point { x: 0.0, y: 0.0 };
    tick(); passes_clicks();
    *pointer.lock().unwrap() = Point { x: 2700.0, y: 1500.0 };
    tick(); receives_clicks();

    let pending = tasks.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(tasks.recv_timeout(Duration::from_millis(120)).is_err(), "stale tasks accumulated");
    app.layers.interactive.store(true, Ordering::Relaxed);
    pending(); passes_clicks();
    tick(); passes_clicks();
    app.layers.interactive.store(false, Ordering::Relaxed);
    tick(); receives_clicks();

    // A rebuilt display moves the envelope but does not raise the replacement sticker layer.
    let pending = tasks.recv_timeout(Duration::from_secs(2)).unwrap();
    let mut replacement = layer.clone(); replacement.label = "layer-2-0".into();
    replacement.size = Size { width: 3840, height: 2160 };
    { let mut windows = app.windows.lock().unwrap(); windows.remove(layer.label()); windows.insert(replacement.label.clone(), replacement); }
    *pointer.lock().unwrap() = Point { x: 3650.0, y: 1850.0 };
    pending(); receives_clicks();
    assert_eq!(app.get_webview_window(arrival_window::LABEL).unwrap().outer_position().unwrap().x, 3340.0);

    let mut shell = layer.clone(); shell.label = app_window::APP_LABEL.into();
    shell.size = Size { width: 3840, height: 2160 };
    app.windows.lock().unwrap().insert(shell.label.clone(), shell);
    tick(); passes_clicks();
    app.windows.lock().unwrap().remove(app_window::APP_LABEL);
    tick(); receives_clicks();
    // A failed open keeps the notice. A successful open dismisses without opening the material.
    app.fail_open.store(true, Ordering::Relaxed);
    assert!(arrival::arrival_open(app.clone()).is_err());
    assert_eq!(arrival::arrival_status(app.clone()).as_deref(), Some("material"));
    app.fail_open.store(false, Ordering::Relaxed);
    assert!(arrival::arrival_open(app.clone()).is_ok());
    assert!(arrival::arrival_status(app.clone()).is_none());
    assert!(!app.material_opened.load(Ordering::Relaxed));
    tick(); passes_clicks();
    assert!(app.get_webview_window(arrival_window::LABEL).is_some(), "exit animation needs time to finish");
    for _ in 0..15 { tick(); if app.get_webview_window(arrival_window::LABEL).is_none() { break; } }
    assert!(app.get_webview_window(arrival_window::LABEL).is_none());
    arrival::sync(&app);
    tick();
    assert!(app.get_webview_window(arrival_window::LABEL).is_none(), "same-day refresh must not resurrect a dismissed notice");
    if cfg!(feature="developer") {
        app.material_opened.store(true, Ordering::Relaxed);
        assert!(arrival::developer_show_arrival(app.clone()).is_ok());
        tick(); receives_clicks();
        arrival::developer_show_arrival(app.clone()).unwrap();
        tick();
        assert_eq!(app.webview_windows().keys().filter(|label| label.as_str()==arrival_window::LABEL).count(), 1);
        assert!(arrival::arrival_status(app.clone()).is_some());
        assert!(arrival::arrival_open(app.clone()).is_ok());
        assert!(arrival::arrival_status(app.clone()).is_none(), "preview is consumed once");
        assert!(app.material_opened.load(Ordering::Relaxed), "preview must not reset today");
    } else {
        assert!(arrival::developer_show_arrival(app.clone()).is_err());
        assert!(arrival::arrival_status(app.clone()).is_none());
    }
    app.material_opened.store(false, Ordering::Relaxed);
    *app.date.lock().unwrap() = "2026-10-07".into();
    arrival::sync(&app);
    assert!(arrival::arrival_status(app.clone()).is_some(), "next day gets a new notice");
    *app.gift_token.lock().unwrap() = Some("gift:first".into());
    arrival::sync(&app);
    assert_eq!(arrival::arrival_status(app.clone()).as_deref(), Some("gift"));
    arrival::arrival_open(app.clone()).unwrap();
    arrival::sync(&app);
    assert!(arrival::arrival_status(app.clone()).is_none());
    *app.gift_token.lock().unwrap() = Some("gift:new".into());
    arrival::sync(&app);
    assert_eq!(arrival::arrival_status(app.clone()).as_deref(), Some("gift"), "new gifts must get a fresh notice");

    assert!(modes.lock().unwrap().iter().all(|(label,mode)| label == arrival_window::LABEL && *mode == Editing), "hover must never raise any sticker layer");
    assert!(clicks.lock().unwrap().iter().all(|(label, _)| label == arrival_window::LABEL), "click-through on stickers must be untouched");
    assert!(reads.lock().unwrap().iter().all(|id| *id == main), "window reads must also use the main thread");
    app.stopped.store(true, Ordering::Relaxed);
}
