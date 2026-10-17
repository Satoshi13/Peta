-- A display flag copied from the verified signing summary. Clients trust the signed payload.
ALTER TABLE shop_packs ADD COLUMN free INTEGER NOT NULL DEFAULT 0 CHECK(free IN (0,1));
