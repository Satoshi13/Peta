//! Small internal settings shared by bounded background checkers.
use crate::{Database, Result};
use rusqlite::OptionalExtension;
impl Database {
    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
            .optional()?)
    }
    pub fn set_setting(&mut self, key: &str, value: &str) -> Result<()> {
        self.conn.execute("INSERT INTO meta(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,value])?;
        Ok(())
    }
}
