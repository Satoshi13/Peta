//! Friends and the Gift inbox (server S2). Gifts and requests are sealed on this Mac to the friend's sealing key before they leave,
//! so the server only carries boxes it cannot open. A gift that arrives goes through exactly the same checks as a gift file
//! (signature, Gift v3 claim with the referee, PNG and size). Peta never talks to the inbox until there is a friend or a mailbox.
//! Everything that touches the network is in `net`, compiled only with the `server` feature; the commands answer "unavailable" without it.
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::store::Store;
use peta_core::{friends::Friend, identity};

/// Friend links: the developer edition has its own scheme, so the two apps never take each other's links.
pub const SCHEME: &str = if cfg!(feature = "developer") { "peta-developer" } else { "peta" };
#[cfg(not(feature = "server"))]
const UNAVAILABLE: &str = "Friends need Peta's server, which this build does not include yet.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxStatus {
    pub enabled: bool,
    pub my_code: String,
    pub my_link: String,
    pub my_fingerprint: String,
    pub friends: Vec<Friend>,
    pub auto: bool,
    pub last_check: Option<String>,
    pub backed_up: bool,
    pub registered: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview { pub name: String, pub fingerprint: String, pub sign_key: String, pub status: String }

fn me(app: &AppHandle) -> Result<(std::path::PathBuf, identity::FriendCode), String> {
    let store = app.state::<Store>();
    let lib = store.lock();
    let root = lib.root().to_owned();
    let code = identity::code_here(&root, &lib.db().display_name().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok((root, code))
}

#[tauri::command]
pub async fn inbox_status(app: AppHandle) -> Result<InboxStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, code) = me(&app)?;
        let store = app.state::<Store>();
        let lib = store.lock();
        let db = lib.db();
        let value = |k: &str| db.inbox_value(k).map_err(|e| e.to_string());
        Ok(InboxStatus {
            enabled: cfg!(feature = "server"),
            my_code: code.to_code().map_err(|e| e.to_string())?,
            my_link: code.to_link(SCHEME).map_err(|e| e.to_string())?,
            my_fingerprint: code.fingerprint().map_err(|e| e.to_string())?,
            friends: db.friends().map_err(|e| e.to_string())?,
            auto: value("auto")?.as_deref() != Some("off"),
            last_check: value("last_check")?,
            backed_up: value("backed_up")?.is_some(),
            registered: value("registered")?.is_some(),
        })
    }).await.map_err(|e| e.to_string())?
}

/// What a pasted code or link is, before anything is sent.
#[tauri::command]
pub async fn friend_preview(app: AppHandle, code: String) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = identity::FriendCode::parse_for_scheme(&code, SCHEME).map_err(|e| e.to_string())?;
        let (_, mine) = me(&app)?;
        let store = app.state::<Store>();
        let existing = store.lock().db().friend(&parsed.sign_key).map_err(|e| e.to_string())?;
        let status = if parsed.sign_key == mine.sign_key { "self".into() } else { existing.map(|f| f.status).unwrap_or_else(|| "new".into()) };
        Ok(Preview { fingerprint: parsed.fingerprint().map_err(|e| e.to_string())?, name: parsed.name, sign_key: parsed.sign_key, status })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn inbox_set_auto(app: AppHandle, auto: bool) -> Result<(), String> {
    app.state::<Store>().lock().db_mut().set_inbox_value("auto", (!auto).then_some("off")).map_err(|e| e.to_string())
}

