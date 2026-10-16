-- Device-bound, short-lived update access; page downloads retain their existing meaning.
CREATE TABLE update_tokens(token TEXT PRIMARY KEY, key_hash TEXT NOT NULL, version TEXT NOT NULL, file TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX update_tokens_expiry ON update_tokens(expires_at);
CREATE TABLE update_downloads(key_hash TEXT NOT NULL, version TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX update_downloads_version ON update_downloads(version, key_hash);
