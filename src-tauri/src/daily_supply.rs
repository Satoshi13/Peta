//! Six-hour supply check, independent of whether this Mac has added friends.
#[cfg(feature = "server")]
mod online {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use peta_core::{daily_tables, events, Error, Result};
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Manager;
    static CHECKING: AtomicBool = AtomicBool::new(false);
    const INTERVAL: i64 = 6 * 3600;
    pub fn due(last: Option<i64>, now: i64) -> bool {
        last.is_none_or(|t| now < t || now - t >= INTERVAL)
    }
    pub fn kickoff(app: &tauri::AppHandle) {
        if CHECKING.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            struct Reset;
            impl Drop for Reset {
                fn drop(&mut self) {
                    CHECKING.store(false, Ordering::SeqCst);
                }
            }
            let _reset = Reset;
            let _ = check(&app);
        });
    }
    fn check(app: &tauri::AppHandle) -> Result<()> {
        let store = app.state::<crate::store::Store>();
        let now = chrono::Utc::now();
        let referee = {
            let mut lib = store.lock();
            let last = lib
                .db()
                .setting("daily.table_attempt")?
                .and_then(|s| s.parse().ok());
            if !due(last, now.timestamp()) {
                return Ok(());
            }
            lib.db_mut()
                .set_setting("daily.table_attempt", &now.timestamp().to_string())?;
            crate::referee::HttpReferee::new(lib.root())?
        };
        #[derive(serde::Deserialize)]
        struct Response {
            tables: Vec<String>,
        }
        // The prior signed cache is retained on network, JSON, signature or policy failure.
        let response: Response =
            referee.request_max("GET", "/v1/daily-table", None::<&()>, 64 * 1024)?;
        let result = store_response(store.lock().db_mut(), &response.tables, now);
        result
    }
    pub fn store_response(
        db: &mut peta_core::Database,
        tables: &[String],
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let parsed = (|| {
            if tables.len() > 11 {
                return Err(Error::Invalid("Too many daily tables.".into()));
            }
            tables
                .iter()
                .map(|s| {
                    if s.len() > 8192 {
                        return Err(Error::Invalid("Daily table is too large.".into()));
                    }
                    let bytes = STANDARD
                        .decode(s)
                        .map_err(|_| Error::Invalid("Daily table could not be verified.".into()))?;
                    events::decode(&bytes)
                })
                .collect::<Result<Vec<_>>>()
        })();
        match parsed {
            Ok(tables) => daily_tables::replace(db, &tables, now),
            Err(error) => {
                db.set_setting(
                    "daily.table_error",
                    "Daily supply signature could not be verified.",
                )?;
                Err(error)
            }
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn check_interval_covers_restarts_and_clock_changes() {
            assert!(due(None, 0));
            assert!(!due(Some(100), 101));
            assert!(!due(Some(100), 100 + INTERVAL - 1));
            assert!(due(Some(100), 100 + INTERVAL));
            assert!(due(Some(200), 100));
        }
        #[test]
        fn invalid_snapshots_keep_the_last_verified_cache_and_empty_clears_it() {
            let mut db = peta_core::Database::open_in_memory().unwrap();
            db.set_setting("daily.tables", "old verified cache")
                .unwrap();
            assert!(store_response(&mut db, &["not-base64".into()], chrono::Utc::now()).is_err());
            assert_eq!(
                db.setting("daily.tables").unwrap().as_deref(),
                Some("old verified cache")
            );
            store_response(&mut db, &[], chrono::Utc::now()).unwrap();
            assert_eq!(db.setting("daily.tables").unwrap().as_deref(), Some("[]"));
        }
    }
}
pub fn kickoff(app: &tauri::AppHandle) {
    #[cfg(feature = "server")]
    online::kickoff(app);
    #[cfg(not(feature = "server"))]
    let _ = app;
}
#[tauri::command]
pub fn daily_table_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let store = app.state::<crate::store::Store>();
    let lib = store.lock();
    Ok(
        serde_json::json!({"enabled":cfg!(feature="server"),"lastAttempt":lib.db().setting("daily.table_attempt").map_err(|e|e.to_string())?,"problem":lib.db().setting("daily.table_error").map_err(|e|e.to_string())?}),
    )
}
