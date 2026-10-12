//! One sleeping worker; no timer or Wi-Fi reads when all rules are off.
use crate::{boards, layers::Layers, store::Store};
use peta_core::board_auto::WifiObservation;
use std::{
    collections::HashSet,
    sync::{Condvar, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
#[derive(Default)]
struct Control {
    pending: bool,
    stopped: bool,
    rearm: HashSet<String>,
}
#[derive(Default)]
pub struct Auto {
    control: Mutex<Control>,
    wake: Condvar,
    notes: Mutex<Vec<String>>,
}
pub fn signal(app: &AppHandle, rearm: Option<&str>) {
    let Some(state) = app.try_state::<Auto>() else {
        return;
    };
    let mut c = state.control.lock().unwrap();
    c.pending = true;
    if let Some(id) = rearm {
        c.rearm.insert(id.into());
    }
    state.wake.notify_one();
}
pub fn start(app: &AppHandle) {
    native::observe_wake(app);
    signal(app, None);
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<Auto>();
        let mut latches = HashSet::new();
        let mut enabled = false;
        loop {
            let mut c = state.control.lock().unwrap();
            while !c.pending && !c.stopped {
                if enabled {
                    let (next, timeout) =
                        state.wake.wait_timeout(c, Duration::from_secs(60)).unwrap();
                    c = next;
                    if timeout.timed_out() {
                        break;
                    }
                } else {
                    c = state.wake.wait(c).unwrap();
                }
            }
            if c.stopped {
                break;
            }
            c.pending = false;
            for id in c.rearm.drain() {
                latches.remove(&id);
            }
            drop(c);
            let rules = match app.state::<Store>().lock().db().board_rules() {
                Ok(r) => r,
                Err(_) => continue,
            };
            enabled = rules.iter().any(|r| r.enabled);
            if !enabled {
                latches.clear();
                continue;
            }
            let wifi = if rules.iter().any(|r| r.enabled && r.kind == "place") {
                native::wifi()
            } else {
                native::Wifi::Unavailable
            };
            let observation = match &wifi {
                native::Wifi::Unavailable => WifiObservation::Unavailable,
                native::Wifi::Disconnected => WifiObservation::Disconnected,
                native::Wifi::Connected(s) => WifiObservation::Connected(s),
            };
            let result = {
                let layers = app.state::<Layers>();
                let _topology = layers.topology_guard();
                let ids = layers
                    .snapshot()
                    .0
                    .into_iter()
                    .map(|d| d.id)
                    .collect::<Vec<_>>();
                app.state::<Store>().lock().db_mut().board_auto(
                    chrono::Local::now().naive_local(),
                    observation,
                    &ids,
                    &latches,
                )
            };
            if let Ok(result) = result {
                latches = result.place_latches;
                if !result.applied.is_empty() {
                    let displays = app.state::<Layers>().snapshot().0;
                    let mut notes = state.notes.lock().unwrap();
                    for applied in result.applied {
                        let screen = displays
                            .iter()
                            .find(|d| d.id == applied.rule.display_id)
                            .map(|d| d.name.as_str())
                            .unwrap_or(&applied.rule.display_id);
                        // Only the configured name is used here, never the observed SSID.
                        let when = if applied.rule.kind == "time" {
                            let m = applied.rule.start_min.unwrap();
                            format!("It's {}:{:02}", m / 60, m % 60)
                        } else {
                            applied.rule.wifi.unwrap_or_default()
                        };
                        let skipped = if applied.result.skipped.is_empty() {
                            String::new()
                        } else {
                            format!(" · {} skipped", applied.result.skipped.len())
                        };
                        notes.push(format!(
                            "{when} — put “{}” on {screen}{skipped}",
                            applied.board_name
                        ));
                    }
                    drop(notes);
                    boards::announce(&app);
                }
            }
        }
    });
}
pub fn stop(app: &AppHandle) {
    if let Some(s) = app.try_state::<Auto>() {
        s.control.lock().unwrap().stopped = true;
        s.wake.notify_one();
    }
    native::stop();
}
#[derive(serde::Serialize)]
pub struct Location {
    pub status: &'static str,
    pub prompted: bool,
}
pub fn location(app: &AppHandle) -> Location {
    let prompted = app
        .state::<Store>()
        .lock()
        .db()
        .board_location_prompted()
        .unwrap_or(false);
    Location {
        status: native::authorization(),
        prompted,
    }
}
#[tauri::command]
pub async fn boards_location_request(app: AppHandle) -> Result<Location, String> {
    // The only caller is Continue in the first Place explanation.
    let (send, receive) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let first = handle
            .state::<Store>()
            .lock()
            .db_mut()
            .board_location_mark_prompted()
            .map_err(|e| e.to_string());
        let result = first.map(|first| {
            if first {
                native::request(&handle);
            }
        });
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .recv()
        .map_err(|_| "Could not request location access.".to_string())??;
    Ok(location(&app))
}
#[tauri::command]
pub async fn boards_take_notes(app: AppHandle) -> Vec<String> {
    std::mem::take(&mut *app.state::<Auto>().notes.lock().unwrap())
}

