CREATE TABLE daily_tables(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('default','event')), starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, event TEXT NOT NULL, created_at INTEGER NOT NULL, stopped_at INTEGER);
CREATE INDEX daily_tables_period ON daily_tables(kind, stopped_at, starts_at, ends_at);
