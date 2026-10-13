//! Select the feature-gated referee in one place. The default binary contains no HTTP client.
use peta_core::{Library, Result};
#[cfg(feature = "server")]
pub fn active(lib: &mut Library) -> Result<crate::referee::HttpReferee> {
    peta_core::server::migrate(lib)?;
    let r = crate::referee::HttpReferee::new(lib.root())?;
    Ok(r)
}
#[cfg(not(feature = "server"))]
pub fn active(_: &mut Library) -> Result<peta_core::ownership::NoReferee> {
    Ok(peta_core::ownership::NoReferee)
}
#[cfg(feature = "server")]
static SYNCING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn kickoff(app: &tauri::AppHandle) {
    #[cfg(feature = "server")]
    {
        use std::sync::atomic::Ordering;
        use tauri::{Emitter, Manager};
        if !app.state::<crate::store::Store>().lock().db().friends_anyone().unwrap_or(false) { return; }
        if SYNCING.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let store = app.state::<crate::store::Store>();
            let result = sync_pass(&store, 4);
            SYNCING.store(false, Ordering::SeqCst);
            let event = if result.is_ok() {
                "referee-synced"
            } else {
                "referee-sync-failed"
            };
            let _ = app.emit(event, result.err().map(|e| e.to_string()));
        });
    }
    #[cfg(not(feature = "server"))]
    let _ = app;
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    url: Option<String>,
    last_contact: Option<i64>,
    pending: peta_core::server::Counts,
}
#[tauri::command]
pub async fn referee_status(app: tauri::AppHandle) -> std::result::Result<Diagnostics, String> {
    if !cfg!(feature = "server") {
        return Err("Server checks are disabled in this edition.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let store = app.state::<crate::store::Store>();
        let lib = store.lock();
        #[cfg(feature = "server")]
        let (url, last_contact) = (
            Some(crate::referee::endpoint()),
            crate::referee::last_contact(),
        );
        #[cfg(not(feature = "server"))]
        let (url, last_contact) = (None, None);
        Ok(Diagnostics {
            url,
            last_contact,
            pending: peta_core::server::counts(lib.db()).map_err(|e| e.to_string())?,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn referee_sync(app: tauri::AppHandle) -> std::result::Result<(), String> {
    if !cfg!(feature = "server") {
        return Err("Server checks are disabled in this edition.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::{Emitter, Manager};
        let store = app.state::<crate::store::Store>();
        sync_pass(&store, 60).map_err(|e| e.to_string())?;
        let _ = app.emit("referee-synced", ());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(feature = "server")]
fn sync_pass(store: &crate::store::Store, limit: u32) -> Result<()> {
    let (referee, work) = {
        let mut lib = store.lock();
        let referee = active(&mut lib)?;
        let work = peta_core::server::pending_work(lib.db_mut(), limit)?;
        (referee, work)
    };
    let mut first = None;
    for job in work {
        let result = job.run(&referee); // No Library mutex is held during HTTP.
        let offline = matches!(
            &result,
            Err(peta_core::Error::Referee(
                peta_core::ownership::RefereeError::Offline
            ))
        );
        let result = {
            let mut lib = store.lock();
            let result = peta_core::server::reconcile_work(lib.db_mut(), &job, &referee, result);
            peta_core::server::finish_work(lib.db_mut(), &job, result)
        };
        if let Err(e) = result {
            if first.is_none() {
                first = Some(e);
            }
        }
        if offline {
            break;
        }
    }
    first.map_or(Ok(()), Err)
}
#[cfg(not(feature = "server"))]
fn sync_pass(_: &crate::store::Store, _: u32) -> Result<()> {
    Ok(())
}

/// Operation preflight makes a bounded recovery pass before acquiring the operation lock.
pub fn before_operation(app: &tauri::AppHandle) {
    #[cfg(feature = "server")]
    {
        use tauri::{Emitter, Manager};
        let result = sync_pass(&app.state::<crate::store::Store>(), 4);
        if let Err(e) = result {
            let _ = app.emit("referee-sync-failed", e.to_string());
        }
    }
    #[cfg(not(feature = "server"))]
    let _ = app;
}
