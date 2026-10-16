//! Signed supply policy, separate from once-per-Mac event receipts.
use crate::{
    error::Error,
    events::{self, Verified},
    materials::{self, Rarity},
    Database, Result,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyTable {
    pub table_id: String,
    pub table_kind: TableKind,
    pub items: Vec<Item>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableKind {
    Default,
    Event,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub weight: u32,
}
#[derive(Clone)]
struct Timed {
    table: DailyTable,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    issued: DateTime<Utc>,
}
const CACHE: &str = "daily.tables";
fn invalid(s: &str) -> Error {
    Error::Invalid(s.into())
}
pub fn validate(table: &DailyTable) -> Result<()> {
    if !events::safe_id(&table.table_id) || table.items.is_empty() || table.items.len() > 20 {
        return Err(invalid(
            "Daily tables need 1 to 20 materials and a valid ID.",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u32;
    let mut matte = 0;
    for item in &table.items {
        if !(1..=1000).contains(&item.weight)
            || materials::get(&item.id).is_none()
            || !seen.insert(&item.id)
        {
            return Err(invalid(
                "Daily table materials must be known, unique and weighted from 1 to 1000.",
            ));
        }
        total += item.weight;
        if item.id == "matte" {
            matte = item.weight;
        }
    }
    if matte * 100 < total * materials::DAILY_MATTE_MIN_PERCENT {
        return Err(invalid("Matte must be at least 20% of a daily table."));
    }
    for item in &table.items {
        if matches!(
            materials::get(&item.id).unwrap().rarity,
            Rarity::Special | Rarity::Archive
        ) && item.weight * 100 > total * materials::DAILY_LIMITED_MAX_PERCENT
        {
            return Err(invalid(
                "Each Special or Archive material must be at most 5%.",
            ));
        }
    }
    Ok(())
}
fn verified_table(v: &Verified, now: DateTime<Utc>) -> Result<Timed> {
    let e = v.header();
    if e.kind != "daily_table" || !v.attachments().is_empty() {
        return Err(invalid("This is not a daily table."));
    }
    let table: DailyTable = serde_json::from_value(e.payload.clone())
        .map_err(|_| invalid("This daily table is not supported."))?;
    validate(&table)?;
    if table.table_id != e.event_id {
        return Err(invalid("Daily table IDs must match."));
    }
    let date =
        |s: Option<&str>| -> Result<DateTime<Utc>> {
            Ok(DateTime::parse_from_rfc3339(
                s.ok_or_else(|| invalid("Daily tables need both dates."))?,
            )
            .map_err(|_| invalid("Invalid daily table date."))?
            .with_timezone(&Utc))
        };
    let start = date(e.not_before.as_deref())?;
    let end = date(e.not_after.as_deref())?;
    let issued = date(Some(&e.issued_at))?;
    if start >= end
        || end <= now
        || issued > now + chrono::Duration::minutes(5)
        || (table.table_kind == TableKind::Default && end - issued > chrono::Duration::days(400))
    {
        return Err(invalid("Invalid or expired daily table period."));
    }
    Ok(Timed {
        table,
        start,
        end,
        issued,
    })
}
fn read(conn: &rusqlite::Connection) -> Result<Vec<String>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key=?1", [CACHE], |r| r.get(0))
        .optional()?;
    Ok(raw
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .filter(|v| v.len() <= 11)
        .unwrap_or_default())
}
fn failure(db: &mut Database, error: &Error) -> Result<()> {
    db.set_setting(
        "daily.table_error",
        &error.to_string().chars().take(240).collect::<String>(),
    )
}
/// Atomically replace a complete verified snapshot. A failed response never partly overwrites the cache.
pub fn replace(db: &mut Database, tables: &[Verified], now: DateTime<Utc>) -> Result<()> {
    let check = (|| {
        if tables.len() > 11 {
            return Err(invalid("Too many daily tables."));
        }
        let mut defaults = 0;
        let mut events = 0;
        let mut ids = std::collections::HashSet::new();
        for v in tables {
            let t = verified_table(v, now)?;
            if !ids.insert(t.table.table_id) {
                return Err(invalid("Duplicate daily table ID."));
            }
            match t.table.table_kind {
                TableKind::Default => defaults += 1,
                TableKind::Event => events += 1,
            };
        }
        if defaults > 1 || events > 10 {
            return Err(invalid("Too many daily tables."));
        }
        Ok(())
    })();
    if let Err(error) = check {
        failure(db, &error)?;
        return Err(error);
    }
    let encoded: Vec<_> = tables.iter().map(|v| STANDARD.encode(v.bytes())).collect();
    let tx = db.conn.transaction()?;
    tx.execute(
        "INSERT INTO meta VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![CACHE, serde_json::to_string(&encoded).unwrap()],
    )?;
    tx.execute("DELETE FROM meta WHERE key='daily.table_error'", [])?;
    tx.commit()?;
    Ok(())
}
pub fn accept_table(db: &mut Database, v: &Verified, now: DateTime<Utc>) -> Result<()> {
    let incoming = match verified_table(v, now) {
        Ok(t) => t,
        Err(error) => {
            failure(db, &error)?;
            return Err(error);
        }
    };
    let mut current: Vec<_> = read(&db.conn)?
        .into_iter()
        .filter_map(|s| {
            STANDARD
                .decode(s)
                .ok()
                .and_then(|b| events::decode(&b).ok())
        })
        .filter(|old| {
            verified_table(old, now).is_ok_and(|t| {
                t.table.table_id != incoming.table.table_id
                    && !(t.table.table_kind == TableKind::Default
                        && incoming.table.table_kind == TableKind::Default)
            })
        })
        .collect();
    // Re-decode, so only the standard built-in trust set can ever be persisted.
    current.push(events::decode(v.bytes())?);
    replace(db, &current, now)
}
pub(crate) fn selected(conn: &rusqlite::Connection, now: DateTime<Utc>) -> Option<DailyTable> {
    if !cfg!(any(feature = "daily-tables", test)) {
        return None;
    }
    let mut tables: Vec<_> = read(conn)
        .ok()?
        .into_iter()
        .filter_map(|s| {
            STANDARD
                .decode(s)
                .ok()
                .and_then(|b| events::decode(&b).ok())
                .and_then(|v| verified_table(&v, now).ok())
        })
        .filter(|t| t.start <= now && now < t.end)
        .collect();
    tables.sort_by(|a, b| {
        (
            a.table.table_kind == TableKind::Event,
            a.start,
            a.issued,
            &a.table.table_id,
        )
            .cmp(&(
                b.table.table_kind == TableKind::Event,
                b.start,
                b.issued,
                &b.table.table_id,
            ))
    });
    tables.pop().map(|t| t.table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    fn table(items: &[(&str, u32)]) -> DailyTable {
        DailyTable {
            table_id: "table-test".into(),
            table_kind: TableKind::Default,
            items: items
                .iter()
                .map(|(id, weight)| Item {
                    id: (*id).into(),
                    weight: *weight,
                })
                .collect(),
        }
    }
    fn key() -> SigningKey {
        let h = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
        let mut b = [0; 32];
        for (i, c) in b.iter_mut().enumerate() {
            *c = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).unwrap();
        }
        SigningKey::from_bytes(&b)
    }
    fn stamp(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    fn event(id: &str, kind: TableKind, start: &str, end: &str, material: &str) -> Verified {
        let mut t = table(&[("matte", 80), (material, 20)]);
        t.table_id = id.into();
        t.table_kind = kind;
        let e = events::Event {
            event_id: id.into(),
            kind: "daily_table".into(),
            issued_at: "2026-10-16T00:00:00Z".into(),
            not_before: Some(start.into()),
            not_after: Some(end.into()),
            title: "Daily supply".into(),
            message: "".into(),
            payload: serde_json::to_value(t).unwrap(),
            signer: crate::sign::Signer::Official {
                key_id: "c1".into(),
            },
            attachments: vec![],
        };
        events::decode(&events::encode(&e, &[], &key()).unwrap()).unwrap()
    }
    #[test]
    fn supply_caps_are_fixed_and_boundaries_are_exact() {
        assert_eq!(materials::DAILY_MATTE_MIN_PERCENT, 20);
        assert_eq!(materials::DAILY_LIMITED_MAX_PERCENT, 5);
        for items in [
            vec![("matte", 20), ("kraft", 75), ("gold", 5)],
            vec![("matte", 20), ("kraft", 70), ("vintage", 5), ("sakura", 5)],
        ] {
            assert!(validate(&table(&items)).is_ok());
        }
        for items in [
            vec![("matte", 19), ("kraft", 81)],
            vec![("matte", 20), ("gold", 6), ("kraft", 74)],
            vec![("matte", 20), ("vintage", 6), ("kraft", 74)],
            vec![("matte", 1001)],
            vec![("matte", 0)],
            vec![("matte", 1), ("matte", 1)],
            vec![("missing", 100)],
            vec![],
        ] {
            assert!(validate(&table(&items)).is_err());
        }
    }
    #[test]
    fn periods_overlap_and_existing_days_are_stable() {
        let mut db = Database::open_in_memory().unwrap();
        let now = stamp("2026-10-16T12:00:00Z");
        let default = event(
            "default",
            TableKind::Default,
            "2026-10-16T00:00:00Z",
            "2026-11-01T00:00:00Z",
            "kraft",
        );
        let early = event(
            "early",
            TableKind::Event,
            "2026-10-16T10:00:00Z",
            "2026-10-17T00:00:00Z",
            "riso",
        );
        let late = event(
            "late",
            TableKind::Event,
            "2026-10-16T12:00:00Z",
            "2026-10-16T13:00:00Z",
            "washi",
        );
        replace(&mut db, &[default, early, late], now).unwrap();
        assert_eq!(selected(&db.conn, now).unwrap().table_id, "late");
        assert_eq!(
            selected(&db.conn, stamp("2026-10-16T11:59:59Z"))
                .unwrap()
                .table_id,
            "early"
        );
        assert_eq!(
            selected(&db.conn, stamp("2026-10-16T13:00:00Z"))
                .unwrap()
                .table_id,
            "early"
        );
        assert_eq!(
            selected(&db.conn, stamp("2026-10-17T00:00:00Z"))
                .unwrap()
                .table_id,
            "default"
        );
        assert!(selected(&db.conn, stamp("2026-11-01T00:00:00Z")).is_none());
        assert_eq!(
            crate::daily::ensure_today(&mut db, "2026-10-16", 0.99)
                .unwrap()
                .material_id,
            "holographic"
        );
        let today = crate::daily::ensure_today(&mut db, "2026-10-17", 0.99).unwrap();
        replace(&mut db, &[], now).unwrap();
        assert_eq!(
            crate::daily::ensure_today(&mut db, "2026-10-17", 0.0).unwrap(),
            today
        );
        assert_eq!(materials::draw(0.7, false, None), "kraft");
        assert_eq!(
            materials::draw(0.99, true, Some(&table(&[("matte", 20), ("riso", 80)]))),
            "holographic"
        );
        assert_eq!(
            materials::draw(0.99, false, Some(&table(&[("matte", 20), ("riso", 80)]))),
            "riso"
        );
    }
    #[test]
    fn bad_snapshot_is_atomic_and_daily_tables_do_not_create_receipts() {
        let mut db = Database::open_in_memory().unwrap();
        let now = stamp("2026-10-16T12:00:00Z");
        let good = event(
            "default",
            TableKind::Default,
            "2026-10-16T00:00:00Z",
            "2026-11-01T00:00:00Z",
            "kraft",
        );
        accept_table(&mut db, &good, now).unwrap();
        let before = db.setting(CACHE).unwrap();
        assert!(replace(
            &mut db,
            &[
                event(
                    "a",
                    TableKind::Default,
                    "2026-10-16T00:00:00Z",
                    "2026-11-01T00:00:00Z",
                    "kraft"
                ),
                event(
                    "b",
                    TableKind::Default,
                    "2026-10-16T00:00:00Z",
                    "2026-11-01T00:00:00Z",
                    "riso"
                )
            ],
            now
        )
        .is_err());
        assert_eq!(db.setting(CACHE).unwrap(), before);
        assert!(db.setting("daily.table_error").unwrap().is_some());
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM applied_events", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

/// Public, non-secret contract for the owner page. Material IDs always come from the Rust catalog.
pub fn catalog_contract() -> serde_json::Value {
    let colors = [
        "#eee7d7", "#bc9259", "#b9cad4", "#caa747", "#d6c7b2", "#b9a17c", "#d5dedb", "#b8bdc7",
        "#ddd5bb", "#e0b8ba",
    ];
    let rates = crate::scraps::material_rates();
    serde_json::json!({"limits":{"maxItems":20,"maxWeight":1000,"matteMinPercent":materials::DAILY_MATTE_MIN_PERCENT,"limitedMaxPercent":materials::DAILY_LIMITED_MAX_PERCENT},"fixed":[{"id":"matte","weight":60},{"id":"kraft","weight":30},{"id":"holographic","weight":10}],"materials":materials::catalog().iter().enumerate().map(|(i,m)|serde_json::json!({"id":m.id,"name":m.name,"rarity":m.rarity,"dismantle":rates.iter().find(|r|r.id==m.id).expect("Every material needs a dismantle rate").dismantle,"swatch":colors.get(i).unwrap_or(&"#eee7d7")})).collect::<Vec<_>>()})
}
#[cfg(test)]
mod contract_tests {
    #[test]
    fn materials_match_the_owner_page_contract() {
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../cloudflare/peta-admin/test/materials-vector.json"
        ))
        .unwrap();
        assert_eq!(super::catalog_contract(),expected,"Update the material contract with: cargo run --manifest-path src-tauri/Cargo.toml -p peta-pass -- materials > cloudflare/peta-admin/test/materials-vector.json; review, then redeploy the admin page.");
    }
}
#[cfg(test)]
mod worker_contract_tests {
    use super::*;
    #[test]
    fn owner_worker_signature_decodes_and_stays_out_of_receipts() {
        let v: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../cloudflare/peta-admin/test/daily-vector.json"
        ))
        .unwrap();
        let bytes = STANDARD.decode(v["event"].as_str().unwrap()).unwrap();
        let event = events::decode(&bytes).unwrap();
        let now = DateTime::parse_from_rfc3339("2026-10-16T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut db = Database::open_in_memory().unwrap();
        accept_table(&mut db, &event, now).unwrap();
        assert_eq!(selected(&db.conn, now).unwrap().table_id, "daily-contract");
        let root = std::env::temp_dir().join(format!(
            "peta-daily-receipt-{}",
            crate::ids::new_sticker_id()
        ));
        let mut lib = crate::Library::open(&root).unwrap();
        assert!(events::apply_event(&mut lib, &event, "test", now).is_err());
        drop(lib);
        std::fs::remove_dir_all(root).unwrap();
    }
}
