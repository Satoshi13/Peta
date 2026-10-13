-- Release hardening: bounded, idempotent reports and resolution retention.
ALTER TABLE reports ADD COLUMN content_hash TEXT;
ALTER TABLE reports ADD COLUMN resolved_at INTEGER;
ALTER TABLE reports ADD COLUMN stored INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX reports_content ON reports(reporter_hash,sender_hash,content_hash);
CREATE INDEX reports_daily ON reports(reporter_hash,created_at);
CREATE INDEX reports_resolution ON reports(resolved_at);
-- Delivery evidence survives revocation, without keeping an envelope or content key.
CREATE TABLE report_listing_access(listing_id TEXT NOT NULL,recipient_hash TEXT NOT NULL,sender_hash TEXT NOT NULL,PRIMARY KEY(listing_id,recipient_hash,sender_hash));
INSERT INTO report_listing_access SELECT e.listing_id,e.recipient_hash,l.seller_hash FROM market_envelopes e JOIN market_listings l USING(listing_id);
CREATE TRIGGER remember_report_listing_access AFTER INSERT ON market_envelopes BEGIN
 INSERT OR IGNORE INTO report_listing_access SELECT NEW.listing_id,NEW.recipient_hash,l.seller_hash FROM market_listings l WHERE l.listing_id=NEW.listing_id;
END;
