-- S3: ciphertext in R2, per-recipient envelopes and an atomic slot/sale ledger.
CREATE TABLE market_listings(
 listing_id TEXT PRIMARY KEY,pack_id TEXT NOT NULL UNIQUE REFERENCES packs(pack_id),
 seller_key TEXT NOT NULL,seller_hash TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),
 cut_permille INTEGER NOT NULL CHECK(cut_permille BETWEEN 0 AND 1000),
 state TEXT NOT NULL CHECK(state IN ('draft','open','paused','closed')),
 card_digest TEXT NOT NULL,card_size INTEGER NOT NULL,pack_digest TEXT NOT NULL,pack_size INTEGER NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE TABLE market_envelopes(listing_id TEXT NOT NULL REFERENCES market_listings(listing_id),recipient_hash TEXT NOT NULL,sealed TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(listing_id,recipient_hash));
CREATE INDEX market_envelope_recipient ON market_envelopes(recipient_hash);
CREATE TABLE market_sales(sale_id INTEGER PRIMARY KEY AUTOINCREMENT,listing_id TEXT NOT NULL REFERENCES market_listings(listing_id),pack_id TEXT NOT NULL REFERENCES packs(pack_id),slot_no INTEGER NOT NULL,pull_id TEXT NOT NULL UNIQUE,buyer_hash TEXT NOT NULL,seller_key TEXT NOT NULL,price INTEGER NOT NULL,cut_milli INTEGER NOT NULL,at INTEGER NOT NULL,UNIQUE(pack_id,slot_no));
CREATE INDEX market_sale_seller ON market_sales(seller_key,sale_id);
CREATE INDEX market_sale_buyer ON market_sales(buyer_hash,at);
CREATE TABLE market_payout_marks(seller_key TEXT PRIMARY KEY,acked_upto INTEGER NOT NULL DEFAULT 0);
ALTER TABLE reports ADD COLUMN kind TEXT NOT NULL DEFAULT 'gift';
ALTER TABLE reports ADD COLUMN listing_id TEXT;
DROP TRIGGER assert_ledger;
CREATE TRIGGER assert_ledger BEFORE INSERT ON assertions WHEN NEW.ok=0 BEGIN
 SELECT (CASE NEW.code
 WHEN 'taken' THEN RAISE(ABORT,'taken') WHEN 'not_yours' THEN RAISE(ABORT,'not_yours')
 WHEN 'unknown' THEN RAISE(ABORT,'unknown') WHEN 'unknown_pack' THEN RAISE(ABORT,'unknown_pack')
 WHEN 'already_claimed' THEN RAISE(ABORT,'already_claimed') WHEN 'slot_taken' THEN RAISE(ABORT,'slot_taken')
 WHEN 'already_opened' THEN RAISE(ABORT,'already_opened') WHEN 'seq_mismatch' THEN RAISE(ABORT,'seq_mismatch')
 WHEN 'ref_mismatch' THEN RAISE(ABORT,'ref_mismatch') WHEN 'for_sale' THEN RAISE(ABORT,'for_sale')
 WHEN 'not_friend' THEN RAISE(ABORT,'not_friend') WHEN 'listing_closed' THEN RAISE(ABORT,'listing_closed')
 WHEN 'price_changed' THEN RAISE(ABORT,'price_changed') WHEN 'pull_used' THEN RAISE(ABORT,'pull_used')
 WHEN 'too_many_pulls' THEN RAISE(ABORT,'too_many_pulls') WHEN 'too_many_listings' THEN RAISE(ABORT,'too_many_listings')
 WHEN 'sold_out' THEN RAISE(ABORT,'sold_out') WHEN 'own_pack' THEN RAISE(ABORT,'own_pack')
 WHEN 'blocked' THEN RAISE(ABORT,'blocked') ELSE RAISE(ABORT,'invalid') END);
END;
