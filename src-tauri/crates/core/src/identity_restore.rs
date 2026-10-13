//! Durable paired-key replacement. The journal contains hashes and fixed filenames only.
use std::{fs,io::{Read,Write},path::Path};
use serde::{Serialize,Deserialize};
use crate::{Error,Result};
const ACTIVE:&str=".identity-restore";
const PREPARE:&str=".identity-prepare";
const COMPLETE:&str=".identity-complete";
const NAMES:[&str;2]=["device.key","box.key"];
#[derive(Serialize,Deserialize)]
struct Journal {new:[String;2],old:[Option<String>;2]}
fn invalid()->Error {Error::Invalid("Could not recover this Mac's keys. Keep the Peta data folder and contact support.".into())}
pub(crate) fn sync_dir(path:&Path)->Result<()> {fs::File::open(path)?.sync_all()?;Ok(())}
fn hash(bytes:&[u8])->String {crate::ownership::digest(bytes)}
fn checked(path:&Path,index:usize)->Result<Vec<u8>> {
    if index==0 {crate::device_key::load(path)?;} else {crate::identity::read_box(path)?;}
    Ok(fs::read(path)?)
}
fn private_dir(path:&Path)->Result<()> {
    let m=fs::symlink_metadata(path)?;
    if !m.is_dir()||m.file_type().is_symlink(){return Err(invalid());}
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;if m.permissions().mode()&0o077!=0{return Err(invalid());}}
    Ok(())
}
fn install(root:&Path,index:usize,bytes:&[u8])->Result<()> {
    let temp=root.join(format!("{}.restore",NAMES[index]));
    if fs::symlink_metadata(&temp).is_ok(){fs::remove_file(&temp)?;}
    crate::identity::write_private(&temp,bytes,true)?;
    checked(&temp,index)?;
    fs::rename(temp,root.join(NAMES[index]))?;sync_dir(root)
}
fn finish(root:&Path)->Result<()> {
    // Retire the whole journal atomically before cleanup, so an interrupted cleanup is harmless.
    fs::rename(root.join(ACTIVE),root.join(COMPLETE))?;sync_dir(root)?;
    fs::remove_dir_all(root.join(COMPLETE))?;sync_dir(root)
}
pub fn recover(root:&Path)->Result<()> {
    let active=root.join(ACTIVE);
    if root.join(COMPLETE).exists(){private_dir(&root.join(COMPLETE))?;fs::remove_dir_all(root.join(COMPLETE))?;sync_dir(root)?;}
    if !active.exists(){return Ok(());}
    private_dir(&active)?;
    let mut bytes=Vec::new();fs::File::open(active.join("journal.json"))?.take(4097).read_to_end(&mut bytes)?;
    if bytes.len()>4096{return Err(invalid());}
    let journal:Journal=serde_json::from_slice(&bytes).map_err(|_|invalid())?;
    let new:Option<Vec<Vec<u8>>>=(0..2).map(|i|checked(&active.join(format!("new-{i}")),i).ok().filter(|b|hash(b)==journal.new[i])).collect();
    if let Some(pair)=new {
        for (i,key) in pair.iter().enumerate(){install(root,i,key)?;}
    } else {
        // Validate every backup before changing either live key.
        let old:Vec<Option<Vec<u8>>>=(0..2).map(|i|match &journal.old[i] {
            Some(digest)=>{let b=checked(&active.join(format!("old-{i}")),i)?;if hash(&b)!=*digest{return Err(invalid());}Ok(Some(b))},
            None=>Ok(None),
        }).collect::<Result<_>>()?;
        for (i,key) in old.iter().enumerate(){
            if let Some(key)=key {install(root,i,key)?;}
            else if fs::symlink_metadata(root.join(NAMES[i])).is_ok(){fs::remove_file(root.join(NAMES[i]))?;sync_dir(root)?;}
        }
    }
    finish(root)
}
fn prepare(root:&Path,pair:&[Vec<u8>;2])->Result<()> {
    recover(root)?;fs::create_dir_all(root)?;
    let dir=root.join(PREPARE);
    if dir.exists(){private_dir(&dir)?;fs::remove_dir_all(&dir)?;}
    fs::create_dir(&dir)?;
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;fs::set_permissions(&dir,fs::Permissions::from_mode(0o700))?;}
    let result=(||->Result<()> {
        let mut old=[None,None];
        for i in 0..2 {
            crate::identity::write_private(&dir.join(format!("new-{i}")),&pair[i],true)?;
            checked(&dir.join(format!("new-{i}")),i)?;
            if fs::symlink_metadata(root.join(NAMES[i])).is_ok(){
                let bytes=checked(&root.join(NAMES[i]),i)?;old[i]=Some(hash(&bytes));
                crate::identity::write_private(&dir.join(format!("old-{i}")),&bytes,true)?;
            }
        }
        let journal=Journal{new:[hash(&pair[0]),hash(&pair[1])],old};
        let mut f=fs::OpenOptions::new().write(true).create_new(true).open(dir.join("journal.json"))?;
        f.write_all(&serde_json::to_vec(&journal).map_err(|_|invalid())?)?;f.sync_all()?;sync_dir(&dir)?;
        fs::rename(&dir,root.join(ACTIVE))?;sync_dir(root)
    })();
    if result.is_err()&&dir.exists(){let _=fs::remove_dir_all(&dir);}
    result
}
pub(crate) fn replace(root:&Path,pair:[Vec<u8>;2])->Result<()> {
    let result=replace_with(root,pair,|_|Ok(()));
    if result.is_err(){recover(root)?;}
    result
}
fn replace_with(root:&Path,pair:[Vec<u8>;2],mut after:impl FnMut(usize)->Result<()>)->Result<()> {
    prepare(root,&pair)?;
    for (i,key) in pair.iter().enumerate(){install(root,i,key)?;after(i)?;}
    finish(root)
}
#[cfg(test)] mod tests {
    use super::*;
    fn fixture()->(std::path::PathBuf,[Vec<u8>;2],[Vec<u8>;2]) {
        let root=std::env::temp_dir().join(crate::ids::new_gift_id());fs::create_dir_all(&root).unwrap();
        let old=[vec![1;32],vec![2;32]];let new=[vec![3;32],vec![4;32]];
        for i in 0..2{crate::identity::write_private(&root.join(NAMES[i]),&old[i],true).unwrap();}
        (root,old,new)
    }
    fn crash(i:usize)->Result<()> {if i==0{Err(Error::Invalid("simulated interruption".into()))}else{Ok(())}}
    #[test] fn interruption_after_first_rename_completes_the_new_pair_on_open() {
        let (root,_,new)=fixture();assert!(replace_with(&root,new.clone(),crash).is_err());
        assert_eq!(fs::read(root.join(NAMES[0])).unwrap(),new[0]);
        let lib=crate::Library::open(&root).unwrap();
        for i in 0..2{assert_eq!(fs::read(root.join(NAMES[i])).unwrap(),new[i]);}
        assert!(!root.join(ACTIVE).exists());drop(lib);fs::remove_dir_all(root).unwrap();
    }
    #[test] fn corrupt_staged_key_rolls_back_both_keys_even_after_first_rename() {
        let (root,old,new)=fixture();assert!(replace_with(&root,new,crash).is_err());
        fs::write(root.join(ACTIVE).join("new-1"),[9;32]).unwrap();
        recover(&root).unwrap();recover(&root).unwrap();
        for i in 0..2{assert_eq!(fs::read(root.join(NAMES[i])).unwrap(),old[i]);}
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn missing_stage_restores_absent_targets_and_bad_journal_fails_closed() {
        let (root,_,new)=fixture();for n in NAMES{fs::remove_file(root.join(n)).unwrap();}
        assert!(replace_with(&root,new,crash).is_err());fs::remove_file(root.join(ACTIVE).join("new-1")).unwrap();
        recover(&root).unwrap();for n in NAMES{assert!(!root.join(n).exists());}
        let pair=[vec![3;32],vec![4;32]];prepare(&root,&pair).unwrap();fs::write(root.join(ACTIVE).join("journal.json"),b"broken").unwrap();
        assert!(crate::device_key::load_or_create(&root).is_err());assert!(crate::identity::sealing_key(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
