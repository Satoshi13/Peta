-- Private beta: one invite per friend who passed Cloudflare Access on the download page, keyed by a hash of
-- their Access email (never the email itself), bound to one signing key at a time. A new code unbinds the old Mac.
CREATE TABLE invites(
  email_hash TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  key_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  bound_at INTEGER,
  revoked_at INTEGER
);
-- Whole disk-image downloads from the download page, so the owner can see who fetched which version.
CREATE TABLE downloads(email_hash TEXT NOT NULL,version TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX downloads_by_friend ON downloads(email_hash,at);
