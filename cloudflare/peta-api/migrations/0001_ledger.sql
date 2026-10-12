CREATE TABLE stickers (
 id TEXT PRIMARY KEY, creator_key TEXT NOT NULL, creator_sig TEXT NOT NULL, creation TEXT NOT NULL,
 holder_key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('held','released')), seq INTEGER NOT NULL DEFAULT 0,
 release_ref TEXT, registered_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE transfers (
 sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('release','claim')), actor_key TEXT NOT NULL, ref TEXT NOT NULL,
 at TEXT NOT NULL, sig TEXT NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY(sticker_id,seq)
);
CREATE TABLE packs (pack_id TEXT PRIMARY KEY,creator_key TEXT NOT NULL,slot_count INTEGER NOT NULL CHECK(slot_count BETWEEN 1 AND 200),header_digest TEXT NOT NULL,registration_digest TEXT NOT NULL,registered_at INTEGER NOT NULL);
CREATE TABLE pack_slots (pack_id TEXT NOT NULL REFERENCES packs(pack_id) ON DELETE CASCADE,slot_no INTEGER NOT NULL,sticker_id TEXT REFERENCES stickers(id) ON DELETE SET NULL,minted INTEGER NOT NULL DEFAULT 0,release_sig TEXT,claimer_key TEXT,claim_sig TEXT,claimed_at INTEGER,PRIMARY KEY(pack_id,slot_no));
CREATE TABLE nonces(key_hash TEXT NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(key_hash,nonce));
CREATE INDEX nonces_expiry ON nonces(expires_at);
CREATE TABLE blocked_keys(key_hash TEXT PRIMARY KEY,reason TEXT,at INTEGER NOT NULL);
CREATE TABLE rate_counters(key_hash TEXT NOT NULL,kind TEXT NOT NULL,window INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key_hash,kind,window));
CREATE INDEX rates_expiry ON rate_counters(window);
-- A failed assertion is an SQL error, so D1 rolls back the entire batch.
CREATE TABLE assertions(code TEXT NOT NULL,ok INTEGER NOT NULL);
CREATE TRIGGER assert_ledger BEFORE INSERT ON assertions WHEN NEW.ok=0 BEGIN
 SELECT (CASE NEW.code
 WHEN 'taken' THEN RAISE(ABORT,'taken') WHEN 'not_yours' THEN RAISE(ABORT,'not_yours')
 WHEN 'unknown' THEN RAISE(ABORT,'unknown') WHEN 'unknown_pack' THEN RAISE(ABORT,'unknown_pack')
 WHEN 'already_claimed' THEN RAISE(ABORT,'already_claimed') WHEN 'slot_taken' THEN RAISE(ABORT,'slot_taken')
 WHEN 'already_opened' THEN RAISE(ABORT,'already_opened') WHEN 'seq_mismatch' THEN RAISE(ABORT,'seq_mismatch')
 WHEN 'ref_mismatch' THEN RAISE(ABORT,'ref_mismatch') ELSE RAISE(ABORT,'invalid') END);
END;
CREATE TRIGGER transfer_transition BEFORE INSERT ON transfers
WHEN NOT EXISTS(SELECT 1 FROM transfers WHERE sticker_id=NEW.sticker_id AND seq=NEW.seq AND sig=NEW.sig) BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM stickers WHERE id=NEW.sticker_id) THEN RAISE(ABORT,'unknown') END);
 SELECT (CASE WHEN NEW.kind='claim' AND EXISTS(SELECT 1 FROM stickers WHERE id=NEW.sticker_id AND state='held') THEN RAISE(ABORT,'already_claimed') END);
 SELECT (CASE WHEN NEW.kind='release' AND NOT EXISTS(SELECT 1 FROM stickers WHERE id=NEW.sticker_id AND holder_key=NEW.actor_key) THEN RAISE(ABORT,'not_yours') END);
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM stickers WHERE id=NEW.sticker_id AND seq=NEW.seq) THEN RAISE(ABORT,'seq_mismatch') END);
 SELECT (CASE WHEN NEW.kind='claim' AND NOT EXISTS(SELECT 1 FROM stickers WHERE id=NEW.sticker_id AND release_ref=NEW.ref) THEN RAISE(ABORT,'ref_mismatch') END);
 SELECT (CASE WHEN NEW.kind='release' AND NOT EXISTS(SELECT 1 FROM stickers WHERE id=NEW.sticker_id AND state='held') THEN RAISE(ABORT,'already_released') END);
 SELECT (CASE WHEN NEW.kind='claim' AND EXISTS(SELECT 1 FROM pack_slots WHERE sticker_id=NEW.sticker_id AND release_sig=(SELECT sig FROM transfers WHERE sticker_id=NEW.sticker_id AND seq=NEW.seq-1) AND (claimer_key IS NULL OR claimer_key!=NEW.actor_key OR claim_sig!=NEW.sig)) THEN RAISE(ABORT,'slot_taken') END);
 UPDATE stickers SET state=(CASE NEW.kind WHEN 'claim' THEN 'held' ELSE 'released' END),holder_key=(CASE NEW.kind WHEN 'claim' THEN NEW.actor_key ELSE holder_key END),seq=seq+1,release_ref=(CASE NEW.kind WHEN 'release' THEN NEW.ref ELSE NULL END),updated_at=NEW.received_at WHERE id=NEW.sticker_id AND seq=NEW.seq AND ((NEW.kind='claim' AND state='released' AND release_ref=NEW.ref) OR (NEW.kind='release' AND state='held' AND holder_key=NEW.actor_key));
 SELECT (CASE WHEN changes()!=1 THEN RAISE(ABORT,'seq_mismatch') END);
END;

CREATE TRIGGER transfer_time BEFORE INSERT ON transfers BEGIN
 SELECT (CASE WHEN julianday(NEW.at)<COALESCE((SELECT julianday(at) FROM transfers WHERE sticker_id=NEW.sticker_id AND seq=NEW.seq-1),(SELECT julianday(json_extract(creation,'$.createdAt')) FROM stickers WHERE id=NEW.sticker_id)) THEN RAISE(ABORT,'time_order') END);
END;

-- Exact-operation fences survive cancellation, including requests that arrive late.
CREATE TABLE cancelled_releases(sig TEXT PRIMARY KEY,sticker_id TEXT NOT NULL,actor_key TEXT NOT NULL);
CREATE TABLE cancelled_packs(pack_id TEXT NOT NULL,registration_digest TEXT NOT NULL,creator_key TEXT NOT NULL,PRIMARY KEY(pack_id,registration_digest));
CREATE TRIGGER release_fence BEFORE INSERT ON transfers WHEN NEW.kind='release' BEGIN
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM cancelled_releases WHERE sig=NEW.sig) THEN RAISE(ABORT,'cancelled') END);
END;
