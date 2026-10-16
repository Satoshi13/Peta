//! Beta-only updater. The webview never receives package bytes, signing headers or download tokens.
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    version: String,
    ready: Option<String>,
}
fn status(app: &tauri::AppHandle, ready: Option<String>) -> Status {
    Status {
        enabled: cfg!(all(feature = "beta", not(feature = "developer"))),
        version: app.package_info().version.to_string(),
        ready,
    }
}
#[cfg(feature = "beta")]
mod beta {
    use super::*;
    use std::sync::Mutex;
    use tauri::{Emitter, Manager};
    use tauri_plugin_updater::{Update, UpdaterExt};
    pub const INTERVAL: i64 = 6 * 3600;
    #[derive(Default)]
    pub struct Pending {
        pub checking: bool,
        pub ready: Option<(Update, Vec<u8>)>,
    }
    #[derive(Default)]
    pub struct Updates(pub Mutex<Pending>);
    pub fn allowed_url(url: &tauri::Url, origin: &str) -> bool {
        let Ok(base) = tauri::Url::parse(origin) else {
            return false;
        };
        url.origin() == base.origin()
            && url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url
                .path()
                .strip_prefix("/v1/update/file/")
                .is_some_and(|s| {
                    s.len() == 64
                        && s.bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                })
    }
    pub async fn check(app: &tauri::AppHandle, manual: bool) -> Result<Status, String> {
        let state = app.state::<Updates>();
        {
            let mut pending = state.0.lock().unwrap();
            if pending.checking || pending.ready.is_some() {
                return Ok(status(
                    app,
                    pending.ready.as_ref().map(|(u, _)| u.version.clone()),
                ));
            }
            let store = app.state::<crate::store::Store>();
            let mut lib = store.lock();
            let now = chrono::Utc::now().timestamp();
            let last = lib
                .db()
                .setting("update.last_attempt")
                .ok()
                .flatten()
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(0);
            if !manual && now >= last && now - last < INTERVAL {
                return Ok(status(app, None));
            }
            lib.db_mut()
                .set_setting("update.last_attempt", &now.to_string())
                .map_err(|_| "Peta couldn't check for updates.")?;
            pending.checking = true;
        }
        let result = download(app).await;
        let mut pending = state.0.lock().unwrap();
        pending.checking = false;
        match result {
            Ok(Some(update)) => {
                let version = update.0.version.clone();
                pending.ready = Some(update);
                Ok(status(app, Some(version)))
            }
            Ok(None) => Ok(status(app, None)),
            Err(()) => Err("Peta couldn't check for updates. Please try again later.".into()),
        }
    }
    fn failed(stage: &str, error: tauri_plugin_updater::Error) {
        #[cfg(feature = "updater-test")]
        {
            use std::error::Error;
            match error {
                tauri_plugin_updater::Error::Reqwest(error) => {
                    let error = error.without_url();
                    eprintln!("[updater-test] {stage}: {error}");
                    let mut cause = error.source();
                    while let Some(next) = cause {
                        eprintln!("[updater-test] cause: {next}");
                        cause = next.source();
                    }
                }
                tauri_plugin_updater::Error::Io(error) => {
                    eprintln!("[updater-test] {stage}: IO {:?}: {error}", error.kind())
                }
                error => eprintln!(
                    "[updater-test] {stage}: {:?}",
                    std::mem::discriminant(&error)
                ),
            }
        }
        #[cfg(not(feature = "updater-test"))]
        let _ = (stage, error);
    }
    async fn download(app: &tauri::AppHandle) -> Result<Option<(Update, Vec<u8>)>, ()> {
        let (_, referee) = crate::invite::referee(app).map_err(|_| ())?;
        let origin = crate::referee::endpoint();
        let endpoint = tauri::Url::parse(&format!(
            "{origin}/v1/update?current={}",
            app.package_info().version
        ))
        .map_err(|_| ())?;
        let mut builder = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|_| ())?
            .timeout(std::time::Duration::from_secs(300))
            .configure_client(|client| client.redirect(reqwest::redirect::Policy::none()));
        for (name, value) in referee
            .signed_headers("GET", "/v1/update", &[])
            .map_err(|_| ())?
        {
            builder = builder.header(name, value).map_err(|_| ())?;
        }
        #[cfg(feature = "updater-test")]
        {
            let preflight = referee.exchange(
                "GET",
                &format!("/v1/update?current={}", app.package_info().version),
                &[],
                "application/json",
                64 * 1024,
            );
            eprintln!(
                "[updater-test] signed preflight status: {:?}",
                preflight
                    .as_ref()
                    .map(|(status, _)| *status)
                    .map_err(|_| "network")
            );
        }
        let Some(mut update) = builder
            .build()
            .map_err(|e| failed("build", e))?
            .check()
            .await
            .map_err(|e| failed("check", e))?
        else {
            return Ok(None);
        };
        if !allowed_url(&update.download_url, &origin) {
            return Err(());
        }
        // Upstream check timeout is not carried into the returned Update. Bound downloads too.
        update.timeout = Some(std::time::Duration::from_secs(300));
        update.headers.clear();
        for (name, value) in referee
            .signed_headers("GET", update.download_url.path(), &[])
            .map_err(|_| ())?
        {
            update.headers.insert(
                name.parse::<reqwest::header::HeaderName>()
                    .map_err(|_| ())?,
                value.parse().map_err(|_| ())?,
            );
        }
        // The plugin verifies both the minisign signature and its signed version before returning bytes.
        // Failure drops the allocation: no unverified file is left on disk or offered to the UI.
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|e| failed("download", e))?;
        Ok(Some((update, bytes)))
    }
    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        if crate::print::pending(app)?.is_some() {
            return Err("Finish printing before updating Peta.".into());
        }
        let state = app.state::<Updates>();
        let pending = state
            .0
            .lock()
            .unwrap()
            .ready
            .take()
            .ok_or("Check for updates again.")?;
        pending.0.install(&pending.1).map_err(|error| {
            failed("install", error);
            "Peta couldn't install this update. Please try again later."
        })?;
        let _ = app.emit("update-installing", ());
        app.restart();
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn download_origin_is_pinned() {
            let base = "https://peta-api-prod.peta-api.workers.dev";
            let path = format!("/v1/update/file/{}", "a".repeat(64));
            assert!(allowed_url(
                &tauri::Url::parse(&format!("{base}{path}")).unwrap(),
                base
            ));
            for s in [
                format!("https://evil.test{path}"),
                format!("{base}{path}?x=1"),
                format!("{base}{path}#x"),
                format!("https://user@peta-api-prod.peta-api.workers.dev{path}"),
                format!("{base}/v1/update/file/short"),
            ] {
                assert!(!allowed_url(&tauri::Url::parse(&s).unwrap(), base));
            }
        }
    }
}
#[cfg(feature = "beta")]
pub use beta::Updates;
#[tauri::command]
pub fn update_status(app: tauri::AppHandle) -> Status {
    #[cfg(feature = "beta")]
    {
        use tauri::Manager;
        return status(
            &app,
            app.state::<Updates>()
                .0
                .lock()
                .unwrap()
                .ready
                .as_ref()
                .map(|(u, _)| u.version.clone()),
        );
    }
    #[cfg(not(feature = "beta"))]
    status(&app, None)
}
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle, manual: bool) -> Result<Status, String> {
    #[cfg(feature = "beta")]
    {
        beta::check(&app, manual).await
    }
    #[cfg(not(feature = "beta"))]
    {
        let _ = manual;
        Ok(status(&app, None))
    }
}
#[tauri::command]
pub fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(feature = "beta")]
    {
        beta::install(&app)
    }
    #[cfg(not(feature = "beta"))]
    {
        let _ = app;
        Err("Updates are available in the private beta edition.".into())
    }
}
#[cfg(all(test, feature = "beta"))]
#[path = "updater_tests.rs"]
mod protocol_tests;
