-- Owner actions contain only bounded metadata and email hashes, never secrets or raw provider errors.
CREATE TABLE admin_log(at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX admin_log_at ON admin_log(at);
-- Serialize admin mutations across Worker instances; the lease recovers after an interrupted request.
CREATE TABLE admin_locks(name TEXT PRIMARY KEY, token TEXT NOT NULL, until INTEGER NOT NULL);
