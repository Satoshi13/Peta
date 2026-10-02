//! SQLite persistence: stickers, provenance, placements.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    daily::DailyRecord,
    error::{Error, Result},
    materials,
    models::{NewSticker, Placement, ProvenanceEntry, ProvenanceKind, SourceType, Sticker},
};

const SCHEMA_VERSION: i64 = 2;

const MIGRATION_V1: &str = "
CREATE TABLE stickers (
    id                  TEXT PRIMARY KEY,
    creator_id          TEXT,
    created_at          TEXT NOT NULL,
    original_asset_path TEXT NOT NULL,
    rendered_asset_path TEXT NOT NULL,
    mask_asset_path     TEXT,
    material_id         TEXT,
    original_number     INTEGER,
    edition_number      INTEGER,
    source_type         TEXT NOT NULL,
    parent_sticker_id   TEXT,
    aspect              REAL NOT NULL
);
CREATE TABLE provenance (
    sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    type       TEXT NOT NULL,
    user_id    TEXT,
    timestamp  TEXT NOT NULL,
    PRIMARY KEY (sticker_id, seq)
);
CREATE TABLE placements (
    sticker_id     TEXT PRIMARY KEY REFERENCES stickers(id) ON DELETE CASCADE,
    display_id     TEXT NOT NULL,
    relative_x     REAL NOT NULL,
    relative_y     REAL NOT NULL,
    relative_scale REAL NOT NULL,
    rotation       REAL NOT NULL,
    placed_at      TEXT NOT NULL,
    is_on_desktop  INTEGER NOT NULL DEFAULT 1,
    z              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX placements_desktop ON placements(is_on_desktop, z);
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

const MIGRATION_V2: &str = "
CREATE TABLE material_unlocks (
    material_id TEXT PRIMARY KEY,
    unlocked_at TEXT NOT NULL
);
CREATE TABLE daily_records (
    date               TEXT PRIMARY KEY,   -- local YYYY-MM-DD
    material_id        TEXT NOT NULL,
    material_opened_at TEXT,
    sticker_id         TEXT REFERENCES stickers(id) ON DELETE SET NULL,
    source_type        TEXT,
    confirmed_at       TEXT,
    used_at            TEXT
);
";

pub struct Database {
    conn: Connection,
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        let mut db = Database { conn };
        db.migrate()?;
        db.unlock_material(materials::DEFAULT_MATERIAL)?; // idempotent
        Ok(db)
    }

    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(Error::Invalid(format!(
                "database schema v{version} is newer than this Peta (v{SCHEMA_VERSION})"
            )));
        }
        if version < 1 {
            let tx = self.conn.transaction()?;
            tx.execute_batch(MIGRATION_V1)?;
            tx.pragma_update(None, "user_version", 1)?;
            tx.commit()?;
        }
        if version < 2 {
            let tx = self.conn.transaction()?;
            tx.execute_batch(MIGRATION_V2)?;
            tx.pragma_update(None, "user_version", 2)?;
            tx.commit()?;
        }
        Ok(())
    }

    pub fn sticker_id_exists(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM stickers WHERE id = ?1", [id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn sticker_count(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM stickers", [], |r| r.get(0))?)
    }

    /// Insert a sticker. Stickers the user made (`Created`) get the next `ORIGINAL` number.
    pub fn create_sticker(&mut self, new: NewSticker) -> Result<Sticker> {
        let created_at = now();
        let tx = self.conn.transaction()?;

        let original_number = if new.source_type == SourceType::Created {
            let next: i64 = tx
                .query_row("SELECT value FROM meta WHERE key = 'next_original_number'", [], |r| {
                    r.get::<_, String>(0)
                })
                .optional()?
                .and_then(|v| v.parse().ok())
                .unwrap_or(1);
            tx.execute(
                "INSERT INTO meta(key, value) VALUES('next_original_number', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [(next + 1).to_string()],
            )?;
            Some(next)
        } else {
            None
        };

        tx.execute(
            "INSERT INTO stickers (id, creator_id, created_at, original_asset_path, rendered_asset_path,
                                   mask_asset_path, material_id, original_number, source_type, aspect)
             VALUES (?1, ?2, ?3, ?4, ?5, ?10, ?6, ?7, ?8, ?9)",
            params![
                new.id,
                new.creator_id,
                created_at,
                new.original_asset_path,
                new.rendered_asset_path,
                new.material_id,
                original_number,
                new.source_type.as_str(),
                new.aspect,
                new.mask_asset_path,
            ],
        )?;
        tx.execute(
            "INSERT INTO provenance (sticker_id, seq, type, user_id, timestamp) VALUES (?1, 0, 'created', ?2, ?3)",
            params![new.id, new.creator_id, created_at],
        )?;
        tx.commit()?;
        self.sticker(&new.id)?.ok_or_else(|| Error::Invalid("sticker vanished after insert".into()))
    }

    pub fn sticker(&self, id: &str) -> Result<Option<Sticker>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, creator_id, created_at, original_asset_path, rendered_asset_path, mask_asset_path,
                        material_id, original_number, edition_number, source_type, parent_sticker_id, aspect
                 FROM stickers WHERE id = ?1",
                [id],
                |r| {
                    Ok(Sticker {
                        id: r.get(0)?,
                        creator_id: r.get(1)?,
                        created_at: r.get(2)?,
                        original_asset_path: r.get(3)?,
                        rendered_asset_path: r.get(4)?,
                        mask_asset_path: r.get(5)?,
                        material_id: r.get(6)?,
                        original_number: r.get(7)?,
                        edition_number: r.get(8)?,
                        source_type: SourceType::parse(&r.get::<_, String>(9)?).unwrap_or(SourceType::Created),
                        parent_sticker_id: r.get(10)?,
                        aspect: r.get(11)?,
                        provenance: Vec::new(),
                    })
                },
            )
            .optional()?;
        let Some(mut sticker) = row else { return Ok(None) };

        let mut stmt = self
            .conn
            .prepare("SELECT type, user_id, timestamp FROM provenance WHERE sticker_id = ?1 ORDER BY seq")?;
        sticker.provenance = stmt
            .query_map([id], |r| {
                Ok(ProvenanceEntry {
                    kind: ProvenanceKind::parse(&r.get::<_, String>(0)?).unwrap_or(ProvenanceKind::Created),
                    user_id: r.get(1)?,
                    timestamp: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(Some(sticker))
    }

    pub fn material_of(&self, id: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT material_id FROM stickers WHERE id = ?1", [id], |r| r.get::<_, Option<String>>(0))
            .optional()?
            .flatten())
    }

    pub fn rendered_asset_path(&self, id: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT rendered_asset_path FROM stickers WHERE id = ?1", [id], |r| r.get(0))
            .optional()?)
    }

    /// Put a sticker on the desktop (or move / resize / rotate it). Always brings it to the top.
    /// `placed_at` is when it was last stuck down (kept while it stays on the desktop).
    pub fn place(&mut self, mut p: Placement) -> Result<Placement> {
        if p.placed_at.is_empty() {
            p.placed_at = now();
        }
        let tx = self.conn.transaction()?;
        let z: i64 = tx.query_row("SELECT COALESCE(MAX(z), 0) + 1 FROM placements", [], |r| r.get(0))?;
        tx.execute(
            "INSERT INTO placements (sticker_id, display_id, relative_x, relative_y, relative_scale,
                                     rotation, placed_at, is_on_desktop, z)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)
             ON CONFLICT(sticker_id) DO UPDATE SET
                display_id = excluded.display_id,
                relative_x = excluded.relative_x,
                relative_y = excluded.relative_y,
                relative_scale = excluded.relative_scale,
                rotation = excluded.rotation,
                placed_at = CASE WHEN placements.is_on_desktop = 0 THEN excluded.placed_at ELSE placements.placed_at END,
                is_on_desktop = 1,
                z = excluded.z",
            params![p.sticker_id, p.display_id, p.relative_x, p.relative_y, p.relative_scale, p.rotation, p.placed_at, z],
        )?;
        let saved = Self::read_placement(&tx, &p.sticker_id)?;
        tx.commit()?;
        saved.ok_or_else(|| Error::Invalid("placement vanished after insert".into()))
    }

    /// Peel off: the sticker leaves the desktop but stays in the collection.
    pub fn peel(&mut self, sticker_id: &str) -> Result<()> {
        self.conn
            .execute("UPDATE placements SET is_on_desktop = 0 WHERE sticker_id = ?1", [sticker_id])?;
        Ok(())
    }

    /// Stickers currently on the desktop, bottom -> top.
    pub fn on_desktop(&self) -> Result<Vec<Placement>> {
        let mut stmt = self.conn.prepare(
            "SELECT sticker_id, display_id, relative_x, relative_y, relative_scale, rotation, placed_at, is_on_desktop, z
             FROM placements WHERE is_on_desktop = 1 ORDER BY z",
        )?;
        let rows = stmt
            .query_map([], Self::map_placement)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Stickers that exist but are not on the desktop (peeled off, never stuck), newest first.
    pub fn off_desktop(&self) -> Result<Vec<Sticker>> {
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT s.id FROM stickers s LEFT JOIN placements p ON p.sticker_id = s.id
                 WHERE p.sticker_id IS NULL OR p.is_on_desktop = 0
                 ORDER BY s.created_at DESC, s.id",
            )?;
            let rows = stmt.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
            rows
        };
        ids.iter().filter_map(|id| self.sticker(id).transpose()).collect()
    }

    // ---- materials ----

    /// Returns true if it was newly unlocked.
    pub fn unlock_material(&mut self, material_id: &str) -> Result<bool> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO material_unlocks (material_id, unlocked_at) VALUES (?1, ?2)",
            params![material_id, now()],
        )?;
        Ok(n > 0)
    }

    pub fn unlocked_material_ids(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT material_id FROM material_unlocks ORDER BY material_id")?;
        let rows = stmt.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    pub fn material_unlocked_at(&self, material_id: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT unlocked_at FROM material_unlocks WHERE material_id = ?1", [material_id], |r| r.get(0))
            .optional()?)
    }

    // ---- daily records (see `daily` for the rules) ----

    pub fn daily_get(&self, date: &str) -> Result<Option<DailyRecord>> {
        Ok(self
            .conn
            .query_row(
                "SELECT date, material_id, material_opened_at, sticker_id, source_type, confirmed_at, used_at
                 FROM daily_records WHERE date = ?1",
                [date],
                |r| {
                    Ok(DailyRecord {
                        date: r.get(0)?,
                        material_id: r.get(1)?,
                        material_opened_at: r.get(2)?,
                        sticker_id: r.get(3)?,
                        source_type: r.get::<_, Option<String>>(4)?.and_then(|s| SourceType::parse(&s)),
                        confirmed_at: r.get(5)?,
                        used_at: r.get(6)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn daily_count(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM daily_records", [], |r| r.get(0))?)
    }

    pub fn daily_insert(&mut self, date: &str, material_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO daily_records (date, material_id) VALUES (?1, ?2)",
            params![date, material_id],
        )?;
        Ok(())
    }

    pub fn daily_set_opened(&mut self, date: &str, ts: &str) -> Result<()> {
        self.conn
            .execute("UPDATE daily_records SET material_opened_at = ?2 WHERE date = ?1", params![date, ts])?;
        Ok(())
    }

    pub fn daily_set_confirmed(&mut self, date: &str, sticker_id: &str, source: SourceType, ts: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE daily_records SET sticker_id = ?2, source_type = ?3, confirmed_at = ?4 WHERE date = ?1",
            params![date, sticker_id, source.as_str(), ts],
        )?;
        Ok(())
    }

    pub fn daily_set_used(&mut self, date: &str, ts: &str) -> Result<()> {
        self.conn.execute("UPDATE daily_records SET used_at = ?2 WHERE date = ?1", params![date, ts])?;
        Ok(())
    }

    /// Developer tool: forget a day (its sticker, if any, stays).
    pub fn daily_delete(&mut self, date: &str) -> Result<()> {
        self.conn.execute("DELETE FROM daily_records WHERE date = ?1", [date])?;
        Ok(())
    }

    fn read_placement(conn: &Connection, id: &str) -> Result<Option<Placement>> {
        Ok(conn
            .query_row(
                "SELECT sticker_id, display_id, relative_x, relative_y, relative_scale, rotation, placed_at, is_on_desktop, z
                 FROM placements WHERE sticker_id = ?1",
                [id],
                Self::map_placement,
            )
            .optional()?)
    }

    fn map_placement(r: &rusqlite::Row<'_>) -> rusqlite::Result<Placement> {
        Ok(Placement {
            sticker_id: r.get(0)?,
            display_id: r.get(1)?,
            relative_x: r.get(2)?,
            relative_y: r.get(3)?,
            relative_scale: r.get(4)?,
            rotation: r.get(5)?,
            placed_at: r.get(6)?,
            is_on_desktop: r.get::<_, i64>(7)? != 0,
            z: r.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new(id: &str, source: SourceType) -> NewSticker {
        NewSticker {
            id: id.into(),
            creator_id: Some("me".into()),
            original_asset_path: format!("stickers/{id}/original.png"),
            rendered_asset_path: format!("stickers/{id}/rendered.png"),
            mask_asset_path: None,
            material_id: None,
            source_type: source,
            aspect: 0.8,
        }
    }

    fn placement(id: &str) -> Placement {
        Placement {
            sticker_id: id.into(),
            display_id: "d1".into(),
            relative_x: 0.5,
            relative_y: 0.5,
            relative_scale: 0.1,
            rotation: 0.0,
            placed_at: String::new(),
            is_on_desktop: true,
            z: 0,
        }
    }

    #[test]
    fn original_numbers_are_sequential_and_only_for_created() {
        let mut db = Database::open_in_memory().unwrap();
        assert_eq!(db.create_sticker(new("A", SourceType::Created)).unwrap().original_number, Some(1));
        assert_eq!(db.create_sticker(new("B", SourceType::Created)).unwrap().original_number, Some(2));
        assert_eq!(db.create_sticker(new("C", SourceType::Gift)).unwrap().original_number, None);
        assert_eq!(db.create_sticker(new("D", SourceType::Created)).unwrap().original_number, Some(3));
        assert_eq!(db.sticker_count().unwrap(), 4);
    }

    #[test]
    fn creating_a_sticker_records_provenance() {
        let mut db = Database::open_in_memory().unwrap();
        let s = db.create_sticker(new("A", SourceType::Created)).unwrap();
        assert_eq!(s.provenance.len(), 1);
        assert_eq!(s.provenance[0].kind, ProvenanceKind::Created);
        assert_eq!(s.provenance[0].user_id.as_deref(), Some("me"));
        assert_eq!(db.sticker("nope").unwrap(), None);
    }

    #[test]
    fn place_brings_to_front_and_keeps_stacking_order() {
        let mut db = Database::open_in_memory().unwrap();
        for id in ["A", "B", "C"] {
            db.create_sticker(new(id, SourceType::Created)).unwrap();
            db.place(placement(id)).unwrap();
        }
        let order = |db: &Database| db.on_desktop().unwrap().into_iter().map(|p| p.sticker_id).collect::<Vec<_>>();
        assert_eq!(order(&db), ["A", "B", "C"]);
        // touching A (move) brings it to the top
        let mut a = placement("A");
        a.relative_x = 0.9;
        db.place(a).unwrap();
        assert_eq!(order(&db), ["B", "C", "A"]);
        assert_eq!(db.on_desktop().unwrap().last().unwrap().relative_x, 0.9);
    }

    #[test]
    fn moving_keeps_placed_at_but_restick_after_peel_resets_it() {
        let mut db = Database::open_in_memory().unwrap();
        db.create_sticker(new("A", SourceType::Created)).unwrap();
        let first = db.place(placement("A")).unwrap();
        let mut moved = placement("A");
        moved.placed_at = "2999-01-01T00:00:00+00:00".into();
        assert_eq!(db.place(moved.clone()).unwrap().placed_at, first.placed_at);
        db.peel("A").unwrap();
        assert_eq!(db.place(moved).unwrap().placed_at, "2999-01-01T00:00:00+00:00");
    }

    #[test]
    fn peel_removes_from_desktop_but_keeps_the_sticker() {
        let mut db = Database::open_in_memory().unwrap();
        db.create_sticker(new("A", SourceType::Created)).unwrap();
        db.place(placement("A")).unwrap();
        db.peel("A").unwrap();
        assert!(db.on_desktop().unwrap().is_empty());
        assert!(db.sticker("A").unwrap().is_some());
        assert_eq!(db.sticker_count().unwrap(), 1);
    }

    #[test]
    fn off_desktop_lists_peeled_and_never_stuck_stickers() {
        let mut db = Database::open_in_memory().unwrap();
        for id in ["A", "B", "C"] {
            db.create_sticker(new(id, SourceType::Created)).unwrap();
        }
        db.place(placement("A")).unwrap();
        db.place(placement("B")).unwrap();
        db.peel("B").unwrap();
        let mut ids: Vec<_> = db.off_desktop().unwrap().into_iter().map(|s| s.id).collect();
        ids.sort();
        assert_eq!(ids, ["B", "C"]); // peeled + never stuck; A is on the desktop
    }

    #[test]
    fn upgrades_a_v1_database_without_losing_data() {
        let dir = std::env::temp_dir().join(format!("peta-core-mig-{}", crate::ids::new_sticker_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("peta.db");
        {
            // a database exactly as Phase 1 left it
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(MIGRATION_V1).unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
            conn.execute(
                "INSERT INTO stickers (id, created_at, original_asset_path, rendered_asset_path, source_type, aspect)
                 VALUES ('OLD', 'x', 'o', 'r', 'created', 1.0)",
                [],
            )
            .unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert!(db.sticker("OLD").unwrap().is_some());
        assert_eq!(db.unlocked_material_ids().unwrap(), ["matte"]);
        assert_eq!(db.daily_count().unwrap(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn data_survives_reopen_and_numbering_continues() {
        let dir = std::env::temp_dir().join(format!("peta-core-test-{}", crate::ids::new_sticker_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("peta.db");
        {
            let mut db = Database::open(&path).unwrap();
            db.create_sticker(new("A", SourceType::Created)).unwrap();
            db.place(placement("A")).unwrap();
        }
        let mut db = Database::open(&path).unwrap();
        assert_eq!(db.on_desktop().unwrap().len(), 1);
        assert_eq!(db.create_sticker(new("B", SourceType::Created)).unwrap().original_number, Some(2));
        let _ = std::fs::remove_dir_all(dir);
    }
}