/// Save both keys under a passphrase (`.petakey`). Cancelling the dialog changes nothing.
#[tauri::command]
pub async fn identity_export(window: tauri::WebviewWindow, app: AppHandle, passphrase: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if passphrase.chars().count() < identity::PASSPHRASE_MIN { return Err("Use a passphrase of at least 12 characters.".into()); }
    let Some(path) = app.dialog().file().set_parent(&window).add_filter("Peta key backup", &["petakey"]).set_file_name("Peta key.petakey").blocking_save_file().and_then(|p| p.into_path().ok()) else { return Ok(false) };
    tauri::async_runtime::spawn_blocking(move || {
        let (root, _) = me(&app)?;
        let bytes = identity::export_here(&root, &passphrase).map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| format!("Could not save the backup: {e}"))?;
        app.state::<Store>().lock().db_mut().set_inbox_value("backed_up", Some(&peta_core::events::current_time().to_rfc3339())).map_err(|e| e.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

/// Replace this Mac's keys with a backup (moving to a new Mac). The page confirms before calling.
#[tauri::command]
pub async fn identity_import(app: AppHandle, passphrase: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(path) = app.dialog().file().add_filter("Peta key backup", &["petakey"]).blocking_pick_file().and_then(|p| p.into_path().ok()) else { return Ok(false) };
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("Could not read the backup: {e}"))?;
        let store = app.state::<Store>();
        let mut lib = store.lock();
        let root = lib.root().to_owned();
        identity::read_backup(&bytes, &passphrase).map_err(|e| e.to_string())?;
        identity::restore(&root, &bytes, &passphrase).map_err(|e| e.to_string())?;
        // Same keys, same mailbox: register again on the next check (the server keeps the address).
        lib.db_mut().set_inbox_value("registered", None).map_err(|e| e.to_string())?;
        lib.db_mut().set_inbox_value("backed_up", Some(&peta_core::events::current_time().to_rfc3339())).map_err(|e| e.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

macro_rules! server_command {
    ($(#[$doc:meta])* $name:ident ( $($arg:ident : $ty:ty),* ) -> $out:ty => $body:path) => {
        $(#[$doc])*
        #[tauri::command]
        pub async fn $name(app: AppHandle $(, $arg: $ty)*) -> Result<$out, String> {
            #[cfg(feature = "server")]
            { tauri::async_runtime::spawn_blocking(move || $body(&app $(, $arg)*)).await.map_err(|e| e.to_string())? }
            #[cfg(not(feature = "server"))]
            { let _ = (&app $(, &$arg)*); Err(UNAVAILABLE.into()) }
        }
    };
}
server_command!(/// Copying my code or link means I want friends: make my mailbox so a request can reach me.
    friend_code_copied() -> () => net::register);
server_command!(/// Paste a code or link and ask to be friends.
    friend_add(code: String, note: Option<String>) -> Friend => net::add);
server_command!(friend_approve(key: String) -> () => net::approve);
server_command!(friend_decline(key: String) -> () => net::decline);
server_command!(friend_block(key: String) -> () => net::block);
server_command!(friend_unblock(key: String) -> () => net::unblock);
server_command!(friend_remove(key: String) -> () => net::remove);
server_command!(/// Look for requests, acceptances and gifts now. `manual` skips the one-minute spacing.
    inbox_check(manual: bool) -> Checked => net::check);
server_command!(/// Give a real sticker to a friend through the inbox.
    gift_send_friend(sticker_id: String, to_key: String, note: Option<String>, dress: Option<peta_core::gift::GiftDress>) -> () => net::send);
server_command!(/// Send a received gift to Peta's owner, with consent.
    inbox_report(gift_id: String, reason: String) -> () => net::report);
server_command!(/// Remove this Mac's mailbox, lists and waiting gifts from the server.
    inbox_leave() -> () => net::leave);

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Checked { pub gifts: u32, pub requests: u32, pub accepted: u32, pub discarded: u32, pub skipped: bool }

/// Every few minutes while Peta runs, and once soon after launch.
pub fn start(app: &AppHandle) {
    #[cfg(feature = "server")]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(8));
            loop {
                net::tick(&app);
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
        });
    }
    #[cfg(not(feature = "server"))]
    let _ = app;
}

#[cfg(feature = "server")]
mod net {
    use super::*;
    use crate::referee::HttpReferee;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use peta_core::{gift, ownership::RefereeError, Error};
    use std::sync::{atomic::{AtomicI64, Ordering}, Mutex};
    use tauri::Emitter;

    static LAST_PASS: AtomicI64 = AtomicI64::new(0);
    static RUNNING: Mutex<()> = Mutex::new(());
    const AUTO_EVERY: i64 = 15 * 60;

    fn now() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) }
    fn text(e: Error) -> String { e.to_string() }
    fn key_hash(key_b64: &str) -> Result<String, String> { identity::key_hash(key_b64).map_err(text) }
    fn random_id() -> String {
        let mut bytes = [0u8; 16];
        let _ = getrandom::fill(&mut bytes);
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }
    fn client(app: &AppHandle) -> Result<HttpReferee, String> { HttpReferee::new(app.state::<Store>().lock().root()).map_err(text) }
    fn json<T: serde::de::DeserializeOwned>(c: &HttpReferee, method: &str, path: &str, body: Option<serde_json::Value>) -> Result<T, Error> { c.request(method, path, body.as_ref()) }
    fn done(c: &HttpReferee, method: &str, path: &str, body: Option<serde_json::Value>) -> Result<(), Error> { json::<serde_json::Value>(c, method, path, body).map(|_| ()) }
    /// Short English for what the server said no to.
    fn say(e: Error, who: &str) -> String {
        match e {
            Error::Referee(RefereeError::Rejected(code)) => match code.as_str() {
                "not_allowed" => format!("{who} hasn't accepted you yet."),
                "blocked" => format!("{who} isn't taking requests or gifts from you."),
                "mailbox_full" => format!("{who}'s inbox is full for now. Try again later."),
                "slow_down" => "That's a lot at once. Try again in a minute.".into(),
                "clock_skew" => "Check your Mac's date and time, then try again.".into(),
                _ => Error::Referee(RefereeError::Rejected(code)).to_string(),
            },
            Error::Referee(RefereeError::Unknown) => format!("{who} needs to open Settings → Friends once before you can add them."),
            other => other.to_string(),
        }
    }

    /// Make (or refresh) my mailbox with my current code.
    pub fn register(app: &AppHandle) -> Result<(), String> {
        let (_, code) = me(app)?;
        let c = client(app)?;
        done(&c, "POST", "/v1/mailbox", Some(serde_json::json!({"signKey": code.sign_key, "encKey": code.enc_key, "name": code.name, "binding": code.binding}))).map_err(|e| say(e, "Peta"))?;
        app.state::<Store>().lock().db_mut().set_inbox_value("registered", Some(&peta_core::events::current_time().to_rfc3339())).map_err(text)
    }
    fn ensure_registered(app: &AppHandle) -> Result<(), String> {
        if app.state::<Store>().lock().db().inbox_value("registered").map_err(text)?.is_none() { register(app)?; }
        Ok(())
    }
    fn allow(app: &AppHandle, field: &str, key: &str) -> Result<(), String> {
        let (_, mine) = me(app)?;
        let id = identity::mailbox_id(&mine.sign_key).map_err(text)?;
        done(&client(app)?, "PUT", &format!("/v1/mailbox/{id}/allow"), Some(serde_json::json!({ field: [key_hash(key)?] }))).map_err(|e| say(e, "Peta"))
    }

    pub fn add(app: &AppHandle, code: String, note: Option<String>) -> Result<Friend, String> {
        let theirs = identity::FriendCode::parse_for_scheme(&code, SCHEME).map_err(text)?;
        let (_, mine) = me(app)?;
        if theirs.sign_key == mine.sign_key { return Err("That is your own friend code.".into()); }
        if app.state::<Store>().lock().db().friend(&theirs.sign_key).map_err(text)?.is_some_and(|f| f.status == "blocked") {
            return Err("You blocked this person. Unblock them first.".into());
        }
        ensure_registered(app)?;
        let note: Option<String> = note.map(|n| n.trim().chars().take(80).collect()).filter(|n: &String| !n.is_empty());
        let sealed = identity::seal(&theirs.enc_key, identity::REQUEST, &serde_json::to_vec(&serde_json::json!({"code": mine.to_code().map_err(text)?, "note": note})).map_err(|e| e.to_string())?).map_err(text)?;
        let request_id = random_id();
        let to = identity::mailbox_id(&theirs.sign_key).map_err(text)?;
        done(&client(app)?, "POST", &format!("/v1/mailbox/{to}/requests/{request_id}"), Some(serde_json::json!({"sealed": STANDARD.encode(sealed)}))).map_err(|e| say(e, &theirs.name))?;
        let changed = {
            let store = app.state::<Store>();
            let mut lib = store.lock();
            lib.db_mut().friend_request_sent(&mine.sign_key, &theirs, &request_id).map_err(text)?
        };
        if changed { allow(app, "add", &theirs.sign_key)?; }   // I asked them, so their gifts may reach me
        let _ = app.emit("inbox-changed", ());
        app.state::<Store>().lock().db().friend(&theirs.sign_key).map_err(text)?.ok_or_else(|| "The friend could not be saved.".into())
    }
    pub fn approve(app: &AppHandle, key: String) -> Result<(), String> {
        allow(app, "add", &key)?;
        app.state::<Store>().lock().db_mut().friend_approve(&key).map_err(text)?;
        let _ = app.emit("inbox-changed", ()); Ok(())
    }
    pub fn decline(app: &AppHandle, key: String) -> Result<(), String> {
        app.state::<Store>().lock().db_mut().friend_decline(&key).map_err(text)?;
        let _ = app.emit("inbox-changed", ()); Ok(())
    }
    pub fn block(app: &AppHandle, key: String) -> Result<(), String> {
        allow(app, "block", &key)?;
        app.state::<Store>().lock().db_mut().friend_block(&key).map_err(text)?;
        let _ = app.emit("inbox-changed", ()); Ok(())
    }
    pub fn unblock(app: &AppHandle, key: String) -> Result<(), String> {
        allow(app, "unblock", &key)?;
        app.state::<Store>().lock().db_mut().friend_unblock(&key).map_err(text)?;
        let _ = app.emit("inbox-changed", ()); Ok(())
    }
    pub fn remove(app: &AppHandle, key: String) -> Result<(), String> {
        allow(app, "remove", &key)?;
        app.state::<Store>().lock().db_mut().friend_remove(&key).map_err(text)?;
        let _ = app.emit("inbox-changed", ()); Ok(())
    }

    /// The background clock: every 15 minutes while friends exist and Check for gifts is Automatically.
    pub fn tick(app: &AppHandle) {
        let due = {
            let store = app.state::<Store>();
            let lib = store.lock();
            let db = lib.db();
            let auto = db.inbox_value("auto").ok().flatten().as_deref() != Some("off");
            auto && (db.friends_anyone().unwrap_or(false) || db.inbox_value("registered").ok().flatten().is_some())
        };
        if due && now() - LAST_PASS.load(Ordering::Relaxed) >= AUTO_EVERY { let _ = check(app, false); }
    }

    #[derive(serde::Deserialize)]
    struct Request { id: String, #[serde(rename = "senderHash")] sender_hash: String, sealed: String }
    #[derive(serde::Deserialize)]
    struct Message { id: String, #[serde(rename = "senderHash")] sender_hash: String }
    #[derive(serde::Deserialize)]
    struct Sealed { code: String, note: Option<String> }

    pub fn check(app: &AppHandle, manual: bool) -> Result<Checked, String> {
        let Ok(_one) = RUNNING.try_lock() else { return Ok(Checked { skipped: true, ..Checked::default() }) };
        if !manual && now() - LAST_PASS.load(Ordering::Relaxed) < 60 { return Ok(Checked { skipped: true, ..Checked::default() }); }
        let (talk, registered) = {
            let store = app.state::<Store>();
            let lib = store.lock();
            (lib.db().friends_anyone().map_err(text)?, lib.db().inbox_value("registered").map_err(text)?.is_some())
        };
        if !talk && !registered { return Ok(Checked { skipped: true, ..Checked::default() }); }   // no friends, no mailbox: never talk
        LAST_PASS.store(now(), Ordering::Relaxed);
        ensure_registered(app)?;
        let (root, mine) = me(app)?;
        let c = client(app)?;
        let box_id = identity::mailbox_id(&mine.sign_key).map_err(text)?;
        let mut out = Checked::default();

        // 1. Requests waiting for me.
        #[derive(serde::Deserialize)] struct Requests { requests: Vec<Request> }
        let requests: Requests = json(&c, "GET", &format!("/v1/mailbox/{box_id}/requests"), None).map_err(|e| say(e, "Peta"))?;
        for r in requests.requests {
            let opened = STANDARD.decode(&r.sealed).ok()
                .and_then(|bytes| identity::open(&root, identity::REQUEST, &bytes).ok())
                .and_then(|plain| serde_json::from_slice::<Sealed>(&plain).ok())
                .and_then(|s| identity::FriendCode::parse(&s.code).ok().map(|code| (code, s.note)))
                .filter(|(code, _)| key_hash(&code.sign_key).ok().as_deref() == Some(r.sender_hash.as_str()));   // the code must be the sender's own
            if let Some((code, note)) = opened {
                let what = app.state::<Store>().lock().db_mut().friend_request_received(&mine.sign_key, &code, note.as_deref(), &r.id).map_err(text)?;
                if what == "pending" { out.requests += 1; }
                if what == "friend" { out.accepted += 1; }
            } else { out.discarded += 1; }
            let _ = done(&c, "DELETE", &format!("/v1/mailbox/{box_id}/requests/{}", r.id), None);
        }

        // 2. Have the people I asked accepted me?
        let friends = app.state::<Store>().lock().db().friends().map_err(text)?;
        for f in friends.iter().filter(|f| f.status == "requested") {
            #[derive(serde::Deserialize)] struct Allowed { allowed: bool }
            let id = identity::mailbox_id(&f.public_key).map_err(text)?;
            if let Ok(Allowed { allowed: true }) = json::<Allowed>(&c, "GET", &format!("/v1/mailbox/{id}/allowed"), None) {
                app.state::<Store>().lock().db_mut().friend_accepted(&f.public_key).map_err(text)?;
                out.accepted += 1;
            }
        }

        // 3. Gifts. Each one is opened here and then received exactly like a gift file.
        #[derive(serde::Deserialize)] struct Messages { messages: Vec<Message> }
        let messages: Messages = json(&c, "GET", &format!("/v1/mailbox/{box_id}/messages"), None).map_err(|e| say(e, "Peta"))?;
        let friends = app.state::<Store>().lock().db().friends().map_err(text)?;
        for m in messages.messages {
            let path = format!("/v1/mailbox/{box_id}/messages/{}", m.id);
            if app.state::<Store>().lock().db().inbox_seen(&m.id).map_err(text)? { let _ = done(&c, "DELETE", &path, None); continue; }
            let sender = friends.iter().find(|f| f.status == "friend" && f.allowed && key_hash(&f.public_key).ok().as_deref() == Some(m.sender_hash.as_str()));
            let Some(sender) = sender else { out.discarded += 1; let _ = done(&c, "DELETE", &path, None); continue; };
            let (status, sealed) = c.exchange("GET", &path, &[], "application/json", identity_limit()).map_err(text)?;
            if !(200..300).contains(&status) { continue; }
            let Ok(plain) = identity::open(&root, identity::GIFT, &sealed) else { out.discarded += 1; let _ = done(&c, "DELETE", &path, None); continue; };
            let signed_by = gift::decode_gift(&plain).ok().and_then(|d| match d.header.signer { Some(peta_core::sign::Signer::Device { public_key }) => Some(public_key), _ => None });
            if signed_by.as_deref() != Some(sender.public_key.as_str()) { out.discarded += 1; let _ = done(&c, "DELETE", &path, None); continue; }
            let result = {
                let store = app.state::<Store>();
                let mut lib = store.lock();
                let referee = crate::referee_access::active(&mut lib).map_err(text)?;
                gift::receive_gift_with_referee(&mut lib, &plain, &referee)
            };
            match result {
                Ok(_) | Err(Error::GiftAlreadyReceived) => { out.gifts += u32::from(result.is_ok()); }
                Err(Error::Referee(RefereeError::Offline)) => continue,   // try again next time; the gift waits on the server
                Err(_) => { out.discarded += 1; }
            }
            app.state::<Store>().lock().db_mut().mark_inbox_seen(&m.id, Some(&sender.public_key)).map_err(text)?;
            let _ = done(&c, "DELETE", &path, None);
        }
        app.state::<Store>().lock().db_mut().set_inbox_value("last_check", Some(&peta_core::events::current_time().to_rfc3339())).map_err(text)?;
        if out.gifts > 0 { crate::today::announce(app); }
        let _ = app.emit("inbox-changed", &out);
        Ok(out)
    }
    fn identity_limit() -> usize { 8 * 1024 * 1024 + 4096 }

    /// Release (the referee) and upload commit together: a failed upload or save takes the release back inside `transfer_gift`,
    /// and a gift already uploaded is taken back from the friend's inbox.
    pub fn send(app: &AppHandle, sticker_id: String, to_key: String, note: Option<String>, dress: Option<gift::GiftDress>) -> Result<(), String> {
        let friend = app.state::<Store>().lock().db().friend(&to_key).map_err(text)?.filter(|f| f.status == "friend").ok_or("Choose a friend who has accepted you.")?;
        let enc = friend.enc_key.clone().ok_or("This friend's code is missing its sealing key. Ask them for their code again.")?;
        let to = identity::mailbox_id(&friend.public_key).map_err(text)?;
        let message_id = random_id();
        let path = format!("/v1/mailbox/{to}/messages/{message_id}");
        crate::referee_access::before_operation(app);
        let c = client(app)?;
        let mut uploaded = false;
        let result = {
            let store = app.state::<Store>();
            let mut lib = store.lock();
            let referee = crate::referee_access::active(&mut lib).map_err(text)?;
            gift::transfer_gift(&mut lib, &sticker_id, &friend.name, note.as_deref(), &dress.unwrap_or_default(), &referee, |bytes| {
                let sealed = identity::seal(&enc, identity::GIFT, bytes)?;
                let (status, body) = c.exchange("POST", &path, &sealed, "application/octet-stream", 64 * 1024)?;
                if !(200..300).contains(&status) { return Err(HttpReferee::refused(status, &body)); }
                uploaded = true; Ok(())
            })
        };
        if let Err(e) = result {
            if uploaded { let _ = done(&c, "DELETE", &path, None); }
            return Err(say(e, &friend.name));
        }
        let _ = app.emit("sticker-updated", &sticker_id);
        let _ = app.emit("link-tags-changed", ());
        crate::today::announce(app);
        let _ = crate::layers::sync(app);
        Ok(())
    }

    pub fn report(app: &AppHandle, gift_id: String, reason: String) -> Result<(), String> {
        let (bytes, sender) = {
            let store = app.state::<Store>();
            let lib = store.lock();
            let rel = lib.db().gift_package_path(&gift_id).map_err(text)?.ok_or("That gift is not here any more.")?;
            (lib.read_asset(&rel).map_err(text)?, lib.db().gift_signer_key(&gift_id).map_err(text)?.ok_or("This gift has no sender Peta can name.")?)
        };
        let reason: String = reason.trim().chars().take(200).collect();
        if reason.is_empty() { return Err("Choose a reason.".into()); }
        done(&client(app)?, "POST", "/v1/report", Some(serde_json::json!({"senderHash": key_hash(&sender)?, "reason": reason, "gift": STANDARD.encode(bytes)}))).map_err(|e| say(e, "Peta"))
    }

    pub fn leave(app: &AppHandle) -> Result<(), String> {
        let (_, mine) = me(app)?;
        let id = identity::mailbox_id(&mine.sign_key).map_err(text)?;
        match done(&client(app)?, "DELETE", &format!("/v1/mailbox/{id}"), None) {
            Ok(()) | Err(Error::Referee(RefereeError::Unknown)) => {}
            Err(e) => return Err(say(e, "Peta")),
        }
        app.state::<Store>().lock().db_mut().inbox_forget().map_err(text)?;
        let _ = app.emit("inbox-changed", ()); Ok(())
    }
}

/// A live round trip against the dev Worker with two libraries (A and B): mailboxes, a request, approval, a sealed gift.
/// Run explicitly: `cargo test --features developer -p peta inbox_live -- --ignored`.
#[cfg(all(test, feature = "server"))]
mod live {
    use crate::referee::HttpReferee;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use peta_core::{identity, Database};
    fn lib(tag: &str) -> std::path::PathBuf { let d = std::env::temp_dir().join(format!("peta-live-{tag}-{}", peta_core::ids::new_sticker_id())); std::fs::create_dir_all(&d).unwrap(); d }
    #[test]
    #[ignore]
    fn inbox_live_round_trip() {
        let (a_dir, b_dir) = (lib("a"), lib("b"));
        let (a_code, b_code) = (identity::code_here(&a_dir, "Alice").unwrap(), identity::code_here(&b_dir, "Bob").unwrap());
        let url = crate::referee::endpoint();
        let a = HttpReferee::with_url(peta_core::device_key::load_or_create(&a_dir).unwrap(), url.clone()).unwrap();
        let b = HttpReferee::with_url(peta_core::device_key::load_or_create(&b_dir).unwrap(), url).unwrap();
        let ok = |r: peta_core::Result<serde_json::Value>| r.unwrap();
        for (c, code) in [(&a, &a_code), (&b, &b_code)] {
            ok(c.request("POST", "/v1/mailbox", Some(&serde_json::json!({"signKey": code.sign_key, "encKey": code.enc_key, "name": code.name, "binding": code.binding}))));
        }
        let (a_box, b_box) = (identity::mailbox_id(&a_code.sign_key).unwrap(), identity::mailbox_id(&b_code.sign_key).unwrap());
        // Bob pastes Alice's code: a sealed request; Bob allows Alice at once.
        let sealed = identity::seal(&a_code.enc_key, identity::REQUEST, serde_json::json!({"code": b_code.to_code().unwrap(), "note": "hi"}).to_string().as_bytes()).unwrap();
        ok(b.request("POST", &format!("/v1/mailbox/{a_box}/requests/live-request-1"), Some(&serde_json::json!({"sealed": STANDARD.encode(sealed)}))));
        ok(b.request("PUT", &format!("/v1/mailbox/{b_box}/allow"), Some(&serde_json::json!({"add": [identity::key_hash(&a_code.sign_key).unwrap()]}))));
        // Alice opens it, checks the sender, approves.
        let got = ok(a.request("GET", &format!("/v1/mailbox/{a_box}/requests"), None::<&()>));
        let r = &got["requests"][0];
        assert_eq!(r["senderHash"], identity::key_hash(&b_code.sign_key).unwrap());
        let plain = identity::open(&a_dir, identity::REQUEST, &STANDARD.decode(r["sealed"].as_str().unwrap()).unwrap()).unwrap();
        let text: serde_json::Value = serde_json::from_slice(&plain).unwrap();
        let asked = identity::FriendCode::parse(text["code"].as_str().unwrap()).unwrap();
        assert_eq!(asked, b_code);
        let mut db = Database::open_in_memory().unwrap();
        assert_eq!(db.friend_request_received(&a_code.sign_key, &asked, Some("hi"), "live-request-1").unwrap(), "pending");
        let allowed = |c: &HttpReferee, id: &str| c.request::<serde_json::Value>("GET", &format!("/v1/mailbox/{id}/allowed"), None::<&()>).unwrap()["allowed"].as_bool().unwrap();
        assert!(!allowed(&b, &a_box));
        ok(a.request("PUT", &format!("/v1/mailbox/{a_box}/allow"), Some(&serde_json::json!({"add": [identity::key_hash(&b_code.sign_key).unwrap()]}))));
        ok(a.request("DELETE", &format!("/v1/mailbox/{a_box}/requests/live-request-1"), None::<&()>));
        assert!(allowed(&b, &a_box), "Bob learns he was accepted");
        // Bob sends Alice a sealed gift; Alice lists, fetches, opens and deletes it.
        let gift = identity::seal(&a_code.enc_key, identity::GIFT, b"a sealed gift file").unwrap();
        let (status, _) = b.exchange("POST", &format!("/v1/mailbox/{a_box}/messages/live-gift-0001"), &gift, "application/octet-stream", 65536).unwrap();
        assert_eq!(status, 200);
        let list = ok(a.request("GET", &format!("/v1/mailbox/{a_box}/messages"), None::<&()>));
        assert_eq!(list["messages"][0]["id"], "live-gift-0001");
        let (status, sealed) = a.exchange("GET", &format!("/v1/mailbox/{a_box}/messages/live-gift-0001"), &[], "application/json", 9 * 1024 * 1024).unwrap();
        assert_eq!(status, 200);
        assert_eq!(identity::open(&a_dir, identity::GIFT, &sealed).unwrap(), b"a sealed gift file");
        ok(a.request("DELETE", &format!("/v1/mailbox/{a_box}/messages/live-gift-0001"), None::<&()>));
        // Both leave, so the dev server keeps nothing.
        ok(a.request("DELETE", &format!("/v1/mailbox/{a_box}"), None::<&()>));
        ok(b.request("DELETE", &format!("/v1/mailbox/{b_box}"), None::<&()>));
        for d in [a_dir, b_dir] { std::fs::remove_dir_all(d).unwrap(); }
    }
}
