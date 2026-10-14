//! Coupons: a short name the owner posts (THANKYOU), exchanged with peta-api for a bundle the owner signed offline with
//! peta-pass. The bundle is checked against the built-in official keys and applied once per Mac like any official event,
//! so the server can refuse or count, but never invent a gift.

/// A coupon name, as opposed to a long PETA1 code: 3–24 letters, digits or hyphens.
pub fn looks_like(value: &str) -> bool {
    let v = value.trim();
    (3..=24).contains(&v.len()) && v.as_bytes()[0].is_ascii_alphanumeric() && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[cfg_attr(not(feature = "server"), allow(dead_code))]
fn message(code: &str) -> String {
    match code {
        "unknown_coupon" | "invalid" => "There's no coupon with that name. Check the spelling.",
        "coupon_not_started" => "This coupon isn't open yet.",
        "coupon_ended" => "This coupon has ended.",
        "coupon_used_up" => "This coupon has run out.",
        "slow_down" => "That's a lot of tries. Wait a little, then try again.",
        "not_invited" => "This Mac needs your invite code before it can use coupons. Reopen Peta to enter it.",
        "clock_skew" => "Check your Mac's date and time, then try again.",
        "offline" => "Connect to the internet to use a coupon.",
        _ => "Peta couldn't check this coupon. Please try again.",
    }
    .into()
}

/// The signed event behind a coupon name, or words for the person.
#[cfg(feature = "server")]
pub fn fetch(referee: &crate::referee::HttpReferee, name: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let body = serde_json::to_vec(&serde_json::json!({ "name": name.trim() })).map_err(|e| e.to_string())?;
    let (status, bytes) = referee
        .exchange("POST", "/v1/coupons/redeem", &body, "application/json", 256 * 1024)
        .map_err(|_| message("offline"))?;
    let json = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(message(json["error"].as_str().unwrap_or("refused")));
    }
    json["event"].as_str().and_then(|s| STANDARD.decode(s).ok()).ok_or_else(|| message("refused"))
}
#[cfg(not(feature = "server"))]
pub fn unavailable() -> String {
    "Coupons need the internet edition of Peta. Long codes still work here.".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_and_long_codes_are_told_apart() {
        assert!(looks_like(" thankyou "));
        assert!(looks_like("FALL-26"));
        for no in ["AB", "-X1", "THANK YOU", "PETA1-0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRSTVWXYZ", "日本語"] {
            assert!(!looks_like(no), "{no}");
        }
    }
    #[cfg(feature = "server")]
    #[test]
    fn the_server_hands_back_the_signed_event_or_a_reason() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for (status, body) in [("200 OK", r#"{"event":"UEVUQUVWTlQ="}"#), ("409 Conflict", r#"{"error":"coupon_used_up"}"#), ("200 OK", r#"{"event":42}"#)] {
                let (mut s, _) = listener.accept().unwrap();
                let (mut bytes, mut byte) = (vec![], [0; 1]);
                while !bytes.ends_with(b"\r\n\r\n") { s.read_exact(&mut byte).unwrap(); bytes.push(byte[0]); }
                let length = String::from_utf8_lossy(&bytes).lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                let mut request = vec![0; length];
                s.read_exact(&mut request).unwrap();
                assert_eq!(serde_json::from_slice::<serde_json::Value>(&request).unwrap()["name"], "thankyou");
                write!(s, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let r = crate::referee::HttpReferee::with_url(ed25519_dalek::SigningKey::from_bytes(&[3; 32]), url).unwrap();
        assert_eq!(fetch(&r, " thankyou ").unwrap(), b"PETAEVNT");
        assert_eq!(fetch(&r, "thankyou").unwrap_err(), message("coupon_used_up"));
        assert!(fetch(&r, "thankyou").is_err());
        let offline = crate::referee::HttpReferee::with_url(ed25519_dalek::SigningKey::from_bytes(&[3; 32]), "http://127.0.0.1:9".into()).unwrap();
        assert_eq!(fetch(&offline, "thankyou").unwrap_err(), message("offline"));
    }
}
