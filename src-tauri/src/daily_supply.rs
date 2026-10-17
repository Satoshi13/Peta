//! Six-hour check for signed owner settings (the daily table, the announcement and, later, the shop), independent of whether
//! this Mac has added friends. One request per six hours covers all of them.
#[cfg(feature = "server")]
mod online {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use peta_core::{daily_tables, events, ownership::RefereeError, shop_pack, signed_config, Error, Result};
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
            let _ = check(&app, false);
        });
    }
    #[derive(Default, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CheckResult { pub new_packs: usize, pub changed: bool, pub retry_after: i64, pub problem: bool }
    pub fn cooldown(last: Option<i64>, now: i64, developer: bool) -> i64 {
        if developer { return 0; }
        last.filter(|t| *t <= now).map_or(0, |t| (60 - (now - t)).max(0))
    }
    fn reserve(db: &mut peta_core::Database, now: i64, manual: bool, developer: bool) -> Result<Option<i64>> {
        let key = if manual { "daily.manual_attempt" } else { "daily.table_attempt" };
        let last = db.setting(key)?.and_then(|s| s.parse().ok());
        if manual {
            let wait = cooldown(last, now, developer);
            if wait > 0 { return Ok(Some(wait)); }
            db.set_setting(key, &now.to_string())?;
        } else if !due(last, now) { return Ok(Some(0)); }
        db.set_setting("daily.table_attempt", &now.to_string())?;
        Ok(None)
    }
    pub fn manual(app: &tauri::AppHandle) -> Result<CheckResult> {
        if CHECKING.swap(true, Ordering::SeqCst) { return Err(Error::Invalid("A check is already in progress.".into())); }
        struct Reset;
        impl Drop for Reset { fn drop(&mut self) { CHECKING.store(false, Ordering::SeqCst); } }
        let _reset = Reset;
        check(app, true)
    }
    fn check(app: &tauri::AppHandle, manual: bool) -> Result<CheckResult> {
        let store = app.state::<crate::store::Store>();
        let now = chrono::Utc::now();
        let referee = {
            let mut lib = store.lock();
            if let Some(wait) = reserve(lib.db_mut(), now.timestamp(), manual, cfg!(feature="developer"))? {
                return Ok(CheckResult { retry_after: wait, ..Default::default() });
            }
            crate::referee::HttpReferee::new(lib.root())?
        };
        let result = fetch(&store, &referee, now)?;
        if result.changed { crate::today::announce(app); }
        Ok(result)
    }
    fn snapshot(db: &peta_core::Database) -> Result<Vec<Option<String>>> {
        ["daily.tables", "config.announcements", "config.shop", "shop.listed"].iter().map(|k| db.setting(k)).collect()
    }
    fn fetch(store: &crate::store::Store, referee: &crate::referee::HttpReferee, now: chrono::DateTime<chrono::Utc>) -> Result<CheckResult> {
        #[derive(serde::Deserialize)]
        struct Response {
            tables: Vec<String>,
            #[serde(default)]
            announcements: Option<Vec<String>>,
            #[serde(default)]
            shop: Option<Vec<String>>,
            /// Official shop packs on sale (docs/official-packs-howto.md). Absent from servers that predate them.
            #[serde(default, rename = "shopPacks")]
            shop_packs: Option<Vec<shop_pack::Listed>>,
        }
        // The prior signed cache is retained on network, JSON, signature or policy failure.
        // A server that predates /v1/config (404) still answers the daily table alone.
        let response: Response = match referee.request_max("GET", "/v1/config", None::<&()>, 256 * 1024) {
            Err(Error::Referee(RefereeError::Unknown)) => {
                referee.request_max("GET", "/v1/daily-table", None::<&()>, 64 * 1024)?
            }
            other => other?,
        };
        let mut lib = store.lock();
        let before = snapshot(lib.db())?;
        let mut problem = store_response(lib.db_mut(), &response.tables, now).is_err();
        if let Some(items) = &response.announcements { problem |= store_announcements(lib.db_mut(), items).is_err(); }
        if let Some(items) = &response.shop { problem |= store_shop(lib.db_mut(), items).is_err(); }
        let fetch = match &response.shop_packs {
            Some(list) => match shop_pack::replace_listing(lib.db_mut(), list) {
                Ok(_) => shop_pack::missing(lib.db(), list)?,
                Err(_) => { problem = true; Vec::new() }
            },
            None => Vec::new(),
        };
        let changed = before != snapshot(lib.db())?;
        drop(lib);
        let (new_packs, failed) = fetch_shop_packs(store, referee, &fetch);
        Ok(CheckResult { new_packs, changed: changed || new_packs > 0, problem: problem || failed, retry_after: 0 })
    }
    /// The file path inside a listed URL, only in the one shape the service gives (`/v1/shop-pack/<token>/<packId>/<version>`).
    /// The host is never used: every request goes to this Mac's own service address, signed.
    pub fn shop_pack_path(url: &str, listed: &shop_pack::Listed) -> Option<String> {
        let path = &url[url.find("/v1/shop-pack/")?..];
        let parts: Vec<&str> = path["/v1/shop-pack/".len()..].split('/').collect();
        let ok = parts.len() == 3
            && parts[0].len() == 64 && parts[0].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            && parts[1] == listed.pack_id && parts[2] == listed.version.to_string();
        ok.then(|| path.to_owned())
    }
    /// Fetch each new version and keep it only if it is the listed file and verifies with an official key. A failure skips
    /// that pack until the next check; nothing partial is kept.
    /// Returns whether any new version was kept.
    fn fetch_shop_packs(store: &crate::store::Store, referee: &crate::referee::HttpReferee, fetch: &[shop_pack::Listed]) -> (usize, bool) {
        let mut kept = 0;
        let mut failed = false;
        for listed in fetch {
            let Some(path) = listed.url.as_deref().and_then(|url| shop_pack_path(url, listed)) else { failed = true; continue };
            let Ok((200, bytes)) = referee.exchange_bulk("GET", &path, &[], "application/octet-stream", shop_pack::MAX_TOTAL + 1024 * 1024) else { failed = true; continue };
            let mut lib = store.lock();
            match shop_pack::store_listed(&mut lib, listed, &bytes) {
                Ok(shop_pack::Stored::New) => kept += 1,
                Ok(shop_pack::Stored::Already) => {},
                Err(error) => { failed = true; eprintln!("[peta] shop pack {} v{} was not kept: {error}", listed.pack_id, listed.version); },
            }
        }
        (kept, failed)
    }
    fn decode_all(items: &[String], max: usize) -> Result<Vec<events::Verified>> {
        if items.len() > max {
            return Err(Error::Invalid("Too many settings.".into()));
        }
        items
            .iter()
            .map(|s| {
                if s.len() > 8192 {
                    return Err(Error::Invalid("Setting is too large.".into()));
                }
                let bytes = STANDARD
                    .decode(s)
                    .map_err(|_| Error::Invalid("Setting could not be verified.".into()))?;
                events::decode(&bytes)
            })
            .collect()
    }
    /// A response with any unverifiable shop setting keeps the previous snapshot.
    pub fn store_shop(db: &mut peta_core::Database, items: &[String]) -> Result<()> {
        signed_config::replace_shop(db, &decode_all(items, signed_config::MAX_SHOP_CONFIGS)?)
    }
    /// A response with any unverifiable announcement keeps the previous snapshot.
    pub fn store_announcements(db: &mut peta_core::Database, items: &[String]) -> Result<()> {
        signed_config::replace(db, &decode_all(items, signed_config::MAX_ANNOUNCEMENTS)?)
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
        fn fake_response(status: u16, body: &str) -> (crate::referee::HttpReferee, std::thread::JoinHandle<()>) {
            use std::io::{Read, Write};
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap()); let body = body.to_owned();
            let join = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap(); let mut request = [0; 8192];
                let n = stream.read(&mut request).unwrap();
                assert!(String::from_utf8_lossy(&request[..n]).starts_with("GET /v1/config HTTP/1.1"));
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            (crate::referee::HttpReferee::with_url(ed25519_dalek::SigningKey::from_bytes(&[7;32]), url).unwrap(), join)
        }
        #[test]
        fn manual_refresh_hits_the_server_preserves_the_cache_and_refreshes_only_changes() {
            let dir = std::env::temp_dir().join(format!("peta-supply-{}", peta_core::ids::new_gift_id()));
            let store = crate::store::Store::for_test(peta_core::Library::open(&dir).unwrap());
            for changed in [true, false] {
                let (http, join) = fake_response(200, r#"{"tables":[],"announcements":[],"shop":[],"shopPacks":[]}"#);
                let r = fetch(&store, &http, chrono::Utc::now()).unwrap(); join.join().unwrap();
                assert_eq!(r.changed, changed); assert!(!r.problem); assert_eq!(r.new_packs, 0);
            }
            let (http, join) = fake_response(500, r#"{"error":"offline"}"#);
            let before = snapshot(store.lock().db()).unwrap();
            assert!(fetch(&store, &http, chrono::Utc::now()).is_err()); join.join().unwrap();
            assert_eq!(snapshot(store.lock().db()).unwrap(), before);
            let _ = std::fs::remove_dir_all(dir);
        }
        #[test]
        fn manual_beta_waits_a_minute_across_restarts_but_developer_never_waits() {
            let mut db = peta_core::Database::open_in_memory().unwrap();
            assert_eq!(reserve(&mut db, 100, true, false).unwrap(), None);
            assert_eq!(reserve(&mut db, 101, true, false).unwrap(), Some(59));
            assert_eq!(reserve(&mut db, 159, true, false).unwrap(), Some(1));
            assert_eq!(reserve(&mut db, 160, true, false).unwrap(), None);
            assert_eq!(reserve(&mut db, 161, true, true).unwrap(), None);
            assert_eq!(reserve(&mut db, 161, true, true).unwrap(), None);
            assert_eq!(reserve(&mut db, 162, false, false).unwrap(), Some(0));
            assert_eq!(cooldown(Some(200), 100, false), 0);
        }
        #[test]
        fn only_the_services_shop_pack_path_is_ever_fetched() {
            let token = "a".repeat(64);
            let listed = shop_pack::Listed { pack_id: "autumn".into(), version: 2, size: 1, sha256: "b".repeat(64), ends_at: None, url: None };
            assert_eq!(shop_pack_path(&format!("https://peta-api.example/v1/shop-pack/{token}/autumn/2"), &listed), Some(format!("/v1/shop-pack/{token}/autumn/2")));
            for bad in [format!("https://x/v1/shop-pack/{token}/winter/2"), format!("https://x/v1/shop-pack/{token}/autumn/3"), format!("https://x/v1/shop-pack/{}/autumn/2", "A".repeat(64)),
                format!("https://x/v1/shop-pack/{token}/autumn/2/../../stickers"), "https://x/v1/update/file/abc".into(), String::new()] {
                assert_eq!(shop_pack_path(&bad, &listed), None, "{bad}");
            }
        }
        #[test]
        fn check_interval_covers_restarts_and_clock_changes() {
            assert!(due(None, 0));
            assert!(!due(Some(100), 101));
            assert!(!due(Some(100), 100 + INTERVAL - 1));
            assert!(due(Some(100), 100 + INTERVAL));
            assert!(due(Some(200), 100));
        }
        #[test]
        fn unverifiable_announcements_keep_the_last_snapshot() {
            let mut db = peta_core::Database::open_in_memory().unwrap();
            db.set_setting("config.announcements", "[]").unwrap();
            assert!(store_announcements(&mut db, &["not-base64".into()]).is_err());
            assert!(store_announcements(&mut db, &vec![String::new(); 11]).is_err());
            assert_eq!(db.setting("config.announcements").unwrap().as_deref(), Some("[]"));
            store_announcements(&mut db, &[]).unwrap();
            db.set_setting("config.shop", "[]").unwrap();
            assert!(store_shop(&mut db, &["not-base64".into()]).is_err());
            assert_eq!(db.setting("config.shop").unwrap().as_deref(), Some("[]"));
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
/// The banner on Today: the newest live announcement this Mac hasn't closed. Builds without the server have none.
#[tauri::command]
pub fn announcement_current(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    #[cfg(feature = "server")]
    {
        use tauri::Manager;
        let store = app.state::<crate::store::Store>();
        let lib = store.lock();
        let notice = peta_core::signed_config::current_announcement(lib.db(), chrono::Utc::now());
        Ok(notice.map(|n| serde_json::json!({"id": n.id, "kind": n.kind, "text": n.text, "link": n.link.filter(|l| link_url(*l).is_some())})))
    }
    #[cfg(not(feature = "server"))]
    {
        let _ = app;
        Ok(None)
    }
}
#[tauri::command]
pub fn announcement_dismiss(app: tauri::AppHandle, id: String) -> Result<(), String> {
    #[cfg(feature = "server")]
    {
        use tauri::Manager;
        let store = app.state::<crate::store::Store>();
        let mut lib = store.lock();
        peta_core::signed_config::dismiss(lib.db_mut(), &id).map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "server"))]
    {
        let _ = (app, id);
        Ok(())
    }
}
/// The only places a banner may open. The server sends a choice, never an address.
#[cfg(feature = "server")]
fn link_url(link: peta_core::signed_config::NoticeLink) -> Option<&'static str> {
    use peta_core::signed_config::NoticeLink;
    match link {
        NoticeLink::Download => Some(if cfg!(feature = "developer") { "https://peta-download-dev.peta-api.workers.dev" } else { "https://peta-download-prod.peta-api.workers.dev" }),
        // The Peta Discord server's permanent invite (2026-10-16).
        NoticeLink::Discord => Some("https://discord.gg/ugQu2Hv7HX"),
    }
}
#[tauri::command]
pub async fn announcement_open(link: String) -> Result<(), String> {
    #[cfg(feature = "server")]
    {
        use peta_core::signed_config::NoticeLink;
        let link = match link.as_str() { "download" => NoticeLink::Download, "discord" => NoticeLink::Discord, _ => return Err("This link is not available.".into()) };
        let url = link_url(link).ok_or("This link is not available.")?;
        tauri::async_runtime::spawn_blocking(move || std::process::Command::new("/usr/bin/open").arg(url).status())
            .await
            .map_err(|_| "Peta couldn't open the link.".to_string())?
            .map_err(|_| "Peta couldn't open the link.".to_string())
            .and_then(|s| if s.success() { Ok(()) } else { Err("Peta couldn't open the link.".into()) })
    }
    #[cfg(not(feature = "server"))]
    {
        let _ = link;
        Err("This link is not available.".into())
    }
}
#[tauri::command]
pub fn daily_table_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let store = app.state::<crate::store::Store>();
    let lib = store.lock();
    Ok(
        serde_json::json!({"enabled":cfg!(feature="server"),"lastAttempt":lib.db().setting("daily.table_attempt").map_err(|e|e.to_string())?,"manualAttempt":lib.db().setting("daily.manual_attempt").map_err(|e|e.to_string())?,"problem":lib.db().setting("daily.table_error").map_err(|e|e.to_string())?}),
    )
}

/// Explicit settings refresh. Background and manual checks share one network gate.
#[tauri::command]
pub async fn supply_check(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(feature="server")]
    { tauri::async_runtime::spawn_blocking(move || online::manual(&app).and_then(|r| serde_json::to_value(r).map_err(|e| peta_core::Error::Invalid(e.to_string()))).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())? }
    #[cfg(not(feature="server"))]
    { let _ = app; Err("This edition works offline.".into()) }
}
