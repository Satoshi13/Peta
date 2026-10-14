//! Private beta invite (server builds only). peta-api refuses signing keys without a redeemed invite
//! (cloudflare/peta-api/src/invites.ts); this asks for the code once and remembers it for this signing key.
//! The lock screen is a courtesy: the server's refusal is what keeps a copied app from reaching friends.
use serde::Serialize;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InviteState {
    needed: bool,
    offline: bool,
}

/// Words for the codes peta-api answers /v1/invite with.
fn message(code: &str) -> String {
    match code {
        "unknown_invite" | "invalid" => "That code isn't right. Check it on your download page.",
        "invite_used" => "This code is already in use on another Mac. Get a new one on your download page.",
        "slow_down" => "That's a lot of tries. Wait a little, then try again.",
        "clock_skew" => "Check your Mac's date and time, then try again.",
        "offline" => "Peta couldn't connect. Check your internet connection, then try again.",
        _ => "Peta couldn't check this code. Please try again.",
    }
    .into()
}

#[cfg(feature = "server")]
mod online {
    use super::{message, InviteState};
    use crate::referee::HttpReferee;
    use std::{fs, path::Path};

    const MARKER: &str = "invite.ok";
    #[derive(serde::Deserialize)]
    struct Status {
        active: bool,
    }
    /// The marker names the key it was earned with, so a restored identity from another Mac asks again.
    fn remembered(root: &Path, key: &str) -> bool {
        fs::read_to_string(root.join(MARKER)).is_ok_and(|s| s.trim() == key)
    }
    fn remember(root: &Path, key: &str) {
        let _ = fs::write(root.join(MARKER), key);
    }
    pub fn forget(root: &Path) {
        let _ = fs::remove_file(root.join(MARKER));
    }
    /// `Err` carries a server code or "offline".
    fn exchange(r: &HttpReferee, method: &str, body: &[u8]) -> Result<Vec<u8>, String> {
        let (status, bytes) = r
            .exchange(method, "/v1/invite", body, "application/json", 4096)
            .map_err(|_| "offline".to_string())?;
        if (200..300).contains(&status) {
            return Ok(bytes);
        }
        Err(serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|v| v["error"].as_str().map(str::to_owned))
            .unwrap_or_else(|| "refused".into()))
    }
    fn active(r: &HttpReferee) -> Result<bool, String> {
        let bytes = exchange(r, "GET", &[])?;
        serde_json::from_slice::<Status>(&bytes).map(|s| s.active).map_err(|_| "offline".into())
    }
    pub fn check(root: &Path, referee: &HttpReferee) -> InviteState {
        let key = referee.public_key();
        if remembered(root, &key) {
            return InviteState { needed: false, offline: false };
        }
        match active(referee) {
            Ok(true) => {
                remember(root, &key);
                InviteState { needed: false, offline: false }
            }
            Ok(false) => InviteState { needed: true, offline: false },
            Err(code) => InviteState { needed: true, offline: code == "offline" },
        }
    }
    /// After a remembered start: true when the server no longer knows this Mac (a new code elsewhere, or paused).
    pub fn lapsed(root: &Path, referee: &HttpReferee) -> bool {
        if matches!(active(referee), Ok(false)) {
            forget(root);
            return true;
        }
        false
    }
    pub fn redeem(root: &Path, referee: &HttpReferee, code: &str) -> Result<(), String> {
        let body = serde_json::to_vec(&serde_json::json!({ "code": code })).map_err(|e| e.to_string())?;
        exchange(referee, "POST", &body).map_err(|c| message(&c))?;
        remember(root, &referee.public_key());
        Ok(())
    }
}

#[cfg(feature = "server")]
pub(crate) fn referee(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, crate::referee::HttpReferee), String> {
    use tauri::Manager;
    let store = app.state::<crate::store::Store>();
    let lib = store.lock();
    let root = lib.root().to_path_buf();
    let r = crate::referee::HttpReferee::new(&root).map_err(|e| e.to_string())?;
    Ok((root, r))
}

