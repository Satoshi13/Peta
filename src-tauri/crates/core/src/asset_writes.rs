//! Asset files become permanent only with the database records that reference them.
use std::{collections::HashSet,path::{Component,Path,PathBuf}};
use rusqlite::Transaction;
use crate::{export::Export,Library,Result};

pub(crate) struct AssetWrites {
    root:PathBuf,
    paths:HashSet<PathBuf>,
    writes:Vec<(String,Export)>,
}
impl AssetWrites {
    pub fn new(lib:&Library)->Self {Self{root:lib.root().to_owned(),paths:HashSet::new(),writes:Vec::new()}}
    pub fn write(&mut self,rel:&str,bytes:&[u8])->Result<()> {
        let path=Path::new(rel);let normalized:PathBuf=path.components().collect();
        if rel.is_empty()||path.components().any(|c|!matches!(c,Component::Normal(_)))||!self.paths.insert(normalized) {
            return Err(crate::Error::Invalid("Invalid or repeated asset path.".into()));
        }
        let target=self.root.join("assets").join(rel);std::fs::create_dir_all(target.parent().unwrap())?;
        let receipt=format!("asset-write.{}",crate::ids::new_gift_id());
        let guard=Export::publish(&self.root,&target,bytes,&receipt)?;self.writes.push((receipt,guard));Ok(())
    }
    pub fn commit(self,tx:Transaction<'_>)->Result<()> {
        for (receipt,_) in &self.writes {tx.execute("INSERT INTO meta VALUES (?1,'1')",[format!("export.{receipt}")])?;}
        tx.commit()?;
        for (_,guard) in self.writes {guard.finish();}Ok(())
    }
}

#[cfg(test)] mod tests {
    use super::*;
    fn lib()->Library {Library::open(&std::env::temp_dir().join(crate::ids::new_gift_id())).unwrap()}
    #[test] fn failed_write_or_sql_restores_existing_assets_and_removes_new_ones() {
        let mut lib=lib();let old=lib.root().join("assets/old.png");std::fs::write(&old,b"old").unwrap();
        {let mut writes=AssetWrites::new(&lib);writes.write("old.png",b"changed").unwrap();writes.write("new.png",b"new").unwrap();assert!(writes.write("new.png",b"twice").is_err());}
        assert_eq!(std::fs::read(&old).unwrap(),b"old");assert!(!lib.root().join("assets/new.png").exists());
        let mut writes=AssetWrites::new(&lib);writes.write("old.png",b"changed").unwrap();writes.write("new.png",b"new").unwrap();
        lib.db().conn.execute_batch("CREATE TRIGGER fail_asset BEFORE INSERT ON meta WHEN NEW.key LIKE 'export.asset-write.%' BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        let tx=lib.db_mut().conn.transaction().unwrap();assert!(writes.commit(tx).is_err());
        assert_eq!(std::fs::read(&old).unwrap(),b"old");assert!(!lib.root().join("assets/new.png").exists());
        assert_eq!(std::fs::read_dir(lib.root().join("exports")).unwrap().count(),0);
    }
    #[test] fn assets_and_receipts_commit_together_and_paths_cannot_escape() {
        let mut lib=lib();let mut writes=AssetWrites::new(&lib);
        for rel in ["","/tmp/escape","../escape","nested/../../escape"] {assert!(writes.write(rel,b"bad").is_err());}
        writes.write("nested/new.png",b"new").unwrap();assert!(writes.write("nested/./new.png",b"repeated").is_err());let tx=lib.db_mut().conn.transaction().unwrap();writes.commit(tx).unwrap();
        assert_eq!(std::fs::read(lib.root().join("assets/nested/new.png")).unwrap(),b"new");
        assert_eq!(lib.db().conn.query_row("SELECT COUNT(*) FROM meta WHERE key LIKE 'export.asset-write.%'",[],|r|r.get::<_,u32>(0)).unwrap(),1);
        assert_eq!(std::fs::read_dir(lib.root().join("exports")).unwrap().count(),0);
    }
    #[test] fn deferred_commit_failure_rolls_back_files_and_receipts() {
        let mut lib=lib();let mut writes=AssetWrites::new(&lib);writes.write("new.png",b"new").unwrap();
        lib.db().conn.execute_batch("CREATE TABLE deferred_failure(id TEXT REFERENCES stickers(id) DEFERRABLE INITIALLY DEFERRED);").unwrap();
        let tx=lib.db_mut().conn.transaction().unwrap();tx.execute("INSERT INTO deferred_failure VALUES ('missing')",[]).unwrap();assert!(writes.commit(tx).is_err());
        assert!(!lib.root().join("assets/new.png").exists());
        assert_eq!(lib.db().conn.query_row("SELECT COUNT(*) FROM meta WHERE key LIKE 'export.asset-write.%'",[],|r|r.get::<_,u32>(0)).unwrap(),0);
        assert_eq!(std::fs::read_dir(lib.root().join("exports")).unwrap().count(),0);
    }
}
