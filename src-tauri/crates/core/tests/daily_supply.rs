//! A valid signed cache must not enable remote supply in an offline core build.
#[cfg(feature = "developer")]
#[test]
fn offline_ignores_verified_cache_while_server_uses_it() {
    use peta_core::{
        daily,
        daily_tables::{DailyTable, Item, TableKind},
        events,
        sign::Signer,
        Database,
    };
    let hex = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    let mut seed = [0; 32];
    for (i, b) in seed.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap();
    }
    let key = ed25519_dalek::SigningKey::from_bytes(&seed);
    let now = chrono::Utc::now();
    let table = DailyTable {
        table_id: "offline-supply-test".into(),
        table_kind: TableKind::Default,
        items: vec![
            Item {
                id: "matte".into(),
                weight: 20,
            },
            Item {
                id: "riso".into(),
                weight: 80,
            },
        ],
    };
    let e = events::Event {
        event_id: table.table_id.clone(),
        kind: "daily_table".into(),
        issued_at: now.to_rfc3339(),
        not_before: Some((now - chrono::Duration::minutes(1)).to_rfc3339()),
        not_after: Some((now + chrono::Duration::days(1)).to_rfc3339()),
        title: "Daily supply test".into(),
        message: "".into(),
        payload: serde_json::to_value(table).unwrap(),
        signer: Signer::Official {
            key_id: "c1".into(),
        },
        attachments: vec![],
    };
    let verified = events::decode(&events::encode(&e, &[], &key).unwrap()).unwrap();
    let mut db = Database::open_in_memory().unwrap();
    daily::accept_table(&mut db, &verified, now).unwrap();
    daily::ensure_today(&mut db, "2026-10-15", 0.0).unwrap();
    let record = daily::ensure_today(&mut db, "2026-10-16", 0.99).unwrap();
    assert_eq!(
        record.material_id,
        if cfg!(feature = "daily-tables") {
            "riso"
        } else {
            "holographic"
        }
    );
}
