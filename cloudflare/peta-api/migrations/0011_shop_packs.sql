-- Official shop packs (docs/official-packs-howto.md). Drafts are made on the admin page (pictures and pack.json in R2
-- shop/drafts/<draft_id>/); scripts/sign-pack.sh signs a ready draft on the owner's Mac and puts the file at
-- shop/<pack_id>/<version>.peta. A signed pack is on sale while starts_at <= now < ends_at (no end: NULL) and not stopped.
CREATE TABLE shop_pack_drafts(draft_id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('draft','ready','signed','discarded')), manifest TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX shop_pack_drafts_pack ON shop_pack_drafts(pack_id, version);
CREATE TABLE shop_packs(pack_id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, starts_at INTEGER, ends_at INTEGER, created_at INTEGER NOT NULL, stopped_at INTEGER, draft_id TEXT, key_id TEXT, PRIMARY KEY(pack_id, version));
CREATE INDEX shop_packs_sale ON shop_packs(stopped_at, starts_at, ends_at);
-- Device-bound, ten-minute access to the files listed in one /v1/config answer (the token itself is never stored).
CREATE TABLE shop_pack_tokens(token TEXT PRIMARY KEY, key_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX shop_pack_tokens_expiry ON shop_pack_tokens(expires_at);