/// Whether to show the invite sheet. A remembered Mac starts without waiting for the network; the check runs behind it
/// and sends `invite-needed` if the invite has moved to another Mac or was paused.
#[tauri::command(async)]
pub fn invite_status(app: tauri::AppHandle) -> Result<InviteState, String> {
    #[cfg(feature = "server")]
    {
        let (root, r) = referee(&app)?;
        let state = online::check(&root, &r);
        if !state.needed {
            std::thread::spawn(move || {
                use tauri::Emitter;
                if online::lapsed(&root, &r) {
                    let _ = app.emit("invite-needed", ());
                }
            });
        }
        Ok(state)
    }
    #[cfg(not(feature = "server"))]
    {
        let _ = app;
        Ok(InviteState { needed: false, offline: false })
    }
}
#[tauri::command(async)]
pub fn invite_redeem(app: tauri::AppHandle, code: String) -> Result<(), String> {
    #[cfg(feature = "server")]
    {
        let (root, r) = referee(&app)?;
        online::redeem(&root, &r, &code)
    }
    #[cfg(not(feature = "server"))]
    {
        let _ = (app, code, message);
        Ok(())
    }
}
/// The sheet has no Cancel: until a code is in, Quit is the way out.
#[tauri::command]
pub fn invite_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(all(test, feature = "server"))]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn serve(responses: Vec<(&'static str, &'static str)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut s, _) = listener.accept().unwrap();
                // Read the whole request first: answering early resets the connection under the client's body.
                let (mut bytes, mut byte) = (vec![], [0; 1]);
                while !bytes.ends_with(b"\r\n\r\n") {
                    s.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                }
                let length = String::from_utf8_lossy(&bytes)
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                    .unwrap_or(0);
                s.read_exact(&mut vec![0; length]).unwrap();
                write!(s, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        url
    }
    fn dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("peta-invite-{tag}-{}", peta_core::ids::new_sticker_id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn referee(url: String) -> crate::referee::HttpReferee {
        crate::referee::HttpReferee::with_url(ed25519_dalek::SigningKey::from_bytes(&[9; 32]), url).unwrap()
    }

    #[test]
    fn asks_until_redeemed_then_remembers_this_key() {
        let dir = dir("redeem");
        let url = serve(vec![
            ("200 OK", r#"{"required":true,"active":false}"#),
            ("409 Conflict", r#"{"error":"invite_used"}"#),
            ("200 OK", r#"{"ok":true}"#),
            ("200 OK", r#"{"required":true,"active":false}"#),
        ]);
        let r = referee(url);
        assert_eq!(online::check(dir.as_path(), &r), InviteState { needed: true, offline: false });
        assert_eq!(online::redeem(dir.as_path(), &r, "ABCDE-12345").unwrap_err(), message("invite_used"));
        online::redeem(dir.as_path(), &r, "ABCDE-12345").unwrap();
        // Remembered: no request needed to start.
        assert_eq!(online::check(dir.as_path(), &r), InviteState { needed: false, offline: false });
        // The invite moved to another Mac: forget and ask again.
        assert!(online::lapsed(dir.as_path(), &r));
        assert!(!dir.as_path().join("invite.ok").exists());
    }

    #[test]
    fn offline_first_start_and_another_key_ask_again() {
        let dir = dir("offline");
        let r = referee("http://127.0.0.1:9".into());
        assert_eq!(online::check(dir.as_path(), &r), InviteState { needed: true, offline: true });
        std::fs::write(dir.as_path().join("invite.ok"), "someone-else").unwrap();
        assert_eq!(online::check(dir.as_path(), &r).needed, true);
        // An unreachable server never takes a remembered invite away.
        std::fs::write(dir.as_path().join("invite.ok"), r.public_key()).unwrap();
        assert!(!online::lapsed(dir.as_path(), &r));
        assert!(dir.as_path().join("invite.ok").exists());
    }
}
