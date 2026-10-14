-- Short coupon names for signed official bundles. The server keeps only the signed event the owner made offline with
-- peta-pass (it cannot make one), when it may be claimed, how many Macs may claim it, and which Macs did.
CREATE TABLE coupons(
  name TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  starts_at INTEGER,
  ends_at INTEGER NOT NULL,
  max_claims INTEGER,
  claims INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  stopped_at INTEGER
);
CREATE TABLE coupon_claims(name TEXT NOT NULL,key_hash TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(name,key_hash));
-- The ledger assertion learns the invite (0005) and coupon codes, which otherwise surfaced as 'invalid'.
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
 WHEN 'blocked' THEN RAISE(ABORT,'blocked')
 WHEN 'invite_used' THEN RAISE(ABORT,'invite_used') WHEN 'coupon_used_up' THEN RAISE(ABORT,'coupon_used_up') ELSE RAISE(ABORT,'invalid') END);
END;