mod native {
    use super::*;
    use objc2::{
        class, define_class, msg_send,
        rc::Retained,
        runtime::{AnyObject, Bool, ProtocolObject},
        sel, DefinedClass, MainThreadMarker, MainThreadOnly,
    };
    use objc2_core_location::{CLLocationManager, CLLocationManagerDelegate};
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol, NSString,
    };
    use std::cell::RefCell;
    #[link(name = "CoreWLAN", kind = "framework")]
    extern "C" {}
    pub enum Wifi {
        Unavailable,
        Disconnected,
        Connected(String),
    }
    pub fn authorization() -> &'static str {
        let enabled: Bool =
            unsafe { msg_send![class!(CLLocationManager), locationServicesEnabled] };
        if !enabled.as_bool() {
            return "off";
        }
        let status: i32 = unsafe { msg_send![class!(CLLocationManager), authorizationStatus] };
        match status {
            3 | 4 => "on",
            0 => "unknown",
            _ => "off",
        }
    }
    pub fn wifi() -> Wifi {
        if authorization() != "on" {
            return Wifi::Unavailable;
        }
        objc2::rc::autoreleasepool(|_| unsafe {
            let client: *mut AnyObject = msg_send![class!(CWWiFiClient), sharedWiFiClient];
            if client.is_null() {
                return Wifi::Unavailable;
            }
            let interface: *mut AnyObject = msg_send![client, interface];
            if interface.is_null() {
                return Wifi::Unavailable;
            }
            let ssid: *mut NSString = msg_send![interface, ssid];
            if ssid.is_null() {
                Wifi::Disconnected
            } else {
                Wifi::Connected((&*ssid).to_string())
            }
        })
    }
    struct Ivars {
        app: AppHandle,
    }
    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind=MainThreadOnly]
        #[name="PetaBoardsObserver"]
        #[ivars=Ivars]
        struct Observer;
        unsafe impl NSObjectProtocol for Observer {}
        unsafe impl CLLocationManagerDelegate for Observer {
            #[unsafe(method(locationManagerDidChangeAuthorization:))]
            fn changed(&self,_manager:&CLLocationManager){
                signal(&self.ivars().app,None);let _=self.ivars().app.emit("boards-location-changed",());
            }
        }
        impl Observer {
            #[unsafe(method(petaDidWake:))]
            fn woke(&self,_notification:&NSNotification){signal(&self.ivars().app,None);}
        }
    );
    struct Held {
        observer: Retained<Observer>,
        center: Retained<NSNotificationCenter>,
        manager: Option<Retained<CLLocationManager>>,
    }
    thread_local! {static HELD:RefCell<Option<Held>>=const{RefCell::new(None)};}
    pub fn observe_wake(app: &AppHandle) {
        let mtm = MainThreadMarker::new().expect("Auto observer must start on the main thread");
        let observer: Retained<Observer> = unsafe {
            msg_send![
                super(Observer::alloc(mtm).set_ivars(Ivars { app: app.clone() })),
                init
            ]
        };
        let workspace: *mut AnyObject = unsafe { msg_send![class!(NSWorkspace), sharedWorkspace] };
        let center: Retained<NSNotificationCenter> =
            unsafe { msg_send![workspace, notificationCenter] };
        unsafe {
            center.addObserver_selector_name_object(
                &observer,
                sel!(petaDidWake:),
                Some(&NSString::from_str("NSWorkspaceDidWakeNotification")),
                None,
            );
        }
        let manager = unsafe { CLLocationManager::new() };
        unsafe {
            manager.setDelegate(Some(ProtocolObject::from_ref(&*observer)));
        }
        HELD.with(|h| {
            *h.borrow_mut() = Some(Held {
                observer,
                center,
                manager: Some(manager),
            })
        });
    }
    pub fn request(_app: &AppHandle) {
        let _mtm = MainThreadMarker::new()
            .expect("Location permission must be requested on the main thread");
        HELD.with(|h| {
            let mut h = h.borrow_mut();
            let Some(held) = h.as_mut() else { return };
            if held.manager.is_none() {
                let manager = unsafe { CLLocationManager::new() };
                unsafe {
                    manager.setDelegate(Some(ProtocolObject::from_ref(&*held.observer)));
                }
                held.manager = Some(manager);
            }
            let status: i32 = unsafe { msg_send![class!(CLLocationManager), authorizationStatus] };
            if status == 0 {
                unsafe {
                    held.manager
                        .as_ref()
                        .unwrap()
                        .requestWhenInUseAuthorization();
                }
            }
        });
    }
    pub fn stop() {
        let _mtm = MainThreadMarker::new().expect("Auto observer must stop on the main thread");
        HELD.with(|h| {
            if let Some(held) = h.borrow_mut().take() {
                unsafe {
                    held.center.removeObserver(&held.observer);
                    if let Some(m) = held.manager {
                        m.setDelegate(None);
                    }
                }
            }
        });
    }
}
