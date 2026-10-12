-- S1 ledger schema is filled in Step 3.
CREATE TABLE IF NOT EXISTS ledger_schema (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO ledger_schema VALUES (1);
