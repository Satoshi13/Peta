//! Signed owner settings that are not receipts: the in-app announcement. Each setting is checked against the
//! app's own limits; one outside them is ignored whole, never partly repaired.
use crate::{
    error::Error,
    events::{self, Verified},
    Database, Result,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Duration, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

pub const ANNOUNCEMENT: &str = "announcement";
pub const SHOP_CONFIG: &str = "shop_config";
/// Kinds the coupon key may sign besides `bundle` and `daily_table`.
pub const KINDS: [&str; 2] = [ANNOUNCEMENT, SHOP_CONFIG];
pub const ANNOUNCEMENT_MAX_CHARS: usize = 140;
pub const MAX_ANNOUNCEMENTS: usize = 10;
const ANNOUNCEMENT_MAX_DAYS: i64 = 366;
const ANNOUNCEMENTS: &str = "config.announcements";
const DISMISSED: &str = "config.announcements.dismissed";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoticeKind {
    Info,
    Event,
    Maintenance,
}
/// Where the banner may lead. The addresses are built into the app, never sent by the server.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoticeLink {
    Download,
    Discord,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Announcement {
    pub announcement_id: String,
    pub kind: NoticeKind,
    pub link: Option<NoticeLink>,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub kind: NoticeKind,
    pub text: String,
    pub link: Option<NoticeLink>,
}
struct Timed<T> {
    value: T,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    issued: DateTime<Utc>,
}
fn invalid(s: &str) -> Error {
    Error::Invalid(s.into())
}
fn date(s: Option<&str>) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(s.ok_or_else(|| invalid("Settings need both dates."))?)
        .map_err(|_| invalid("Invalid settings date."))?
        .with_timezone(&Utc))
}
/// The signed period: `notBefore` ≤ now < `notAfter`, both required.
fn period<T>(v: &Verified, value: T, max_days: i64) -> Result<Timed<T>> {
    let e = v.header();
    let (start, end, issued) = (date(e.not_before.as_deref())?, date(e.not_after.as_deref())?, date(Some(&e.issued_at))?);
    if start >= end || end - start > Duration::days(max_days) {
        return Err(invalid("Invalid settings period."));
    }
    Ok(Timed { value, start, end, issued })
}
pub fn validate_announcement(a: &Announcement) -> Result<()> {
    if !events::safe_id(&a.announcement_id) || !events::text(&a.text, ANNOUNCEMENT_MAX_CHARS) {
        return Err(invalid("Announcements need an ID and up to 140 characters of text."));
    }
    Ok(())
}
fn announcement(v: &Verified) -> Result<Timed<Announcement>> {
    let e = v.header();
    if e.kind != ANNOUNCEMENT || !v.attachments().is_empty() {
        return Err(invalid("This is not an announcement."));
    }
    let a: Announcement = serde_json::from_value(e.payload.clone()).map_err(|_| invalid("This announcement is not supported."))?;
    validate_announcement(&a)?;
    if a.announcement_id != e.event_id {
        return Err(invalid("Announcement IDs must match."));
    }
    period(v, a, ANNOUNCEMENT_MAX_DAYS)
}
fn cached(conn: &rusqlite::Connection, key: &str) -> Vec<Verified> {
    let raw: Option<String> = conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional().ok().flatten();
    raw.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .take(MAX_ANNOUNCEMENTS)
        // Re-verified on every read: only the built-in trust set can ever be used.
        .filter_map(|s| STANDARD.decode(s).ok().and_then(|b| events::decode(&b).ok()))
        .collect()
}
/// Replace the whole announcement snapshot. Stopped announcements leave with the next snapshot; out-of-range ones are dropped whole.
pub fn replace(db: &mut Database, announcements: &[Verified]) -> Result<()> {
    if announcements.len() > MAX_ANNOUNCEMENTS || announcements.iter().any(|v| v.header().kind != ANNOUNCEMENT) {
        return Err(invalid("Unexpected announcements."));
    }
    let kept: Vec<String> = announcements.iter().filter(|v| announcement(v).is_ok()).map(|v| STANDARD.encode(v.bytes())).collect();
    db.set_setting(ANNOUNCEMENTS, &serde_json::to_string(&kept).expect("strings serialize"))
}
fn dismissed(conn: &rusqlite::Connection) -> Vec<String> {
    let raw: Option<String> = conn.query_row("SELECT value FROM meta WHERE key=?1", [DISMISSED], |r| r.get(0)).optional().ok().flatten();
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
/// The newest announcement in its period that this Mac hasn't closed.
pub fn current_announcement(db: &Database, now: DateTime<Utc>) -> Option<Notice> {
    let conn = &db.conn;
    let closed = dismissed(conn);
    let mut live: Vec<_> = cached(conn, ANNOUNCEMENTS)
        .iter()
        .filter_map(|v| announcement(v).ok())
        .filter(|t| t.start <= now && now < t.end && !closed.contains(&t.value.announcement_id))
        .collect();
    live.sort_by(|a, b| (a.start, a.issued, &a.value.announcement_id).cmp(&(b.start, b.issued, &b.value.announcement_id)));
    live.pop().map(|t| Notice { id: t.value.announcement_id, kind: t.value.kind, text: t.value.text, link: t.value.link })
}
/// Closing is remembered per announcement ID (the most recent 50).
pub fn dismiss(db: &mut Database, id: &str) -> Result<()> {
    if !events::safe_id(id) {
        return Err(invalid("Unknown announcement."));
    }
    let mut closed = dismissed(&db.conn);
    closed.retain(|c| c != id);
    closed.push(id.into());
    let skip = closed.len().saturating_sub(50);
    db.set_setting(DISMISSED, &serde_json::to_string(&closed[skip..]).expect("strings serialize"))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    pub(crate) fn key() -> SigningKey {
        // RFC 8032 test 1 secret: the public test coupon key c1.
        let h = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
        let mut b = [0; 32];
        for (i, c) in b.iter_mut().enumerate() {
            *c = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).unwrap();
        }
        SigningKey::from_bytes(&b)
    }
    pub(crate) fn stamp(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    pub(crate) fn signed(id: &str, kind: &str, payload: serde_json::Value, start: &str, end: &str) -> Verified {
        let e = events::Event {
            event_id: id.into(),
            kind: kind.into(),
            issued_at: "2026-10-16T00:00:00Z".into(),
            not_before: Some(start.into()),
            not_after: Some(end.into()),
            title: "Settings".into(),
            message: "".into(),
            payload,
            signer: crate::sign::Signer::Official { key_id: "c1".into() },
            attachments: vec![],
        };
        events::decode(&events::encode(&e, &[], &key()).unwrap()).unwrap()
    }
    fn notice(id: &str, kind: &str, text: &str, link: serde_json::Value, start: &str, end: &str) -> Verified {
        signed(id, ANNOUNCEMENT, serde_json::json!({"announcementId":id,"kind":kind,"link":link,"text":text}), start, end)
    }
    #[test]
    fn the_newest_live_announcement_shows_until_closed_or_stopped() {
        let mut db = Database::open_in_memory().unwrap();
        let now = stamp("2026-10-20T12:00:00Z");
        let old = notice("news-old", "info", "Hello", serde_json::Value::Null, "2026-10-18T00:00:00Z", "2026-11-01T00:00:00Z");
        let new = notice("news-new", "event", "<b>Autumn</b> week", serde_json::json!("discord"), "2026-10-19T00:00:00Z", "2026-10-21T00:00:00Z");
        let later = notice("news-later", "maintenance", "Soon", serde_json::Value::Null, "2026-10-25T00:00:00Z", "2026-10-26T00:00:00Z");
        replace(&mut db, &[old, new, later]).unwrap();
        let shown = current_announcement(&db, now).unwrap();
        assert_eq!(shown, Notice { id: "news-new".into(), kind: NoticeKind::Event, text: "<b>Autumn</b> week".into(), link: Some(NoticeLink::Discord) });
        // Periods: the start is inclusive, the end exclusive.
        assert_eq!(current_announcement(&db, stamp("2026-10-21T00:00:00Z")).unwrap().id, "news-old");
        assert_eq!(current_announcement(&db, stamp("2026-10-25T00:00:00Z")).unwrap().id, "news-later");
        assert!(current_announcement(&db, stamp("2026-10-17T23:59:59Z")).is_none());
        // Closed stays closed; the next one shows.
        dismiss(&mut db, "news-new").unwrap();
        assert_eq!(current_announcement(&db, now).unwrap().id, "news-old");
        dismiss(&mut db, "news-old").unwrap();
        assert!(current_announcement(&db, now).is_none());
        // A stopped announcement is absent from the next snapshot.
        replace(&mut db, &[]).unwrap();
        assert!(current_announcement(&db, stamp("2026-10-25T12:00:00Z")).is_none());
    }
    #[test]
    fn unknown_kinds_links_or_oversized_text_are_ignored_whole() {
        let mut db = Database::open_in_memory().unwrap();
        let (s, e) = ("2026-10-18T00:00:00Z", "2026-11-01T00:00:00Z");
        let good = notice("news-good", "info", "Fine", serde_json::Value::Null, s, e);
        let bad = [
            notice("news-a", "party", "Hi", serde_json::Value::Null, s, e),
            notice("news-b", "info", "Hi", serde_json::json!("https://example.com"), s, e),
            notice("news-c", "info", &"x".repeat(141), serde_json::Value::Null, s, e),
            notice("news-d", "info", "line\nbreak", serde_json::Value::Null, s, e),
            notice("news-e", "info", "", serde_json::Value::Null, s, e),
            notice("news-f", "info", "Hi", serde_json::Value::Null, "2026-10-18T00:00:00Z", "2028-01-01T00:00:00Z"),
            signed("news-g", ANNOUNCEMENT, serde_json::json!({"announcementId":"news-g","kind":"info","link":null,"text":"Hi","url":"https://example.com"}), s, e),
            signed("news-h", ANNOUNCEMENT, serde_json::json!({"announcementId":"other","kind":"info","link":null,"text":"Hi"}), s, e),
        ];
        replace(&mut db, &[notice("news-i", "info", &"é".repeat(140), serde_json::Value::Null, s, e)]).unwrap();
        assert_eq!(current_announcement(&db, stamp("2026-10-20T00:00:00Z")).unwrap().text.chars().count(), 140);
        for b in &bad {
            replace(&mut db, std::slice::from_ref(b)).unwrap();
            assert!(current_announcement(&db, stamp("2026-10-20T00:00:00Z")).is_none(), "{}", b.header().event_id);
        }
        replace(&mut db, &[good]).unwrap();
        assert_eq!(current_announcement(&db, stamp("2026-10-20T00:00:00Z")).unwrap().id, "news-good");
        // Another kind in the announcement snapshot is refused and keeps the previous cache.
        let table = signed("t", "daily_table", serde_json::json!({}), s, e);
        assert!(replace(&mut db, &[table]).is_err());
        assert_eq!(current_announcement(&db, stamp("2026-10-20T00:00:00Z")).unwrap().id, "news-good");
    }
    #[test]
    fn announcements_are_never_receipts() {
        let root = std::env::temp_dir().join(format!("peta-notice-{}", crate::ids::new_sticker_id()));
        let mut lib = crate::Library::open(&root).unwrap();
        let v = notice("news-receipt", "info", "Hi", serde_json::Value::Null, "2026-10-18T00:00:00Z", "2026-11-01T00:00:00Z");
        assert!(events::apply_event(&mut lib, &v, "coupon", stamp("2026-10-20T00:00:00Z")).is_err());
        drop(lib);
        std::fs::remove_dir_all(root).unwrap();
    }
}
#[cfg(test)]
mod worker_contract_tests {
    use super::*;
    fn vector() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../../cloudflare/peta-admin/test/config-vector.json")).unwrap()
    }
    #[test]
    fn owner_worker_announcement_decodes_and_shows() {
        let v = vector();
        let bytes = STANDARD.decode(v["announcementEvent"].as_str().unwrap()).unwrap();
        let event = events::decode(&bytes).unwrap();
        // Same framing and field order as the Rust encoder.
        assert_eq!(events::encode(event.header(), &[], &tests::key()).unwrap(), bytes);
        let mut db = Database::open_in_memory().unwrap();
        replace(&mut db, &[event]).unwrap();
        let shown = current_announcement(&db, tests::stamp("2026-10-20T00:00:00Z")).unwrap();
        assert_eq!((shown.id.as_str(), shown.kind, shown.link, shown.text.as_str()), ("news-contract", NoticeKind::Event, Some(NoticeLink::Download), v["announcement"]["text"].as_str().unwrap()));
        assert_eq!(ANNOUNCEMENT_MAX_CHARS, 140);
    }
}
