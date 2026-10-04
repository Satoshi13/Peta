//! Device key storage is confined here so a future Keychain implementation can replace it.
use std::{fs::{self,OpenOptions}, io::{Read,Write}, path::Path};
use ed25519_dalek::SigningKey;
use crate::{error::{Error,Result},sign};
fn read(path: &Path) -> Result<SigningKey> {
    let meta=fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.file_type().is_symlink() {return Err(Error::Invalid("Signing key must be a private regular file.".into()));}
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;if meta.permissions().mode() & 0o077!=0 {return Err(Error::Invalid("Signing key permissions must be 0600.".into()));}}
    let mut bytes=Vec::new();fs::File::open(path)?.take(33).read_to_end(&mut bytes)?;
    let seed:[u8;32]=bytes.try_into().map_err(|_|Error::Invalid("Signing key is damaged.".into()))?;
    Ok(SigningKey::from_bytes(&seed))
}
pub fn load(path:&Path)->Result<SigningKey> {read(path)}
pub fn save_new(path:&Path,key:&SigningKey)->Result<()> {
    let mut opts=OpenOptions::new();opts.write(true).create_new(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;opts.mode(0o600);}
    let mut file=opts.open(path)?;file.write_all(&key.to_bytes())?;file.sync_all()?;Ok(())
}
pub fn load_or_create(root:&Path)->Result<SigningKey> {
    let path=root.join("device.key");
    if fs::symlink_metadata(&path).is_ok() {return read(&path);}
    let key=sign::generate()?;
    match save_new(&path,&key) {Ok(())=>Ok(key),Err(Error::Io(e)) if e.kind()==std::io::ErrorKind::AlreadyExists=>read(&path),Err(e)=>Err(e)}
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn private_key_survives_restart_and_is_never_overwritten() {
        let dir=std::env::temp_dir().join(format!("peta-key-{}",crate::ids::new_sticker_id()));fs::create_dir_all(&dir).unwrap();
        let a=load_or_create(&dir).unwrap();let b=load_or_create(&dir).unwrap();assert_eq!(sign::public_key(&a),sign::public_key(&b));
        assert!(save_new(&dir.join("device.key"),&sign::generate().unwrap()).is_err());
        #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;assert_eq!(fs::metadata(dir.join("device.key")).unwrap().permissions().mode() & 0o777,0o600);}
        fs::write(dir.join("device.key"),b"damaged").unwrap();assert!(load_or_create(&dir).is_err());fs::remove_dir_all(dir).unwrap();
    }
}
