-- S2: friends and the Gift inbox. The server holds addresses, allow lists and sealed boxes it cannot read; R2 holds the sealed gifts.
CREATE TABLE mailboxes(id TEXT PRIMARY KEY, sign_key TEXT NOT NULL UNIQUE, enc_key TEXT NOT NULL, name TEXT NOT NULL, binding TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE mailbox_allow(mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, key_hash TEXT NOT NULL, PRIMARY KEY(mailbox_id, key_hash));
CREATE TABLE mailbox_blocks(mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, key_hash TEXT NOT NULL, PRIMARY KEY(mailbox_id, key_hash));
CREATE TABLE friend_requests(mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, id TEXT NOT NULL, sender_hash TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(mailbox_id, id));
CREATE INDEX friend_requests_expiry ON friend_requests(expires_at);
CREATE TABLE messages(mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, id TEXT NOT NULL, sender_hash TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(mailbox_id, id));
CREATE INDEX messages_expiry ON messages(expires_at);
CREATE TABLE reports(id TEXT PRIMARY KEY, reporter_hash TEXT NOT NULL, sender_hash TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
