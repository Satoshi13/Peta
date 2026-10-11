//! Recoverable file publication coordinated with a database receipt.
use std::{fs, io::Write, path::{Path, PathBuf}};
use serde::{Serialize, Deserialize};
use crate::{Database, Result};

#[derive(Serialize, Deserialize)]
struct Journal { target:PathBuf, backup:PathBuf, temp:PathBuf, receipt:String, existed:bool }
pub struct Export { journal:PathBuf, entry:Journal, complete:bool }
impl Export {
    pub fn publish(root:&Path,target:&Path,bytes:&[u8],receipt:&str)->Result<Self> {
        let token=crate::ids::new_gift_id();
        let dir=root.join("exports");fs::create_dir_all(&dir)?;
        let journal=dir.join(format!("{token}.json"));
        let entry=Journal{target:target.to_owned(),backup:target.with_file_name(format!(".peta-{token}.backup")),temp:target.with_file_name(format!(".peta-{token}.tmp")),receipt:receipt.into(),existed:target.exists()};
        let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&entry.temp)?;
        if let Err(e)=file.write_all(bytes).and_then(|_|file.sync_all()) {let _=fs::remove_file(&entry.temp);return Err(e.into());}
        let save_journal=(||->Result<()> {let mut saved=fs::File::create(&journal)?;saved.write_all(&serde_json::to_vec(&entry).map_err(|e|crate::Error::Invalid(e.to_string()))?)?;saved.sync_all()?;Ok(())})();
        if let Err(e)=save_journal {let _=fs::remove_file(&journal);let _=fs::remove_file(&entry.temp);return Err(e);}
        let guard=Self{journal,entry,complete:false};
        if guard.entry.existed {fs::rename(&guard.entry.target,&guard.entry.backup)?;}
        fs::rename(&guard.entry.temp,&guard.entry.target)?;
        Ok(guard)
    }
    pub fn finish(mut self) {self.complete=true;let _=fs::remove_file(&self.entry.backup);let _=fs::remove_file(&self.journal);}
}
fn undo(entry:&Journal) {
    if entry.backup.exists() {let _=fs::remove_file(&entry.target);let _=fs::rename(&entry.backup,&entry.target);}
    else if !entry.existed {let _=fs::remove_file(&entry.target);}
    let _=fs::remove_file(&entry.temp);
}
impl Drop for Export {fn drop(&mut self) {if !self.complete {undo(&self.entry);let _=fs::remove_file(&self.journal);}}}
pub(crate) fn recover(root:&Path,db:&Database)->Result<()> {
    let dir=root.join("exports");if !dir.exists(){return Ok(());}
    for file in fs::read_dir(dir)? {let path=file?.path();if path.extension().is_none_or(|e|e!="json"){continue;}
        let entry:Journal=serde_json::from_slice(&fs::read(&path)?).map_err(|e|crate::Error::Invalid(format!("Could not recover a saved file: {e}")))?;
        let committed:bool=db.conn.query_row("SELECT EXISTS(SELECT 1 FROM meta WHERE key=?1)",[format!("export.{}",entry.receipt)],|r|r.get(0))?;
        if committed {let _=fs::remove_file(&entry.backup);let _=fs::remove_file(&entry.temp);}else {undo(&entry);}
        fs::remove_file(path)?;
    }Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    #[cfg(unix)]
    #[test] fn journal_failure_does_not_leave_a_temp_file_or_touch_the_target() {
        use std::os::unix::fs::PermissionsExt;
        let root=std::env::temp_dir().join(crate::ids::new_gift_id());let dir=root.join("exports");fs::create_dir_all(&dir).unwrap();let target=root.join("pack.peta");fs::write(&target,b"previous").unwrap();
        fs::set_permissions(&dir,fs::Permissions::from_mode(0o500)).unwrap();let result=Export::publish(&root,&target,b"new","failure");fs::set_permissions(&dir,fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());assert_eq!(fs::read(&target).unwrap(),b"previous");
        assert_eq!(fs::read_dir(&root).unwrap().count(),2);assert_eq!(fs::read_dir(dir).unwrap().count(),0);fs::remove_dir_all(root).unwrap();
    }
    #[test] fn publication_rolls_back_and_recovers_both_sides_of_a_commit() {
        let root=std::env::temp_dir().join(crate::ids::new_gift_id());fs::create_dir_all(&root).unwrap();
        let target=root.join("gift.peta");fs::write(&target,b"previous").unwrap();let db=Database::open_in_memory().unwrap();
        {let _guard=Export::publish(&root,&target,b"new","ordinary").unwrap();assert_eq!(fs::read(&target).unwrap(),b"new");}
        assert_eq!(fs::read(&target).unwrap(),b"previous");
        let interrupted=Export::publish(&root,&target,b"uncommitted","crash").unwrap();std::mem::forget(interrupted);
        recover(&root,&db).unwrap();assert_eq!(fs::read(&target).unwrap(),b"previous");
        let committed=Export::publish(&root,&target,b"committed","receipt").unwrap();std::mem::forget(committed);
        db.conn.execute("INSERT INTO meta VALUES ('export.receipt','1')",[]).unwrap();recover(&root,&db).unwrap();assert_eq!(fs::read(&target).unwrap(),b"committed");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn an_old_receipt_cannot_commit_a_new_publication_interrupted_between_renames() {
        let root=std::env::temp_dir().join(crate::ids::new_gift_id());fs::create_dir_all(&root).unwrap();
        let target=root.join("pack.peta");fs::write(&target,b"old pack").unwrap();let db=Database::open_in_memory().unwrap();
        db.conn.execute("INSERT INTO meta VALUES ('export.old-operation','1')",[]).unwrap();
        let interrupted=Export::publish(&root,&target,b"new pack","new-operation").unwrap();
        // Return to the crash point after target -> backup, before temp -> target.
        fs::rename(&target,&interrupted.entry.temp).unwrap();std::mem::forget(interrupted);
        recover(&root,&db).unwrap();assert_eq!(fs::read(&target).unwrap(),b"old pack");
        assert_eq!(fs::read_dir(root.join("exports")).unwrap().count(),0);fs::remove_dir_all(root).unwrap();
    }
}
