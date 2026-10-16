//! Signed owner settings that are not receipts: the in-app announcement and the official shop's configuration.
//! Each setting is checked against the app's own limits; one outside them is ignored whole, never partly repaired.
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
const SHOP: &str = "config.shop";
pub const MAX_SHOP_CONFIGS: usize = 10;
/// A shop price may move only within this share of the built-in price (scraps.rs `PACKS`).
pub const SHOP_PRICE_MIN_PERCENT: i64 = 50;
pub const SHOP_PRICE_MAX_PERCENT: i64 = 200;
pub const SHOP_BLURB_MAX_CHARS: usize = 120;
/// A shop setting names at most this many packs (the six built-in ones plus official shop packs, `shop:<packId>`),
/// and features at most `SHOP_MAX_FEATURED` of them.
pub const SHOP_MAX_PACKS: usize = 30;
pub const SHOP_MAX_FEATURED: usize = 6;
const SHOP_MAX_DAYS: i64 = 400;
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
/// Which official packs the Market features and in what order, what it says about them, and what they cost.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShopConfig {
    pub config_id: String,
    pub config_kind: ShopKind,
    pub featured: Vec<String>,
    pub official_first: bool,
    pub order: Vec<String>,
    pub packs: Vec<ShopPack>,
}
/// A standing configuration, or one for a period that takes priority while it runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShopKind {
    Default,
    Event,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShopPack {
    pub id: String,
    pub on_sale: bool,
    pub price: Option<i64>,
    pub blurb: Option<String>,
}
/// The price range a configuration may set for a paid pack. Free packs have none. A shop pack's own price is only
/// known once its file is here, so a setting may name 50% of the lowest to 200% of the highest shop price; the shop
/// applies the pack's own 50–200% range when it prices the pack, and ignores a price outside it for that pack.
pub fn shop_price_range(id: &str) -> Option<(i64, i64)> {
    if crate::shop_pack::pack_id(id).is_some() {
        return Some(((crate::shop_pack::MIN_PRICE * SHOP_PRICE_MIN_PERCENT + 99) / 100, crate::shop_pack::MAX_PRICE * SHOP_PRICE_MAX_PERCENT / 100));
    }
    let pack = crate::pack::market_pack(id)?;
    let base = crate::scraps::default_pack_price(id)?;
    (!pack.free).then(|| ((base * SHOP_PRICE_MIN_PERCENT + 99) / 100, base * SHOP_PRICE_MAX_PERCENT / 100))
}
pub fn validate_shop(c: &ShopConfig) -> Result<()> {
    let known = |id: &String| crate::pack::market_pack(id).is_some() || crate::shop_pack::pack_id(id).is_some();
    let unique = |ids: &[&String]| ids.iter().collect::<std::collections::HashSet<_>>().len() == ids.len();
    let packs: Vec<&String> = c.packs.iter().map(|p| &p.id).collect();
    if !events::safe_id(&c.config_id)
        || c.featured.len() > SHOP_MAX_FEATURED
        || [&c.featured, &c.order].iter().any(|ids| ids.len() > SHOP_MAX_PACKS || !ids.iter().all(known) || !unique(&ids.iter().collect::<Vec<_>>()))
        || packs.len() > SHOP_MAX_PACKS || !packs.iter().all(|id| known(id)) || !unique(&packs)
    {
        return Err(invalid("Shop settings name only Peta's own packs, each once."));
    }
    for p in &c.packs {
        if let Some(price) = p.price {
            let (low, high) = shop_price_range(&p.id).ok_or_else(|| invalid("A free pack can't be given a price."))?;
            if !(low..=high).contains(&price) {
                return Err(invalid("Shop prices stay within 50% to 200% of the built-in price."));
            }
        }
        if p.blurb.as_ref().is_some_and(|b| !events::text(b, SHOP_BLURB_MAX_CHARS)) {
            return Err(invalid("Pack lines are up to 120 characters on one line."));
        }
    }
    Ok(())
}
fn shop(v: &Verified) -> Result<Timed<ShopConfig>> {
    let e = v.header();
    if e.kind != SHOP_CONFIG || !v.attachments().is_empty() {
        return Err(invalid("This is not a shop setting."));
    }
    let c: ShopConfig = serde_json::from_value(e.payload.clone()).map_err(|_| invalid("This shop setting is not supported."))?;
    validate_shop(&c)?;
    if c.config_id != e.event_id {
        return Err(invalid("Shop setting IDs must match."));
    }
    period(v, c, SHOP_MAX_DAYS)
}
/// Replace the whole shop snapshot; settings outside the limits are dropped whole.
pub fn replace_shop(db: &mut Database, configs: &[Verified]) -> Result<()> {
    if configs.len() > MAX_SHOP_CONFIGS || configs.iter().any(|v| v.header().kind != SHOP_CONFIG) {
        return Err(invalid("Unexpected shop settings."));
    }
    let kept: Vec<String> = configs.iter().filter(|v| shop(v).is_ok()).map(|v| STANDARD.encode(v.bytes())).collect();
    db.set_setting(SHOP, &serde_json::to_string(&kept).expect("strings serialize"))
}
/// The shop setting in effect: one for a period beats the standing one, then the latest start wins.
/// Builds without the server never have one, so they keep the built-in shop.
pub(crate) fn active_shop(conn: &rusqlite::Connection, now: DateTime<Utc>) -> Option<ShopConfig> {
    if !cfg!(any(feature = "daily-tables", test)) {
        return None;
    }
    let mut live: Vec<_> = cached(conn, SHOP).iter().filter_map(|v| shop(v).ok()).filter(|t| t.start <= now && now < t.end).collect();
    live.sort_by(|a, b| {
        (a.value.config_kind == ShopKind::Event, a.start, a.issued, &a.value.config_id).cmp(&(b.value.config_kind == ShopKind::Event, b.start, b.issued, &b.value.config_id))
    });
    live.pop().map(|t| t.value)
}
fn cached(conn: &rusqlite::Connection, key: &str) -> Vec<Verified> {
    let raw: Option<String> = conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional().ok().flatten();
    raw.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .take(MAX_ANNOUNCEMENTS.max(MAX_SHOP_CONFIGS))
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
#[cfg(test)]
mod shop_contract_tests {
    use super::*;
    #[test]
    fn owner_worker_shop_catalog_limits_and_signature_match_the_app() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../../../cloudflare/peta-admin/test/config-vector.json")).unwrap();
        let fix = "Update with: cd cloudflare/peta-admin && node scripts/config-vector.mjs; review, then redeploy the admin page.";
        let limits = &v["shopCatalog"]["limits"];
        assert_eq!((limits["minPercent"].as_i64(), limits["maxPercent"].as_i64(), limits["blurbMax"].as_u64(), limits["maxPacks"].as_u64(), limits["maxDays"].as_i64(), limits["maxConfigs"].as_u64()),
            (Some(SHOP_PRICE_MIN_PERCENT), Some(SHOP_PRICE_MAX_PERCENT), Some(SHOP_BLURB_MAX_CHARS as u64), Some(SHOP_MAX_PACKS as u64), Some(SHOP_MAX_DAYS), Some(MAX_SHOP_CONFIGS as u64)), "{fix}");
        assert_eq!((limits["maxFeatured"].as_u64(), v["shopCatalog"]["shopPackPrefix"].as_str()), (Some(SHOP_MAX_FEATURED as u64), Some(crate::shop_pack::LOCAL_PREFIX)), "{fix}");
        let any = shop_price_range("shop:any").unwrap();
        assert_eq!((v["shopCatalog"]["shopPackPrice"]["min"].as_i64(), v["shopCatalog"]["shopPackPrice"]["max"].as_i64()), (Some(crate::shop_pack::MIN_PRICE), Some(crate::shop_pack::MAX_PRICE)), "{fix}");
        assert_eq!(any, (2, 80));
        let packs = v["shopCatalog"]["packs"].as_array().unwrap();
        assert_eq!(packs.len(), crate::scraps::status(&Database::open_in_memory().unwrap().conn).unwrap().packs.len(), "{fix}");
        for p in packs {
            let id = p["id"].as_str().unwrap();
            let pack = crate::pack::market_pack(id).expect(fix);
            assert_eq!((p["title"].as_str(), p["price"].as_i64(), p["free"].as_bool()), (Some(pack.title), crate::scraps::default_pack_price(id), Some(pack.free)), "{fix}");
        }
        let bytes = STANDARD.decode(v["shopEvent"].as_str().unwrap()).unwrap();
        let event = events::decode(&bytes).unwrap();
        assert_eq!(events::encode(event.header(), &[], &tests::key()).unwrap(), bytes);
        let mut db = Database::open_in_memory().unwrap();
        replace_shop(&mut db, &[event]).unwrap();
        let c = active_shop(&db.conn, tests::stamp("2026-10-20T00:00:00Z")).unwrap();
        assert_eq!((c.config_id.as_str(), c.config_kind, c.featured.clone(), c.official_first), ("shop-contract", ShopKind::Event, vec!["night".to_string(), "pixel".into()], true));
        assert_eq!(c.packs.iter().map(|p| (p.id.as_str(), p.on_sale, p.price)).collect::<Vec<_>>(), [("night", true, Some(18)), ("cats", false, None), ("tokyo", true, None)]);
        assert!(active_shop(&db.conn, tests::stamp("2026-11-01T00:00:00Z")).is_none());
    }
}
