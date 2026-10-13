//! Local OS links wait here until the app frontend is ready. Receiving a link never sends a request.
use std::{collections::VecDeque, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Default)]
pub struct PendingLinks(Mutex<VecDeque<String>>);
impl PendingLinks {
    fn enqueue(&self, url: &Url) -> bool {
        if url.scheme() != crate::inbox::SCHEME || url.host_str() != Some("friend") || url.as_str().len() > 2048 { return false; }
        let mut links = self.0.lock().unwrap();
        if links.iter().any(|s| s == url.as_str()) { return false; }
        if links.len() >= 32 { return false; }
        links.push_back(url.to_string()); true
    }
    fn take(&self) -> Option<String> { self.0.lock().unwrap().pop_front() }
}
fn receive(app: &AppHandle, urls: Vec<Url>) {
    let added = urls.iter().fold(false, |added, url| app.state::<PendingLinks>().enqueue(url) || added);
    if !added { return; }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        // Do not emit app-page here: navigation belongs to the ready frontend consumer.
        if let Some(w) = handle.get_webview_window(crate::app_window::APP_LABEL) {
            crate::platform::activate_app();
            let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus();
            let _ = w.emit("friend-link-pending", ());
        } else { let _ = crate::app_window::open(&handle, "settings"); }
    });
}
pub fn start(app: &AppHandle) {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| receive(&handle, event.urls()));
    // The same queue collapses a cold URL delivered by both get_current and the event.
    if let Ok(Some(urls)) = app.deep_link().get_current() { receive(app, urls); }
}
#[tauri::command]
pub fn friend_link_take(window: tauri::WebviewWindow, app: AppHandle) -> Result<Option<String>, String> {
    if window.label() != crate::app_window::APP_LABEL { return Err("Friend links belong to the app window.".into()); }
    Ok(app.state::<PendingLinks>().take())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cold_and_warm_links_wait_until_taken_once() {
        let queue = PendingLinks::default();
        let url = Url::parse(&format!("{}://friend/first", crate::inbox::SCHEME)).unwrap();
        assert!(queue.enqueue(&url)); assert!(!queue.enqueue(&url));
        assert_eq!(queue.take().as_deref(), Some(url.as_str())); assert_eq!(queue.take(), None);
        let warm = Url::parse(&format!("{}://friend/second", crate::inbox::SCHEME)).unwrap();
        assert!(queue.enqueue(&warm)); assert_eq!(queue.take().as_deref(), Some(warm.as_str()));
        assert!(queue.enqueue(&url), "a later explicit opening of the same link still works");
    }
    #[test]
    fn only_this_builds_friend_scheme_reaches_the_dialog() {
        let queue = PendingLinks::default();
        let other = if cfg!(feature="developer") { "peta" } else { "peta-developer" };
        for url in [format!("{other}://friend/x"), "https://friend/x".into(), format!("{}://other/x", crate::inbox::SCHEME), "file:///tmp/photo.png".into()] {
            assert!(!queue.enqueue(&Url::parse(&url).unwrap()));
        }
        assert_eq!(queue.take(), None);
        assert!(queue.enqueue(&Url::parse(&format!("{}://friend/!damaged", crate::inbox::SCHEME)).unwrap()), "damaged payloads reach the preview's error message");
    }
}
