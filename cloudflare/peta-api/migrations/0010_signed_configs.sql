-- Owner settings signed with the coupon key: the in-app announcement and the shop configuration.
CREATE TABLE signed_configs(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('announcement','shop_config')), starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, event TEXT NOT NULL, created_at INTEGER NOT NULL, stopped_at INTEGER);
CREATE INDEX signed_configs_period ON signed_configs(kind, stopped_at, ends_at, starts_at);
