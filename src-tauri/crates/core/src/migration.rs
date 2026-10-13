//! Offline full-library migration. Bounded AEAD records authenticate order, length and the final record.
use crate::{Error, Library, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
const MAGIC: &[u8; 8] = b"PETAMOV1";
const HEADER: usize = 44;
const CHUNK: usize = 256 * 1024;
const MAX_TOTAL: u64 = 64 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
const MAX_PATH: usize = 1024;
fn invalid(message: &str) -> Error {
    Error::Invalid(message.into())
}
fn damaged() -> Error {
    invalid("This move file is damaged or incomplete.")
}
fn exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
fn sync_dir(path: &Path) -> Result<()> {
    crate::identity_restore::sync_dir(path)
}
fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
fn real_dir(path: &Path, private: bool) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(damaged());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if private && meta.permissions().mode() & 0o077 != 0 {
            return Err(damaged());
        }
    }
    Ok(())
}
fn private_file(path: &Path) -> Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}
struct Cleanup(PathBuf);
impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = if self.0.is_dir() {
            fs::remove_dir_all(&self.0)
        } else {
            fs::remove_file(&self.0)
        };
    }
}
fn hash_file(path: &Path) -> Result<[u8; 32]> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; CHUNK];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(hash.finalize().into())
}
fn skipped(path: &str) -> bool {
    matches!(
        path.split('/').next().unwrap_or(""),
        "thumbs"
            | "tag-icons"
            | "exports"
            | "peta.db-wal"
            | "peta.db-shm"
            | "peta.db-journal"
            | ".identity-prepare"
            | ".identity-restore"
            | ".identity-complete"
    )
}
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_PATH
        && !path.contains(['\\', ':'])
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != ".." && !p.chars().any(char::is_control))
}
#[derive(Clone)]
struct Entry {
    path: String,
    source: PathBuf,
    dir: bool,
    len: u64,
    mode: u32,
    hash: [u8; 32],
}
fn entry_overhead(path: &str) -> u64 {
    (4 + path.len() + 1 + 4 + 8 + 32) as u64
}
fn inventory(root: &Path, snapshot: Option<&Path>) -> Result<Vec<Entry>> {
    real_dir(root, false)?;
    fn walk(
        root: &Path,
        dir: &Path,
        snapshot: Option<&Path>,
        out: &mut Vec<Entry>,
        total: &mut u64,
    ) -> Result<()> {
        let mut children = fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
        children.sort_by_key(|e| e.file_name());
        for child in children {
            let path = child.path();
            let rel = path
                .strip_prefix(root)
                .map_err(|_| damaged())?
                .to_str()
                .ok_or_else(damaged)?
                .replace(std::path::MAIN_SEPARATOR, "/");
            if skipped(&rel) {
                continue;
            }
            if !safe_path(&rel) {
                return Err(invalid(
                    "A library filename cannot be included in a move file.",
                ));
            }
            let meta = fs::symlink_metadata(&path)?;
            if meta.file_type().is_symlink() || (!meta.is_file() && !meta.is_dir()) {
                return Err(invalid(
                    "A move file cannot include links or special files.",
                ));
            }
            let source = if rel == "peta.db" {
                snapshot.unwrap_or(&path).to_owned()
            } else {
                path.clone()
            };
            let source_meta = fs::metadata(&source)?;
            let len = if meta.is_dir() { 0 } else { source_meta.len() };
            *total = total
                .checked_add(len + entry_overhead(&rel))
                .ok_or_else(damaged)?;
            if *total > MAX_TOTAL || out.len() >= MAX_ENTRIES {
                return Err(invalid(
                    "This library is too large for this move file version.",
                ));
            }
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::PermissionsExt;
                meta.permissions().mode() & 0o777
            };
            #[cfg(not(unix))]
            let mode = 0o600;
            let hash = if meta.is_dir() {
                Sha256::digest([]).into()
            } else {
                hash_file(&source)?
            };
            out.push(Entry {
                path: rel,
                source,
                dir: meta.is_dir(),
                len,
                mode,
                hash,
            });
            if meta.is_dir() {
                walk(root, &path, snapshot, out, total)?;
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    let mut total = 4;
    walk(root, root, snapshot, &mut out, &mut total)?;
    Ok(out)
}
fn cipher(passphrase: &str, salt: &[u8]) -> Result<ChaCha20Poly1305> {
    let params = argon2::Params::new(19456, 2, 1, Some(32)).map_err(|_| damaged())?;
    let argon = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut key = [0; 32];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|_| invalid("Could not use that passphrase."))?;
    Ok(ChaCha20Poly1305::new((&key).into()))
}
fn nonce(prefix: &[u8], seq: u64) -> [u8; 12] {
    let mut value = [0; 12];
    value[..4].copy_from_slice(prefix);
    value[4..].copy_from_slice(&seq.to_be_bytes());
    value
}
struct SealedWriter {
    file: fs::File,
    cipher: ChaCha20Poly1305,
    header: [u8; HEADER],
    buffer: Vec<u8>,
    seq: u64,
}
impl SealedWriter {
    fn new(mut file: fs::File, passphrase: &str) -> Result<Self> {
        let mut header = [0; HEADER];
        header[..8].copy_from_slice(MAGIC);
        getrandom::fill(&mut header[8..28]).map_err(|_| invalid("Could not make a move file."))?;
        for (range, value) in [
            (28..32, CHUNK as u32),
            (32..36, 19456),
            (36..40, 2),
            (40..44, 1),
        ] {
            header[range].copy_from_slice(&value.to_be_bytes());
        }
        let cipher = cipher(passphrase, &header[8..24])?;
        file.write_all(&header)?;
        Ok(Self {
            file,
            cipher,
            header,
            buffer: Vec::with_capacity(CHUNK),
            seq: 0,
        })
    }
    fn record(&mut self, final_record: bool) -> Result<()> {
        let mut record = self.seq.to_be_bytes().to_vec();
        record.push(final_record as u8);
        record.extend_from_slice(&(self.buffer.len() as u32).to_be_bytes());
        let aad = [self.header.as_slice(), record.as_slice()].concat();
        let nonce = nonce(&self.header[24..28], self.seq);
        let sealed = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &self.buffer,
                    aad: &aad,
                },
            )
            .map_err(|_| invalid("Could not seal the move file."))?;
        self.file.write_all(&record)?;
        self.file.write_all(&sealed)?;
        self.buffer.clear();
        self.seq = self.seq.checked_add(1).ok_or_else(damaged)?;
        Ok(())
    }
    fn bytes(&mut self, mut bytes: &[u8]) -> Result<()> {
        while !bytes.is_empty() {
            let n = bytes.len().min(CHUNK - self.buffer.len());
            self.buffer.extend_from_slice(&bytes[..n]);
            bytes = &bytes[n..];
            if self.buffer.len() == CHUNK {
                self.record(false)?;
            }
        }
        Ok(())
    }
    fn finish(mut self) -> Result<()> {
        self.record(true)?;
        self.file.sync_all()?;
        Ok(())
    }
}
fn decrypt(input: &Path, plain: &Path, passphrase: &str) -> Result<()> {
    let mut file = fs::File::open(input)?;
    let mut header = [0; HEADER];
    file.read_exact(&mut header).map_err(|_| damaged())?;
    if &header[..8] != MAGIC
        || u32::from_be_bytes(header[28..32].try_into().unwrap()) != CHUNK as u32
        || u32::from_be_bytes(header[32..36].try_into().unwrap()) != 19456
        || u32::from_be_bytes(header[36..40].try_into().unwrap()) != 2
        || u32::from_be_bytes(header[40..44].try_into().unwrap()) != 1
    {
        return Err(damaged());
    }
    let cipher = cipher(passphrase, &header[8..24])?;
    let mut output = private_file(plain)?;
    let mut seq = 0u64;
    let mut total = 0u64;
    loop {
        let mut record = [0; 13];
        file.read_exact(&mut record).map_err(|_| damaged())?;
        let n = u32::from_be_bytes(record[9..13].try_into().unwrap()) as usize;
        let final_record = record[8];
        if u64::from_be_bytes(record[..8].try_into().unwrap()) != seq
            || final_record > 1
            || n > CHUNK
            || (final_record == 0 && n != CHUNK)
        {
            return Err(damaged());
        }
        total = total.checked_add(n as u64).ok_or_else(damaged)?;
        if total > MAX_TOTAL {
            return Err(damaged());
        }
        let mut sealed = vec![0; n + 16];
        file.read_exact(&mut sealed).map_err(|_| damaged())?;
        let aad = [header.as_slice(), record.as_slice()].concat();
        let nonce = nonce(&header[24..28], seq);
        let bytes = cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &sealed,
                    aad: &aad,
                },
            )
            .map_err(|_| {
                invalid("That passphrase does not open this move file, or the file is damaged.")
            })?;
        output.write_all(&bytes)?;
        if final_record == 1 {
            let mut extra = [0];
            if file.read(&mut extra)? != 0 {
                return Err(damaged());
            }
            break;
        }
        seq = seq.checked_add(1).ok_or_else(damaged)?;
    }
    output.sync_all()?;
    Ok(())
}
/// SQLite and assets are snapshotted while the caller holds the library mutex.
pub fn export(lib: &mut Library, destination: &Path, passphrase: &str) -> Result<()> {
    if passphrase.chars().count() < crate::identity::PASSPHRASE_MIN {
        return Err(invalid("Use a passphrase of at least 12 characters."));
    }
    let root = lib.root().to_owned();
    crate::identity::recover_restore(&root)?;
    crate::export::recover(&root, lib.db())?;
    crate::device_key::load_or_create(&root)?;
    crate::identity::sealing_key(&root)?;
    let parent = destination.parent().ok_or_else(damaged)?.canonicalize()?;
    if parent.starts_with(root.canonicalize()?) {
        return Err(invalid("Save the move file outside the Peta data folder."));
    }
    let work = root
        .parent()
        .ok_or_else(damaged)?
        .join(format!(".peta-move-export-{}", crate::ids::new_gift_id()));
    private_dir(&work)?;
    let _work = Cleanup(work.clone());
    let snapshot = work.join("peta.db");
    lib.db().conn.execute(
        "VACUUM main INTO ?1",
        [snapshot.to_str().ok_or_else(damaged)?],
    )?;
    // Old installations stored absolute card paths. Only the snapshot is normalized.
    let snapshot_db = rusqlite::Connection::open(&snapshot)?;
    let cards: Vec<String> = snapshot_db
        .prepare("SELECT listing_id FROM market_listings_seen WHERE card_path IS NOT NULL")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    for id in cards {
        let path = crate::market::relative_card_path(&id)?;
        snapshot_db.execute(
            "UPDATE market_listings_seen SET card_path=?2 WHERE listing_id=?1",
            rusqlite::params![id, path],
        )?;
    }
    drop(snapshot_db);
    fs::File::open(&snapshot)?.sync_all()?;
    let entries = inventory(&root, Some(&snapshot))?;
    let temp = parent.join(format!(".peta-move-{}.tmp", crate::ids::new_gift_id()));
    let _temp = Cleanup(temp.clone());
    let mut writer = SealedWriter::new(private_file(&temp)?, passphrase)?;
    writer.bytes(&(entries.len() as u32).to_be_bytes())?;
    let mut buffer = vec![0; CHUNK];
    for entry in entries {
        writer.bytes(&(entry.path.len() as u32).to_be_bytes())?;
        writer.bytes(entry.path.as_bytes())?;
        writer.bytes(&[entry.dir as u8])?;
        writer.bytes(&entry.mode.to_be_bytes())?;
        writer.bytes(&entry.len.to_be_bytes())?;
        writer.bytes(&entry.hash)?;
        if !entry.dir {
            let mut input = fs::File::open(entry.source)?;
            let mut remaining = entry.len;
            let mut hash = Sha256::new();
            while remaining > 0 {
                let cap = remaining.min(CHUNK as u64) as usize;
                let n = input.read(&mut buffer[..cap])?;
                if n == 0 {
                    return Err(invalid(
                        "The library changed while the move file was being made.",
                    ));
                }
                writer.bytes(&buffer[..n])?;
                hash.update(&buffer[..n]);
                remaining -= n as u64;
            }
            let mut extra = [0];
            if input.read(&mut extra)? != 0 || <[u8; 32]>::from(hash.finalize()) != entry.hash {
                return Err(invalid(
                    "The library changed while the move file was being made.",
                ));
            }
        }
    }
    writer.finish()?;
    fs::rename(&temp, destination)?;
    sync_dir(&parent)
}
fn read_array<const N: usize>(input: &mut fs::File) -> Result<[u8; N]> {
    let mut value = [0; N];
    input.read_exact(&mut value).map_err(|_| damaged())?;
    Ok(value)
}
fn extract(plain: &Path, stage: &Path) -> Result<()> {
    let mut input = fs::File::open(plain)?;
    let count = u32::from_be_bytes(read_array(&mut input)?) as usize;
    if count == 0 || count > MAX_ENTRIES {
        return Err(damaged());
    }
    let mut seen = HashSet::new();
    let mut dirs = Vec::new();
    let mut declared_dirs = HashSet::new();
    let mut total = 0u64;
    let mut buffer = vec![0; CHUNK];
    for _ in 0..count {
        let n = u32::from_be_bytes(read_array(&mut input)?) as usize;
        if n == 0 || n > MAX_PATH {
            return Err(damaged());
        }
        let mut path = vec![0; n];
        input.read_exact(&mut path).map_err(|_| damaged())?;
        let path = String::from_utf8(path).map_err(|_| damaged())?;
        if !safe_path(&path) || skipped(&path) || !seen.insert(path.clone()) {
            return Err(damaged());
        }
        let kind = read_array::<1>(&mut input)?[0];
        let mode = u32::from_be_bytes(read_array(&mut input)?);
        let len = u64::from_be_bytes(read_array(&mut input)?);
        let expected = read_array::<32>(&mut input)?;
        total = total.checked_add(len).ok_or_else(damaged)?;
        if kind > 1 || mode & !0o777 != 0 || total > MAX_TOTAL || (kind == 1 && len != 0) {
            return Err(damaged());
        }
        let relative_parent = Path::new(&path).parent().ok_or_else(damaged)?;
        if !relative_parent.as_os_str().is_empty()
            && !declared_dirs.contains(relative_parent.to_str().ok_or_else(damaged)?)
        {
            return Err(damaged());
        }
        let target = stage.join(&path);
        if kind == 1 {
            private_dir(&target)?;
            declared_dirs.insert(path.clone());
            dirs.push((target, mode));
            if expected != <[u8; 32]>::from(Sha256::digest([])) {
                return Err(damaged());
            }
            continue;
        }
        let mut output = private_file(&target)?;
        let mut remaining = len;
        let mut hash = Sha256::new();
        while remaining > 0 {
            let n = remaining.min(CHUNK as u64) as usize;
            input.read_exact(&mut buffer[..n]).map_err(|_| damaged())?;
            hash.update(&buffer[..n]);
            output.write_all(&buffer[..n])?;
            remaining -= n as u64;
        }
        if <[u8; 32]>::from(hash.finalize()) != expected {
            return Err(damaged());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(mode))?;
        }
        output.sync_all()?;
    }
    let mut extra = [0];
    if input.read(&mut extra)? != 0 {
        return Err(damaged());
    }
    // Namespace durability includes every created directory, not just the files.
    for (dir, mode) in dirs.into_iter().rev() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(mode))?;
        }
        sync_dir(&dir)?;
    }
    sync_dir(stage)
}
fn readonly_db(root: &Path) -> Result<rusqlite::Connection> {
    Ok(rusqlite::Connection::open_with_flags(
        root.join("peta.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}
fn asset(root: &Path, path: &str) -> Result<()> {
    if !safe_path(path) {
        return Err(damaged());
    }
    let metadata = fs::symlink_metadata(root.join("assets").join(path))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(damaged());
    }
    Ok(())
}
fn validate(root: &Path) -> Result<()> {
    real_dir(root, true)?;
    crate::device_key::load(&root.join("device.key"))?;
    crate::identity::read_box(&root.join("box.key"))?;
    let metadata = fs::symlink_metadata(root.join("peta.db"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(damaged());
    }
    let db = readonly_db(root)?;
    let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if version != crate::db::SCHEMA_VERSION
        || integrity != "ok"
        || db
            .prepare("PRAGMA foreign_key_check")?
            .query([])?
            .next()?
            .is_some()
    {
        return Err(damaged());
    }
    for sql in ["SELECT original_asset_path FROM stickers UNION ALL SELECT rendered_asset_path FROM stickers UNION ALL SELECT mask_asset_path FROM stickers WHERE mask_asset_path IS NOT NULL","SELECT package FROM gifts_received","SELECT png_path FROM signed_pack_items WHERE kind='sticker' UNION ALL SELECT mask_path FROM signed_pack_items WHERE kind='sticker' AND mask_path IS NOT NULL"]{
        for path in db.prepare(sql)?.query_map([],|r|r.get::<_,String>(0))?{asset(root,&path?)?;}
    }
    for row in db
        .prepare(
            "SELECT listing_id,card_path FROM market_listings_seen WHERE card_path IS NOT NULL",
        )?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    {
        let (id, path) = row?;
        if path != crate::market::relative_card_path(&id)? {
            return Err(damaged());
        }
        let meta = fs::symlink_metadata(root.join(path))?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err(damaged());
        }
    }
    Ok(())
}
// Hash database rows/schema rather than SQLite's mutable header/WAL representation during reopen.
fn database_digest(root: &Path) -> Result<[u8; 32]> {
    let db = readonly_db(root)?;
    let mut hash = Sha256::new();
    for value in db.prepare("SELECT type||':'||name||':'||tbl_name||':'||COALESCE(sql,'') FROM sqlite_master ORDER BY type,name")?.query_map([],|r|r.get::<_,String>(0))?{let value=value?;hash.update((value.len() as u64).to_be_bytes());hash.update(value.as_bytes());}
    let tables: Vec<(String, String)> = db
        .prepare(
            "SELECT name,COALESCE(sql,'') FROM sqlite_master WHERE type='table' ORDER BY name",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    for (table, schema) in tables {
        hash.update((table.len() as u64).to_be_bytes());
        hash.update(table.as_bytes());
        hash.update(schema.as_bytes());
        let quoted = table.replace('"', "\"\"");
        let mut statement = db.prepare(&format!("SELECT * FROM \"{quoted}\" ORDER BY rowid"))?;
        let columns = statement.column_count();
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            hash.update([255]);
            for i in 0..columns {
                use rusqlite::types::ValueRef;
                match row.get_ref(i)? {
                    ValueRef::Null => hash.update([0]),
                    ValueRef::Integer(v) => {
                        hash.update([1]);
                        hash.update(v.to_be_bytes());
                    }
                    ValueRef::Real(v) => {
                        hash.update([2]);
                        hash.update(v.to_bits().to_be_bytes());
                    }
                    ValueRef::Text(v) | ValueRef::Blob(v) => {
                        hash.update([if matches!(row.get_ref(i)?, ValueRef::Text(_)) {
                            3
                        } else {
                            4
                        }]);
                        hash.update((v.len() as u64).to_be_bytes());
                        hash.update(v);
                    }
                }
            }
        }
    }
    Ok(hash.finalize().into())
}
fn fingerprint(root: &Path) -> Result<String> {
    let mut hash = Sha256::new();
    for entry in inventory(root, None)? {
        hash.update((entry.path.len() as u64).to_be_bytes());
        hash.update(entry.path.as_bytes());
        hash.update([entry.dir as u8]);
        hash.update(entry.mode.to_be_bytes());
        hash.update(if entry.path == "peta.db" {
            database_digest(root)?
        } else {
            entry.hash
        });
    }
    Ok(hash.finalize().iter().map(|v| format!("{v:02x}")).collect())
}
fn root_parts(root: &Path) -> Result<(PathBuf, String)> {
    let parent = root.parent().ok_or_else(damaged)?.canonicalize()?;
    let name = root
        .file_name()
        .and_then(|v| v.to_str())
        .filter(|v| safe_path(v) && !v.contains('/'))
        .ok_or_else(damaged)?
        .to_owned();
    Ok((parent, name))
}
pub struct PreparedMove {
    stage: PathBuf,
    fingerprint: String,
    kept: bool,
}
impl Drop for PreparedMove {
    fn drop(&mut self) {
        if !self.kept {
            let _ = fs::remove_dir_all(&self.stage);
        }
    }
}
/// Authenticate the complete input before interpreting any contained filenames.
pub fn prepare(root: &Path, input: &Path, passphrase: &str) -> Result<PreparedMove> {
    let (parent, name) = root_parts(root)?;
    let token = crate::ids::new_gift_id();
    let work = parent.join(format!(".{name}-move-work-{token}"));
    private_dir(&work)?;
    let _work = Cleanup(work.clone());
    let plain = work.join("verified.body");
    decrypt(input, &plain, passphrase)?;
    let stage = parent.join(format!(".{name}-move-stage-{token}"));
    private_dir(&stage)?;
    let mut prepared = PreparedMove {
        stage,
        fingerprint: String::new(),
        kept: false,
    };
    extract(&plain, &prepared.stage)?;
    validate(&prepared.stage)?;
    prepared.fingerprint = fingerprint(&prepared.stage)?;
    sync_dir(&parent)?;
    Ok(prepared)
}
#[derive(Serialize, Deserialize)]
struct Journal {
    stage: String,
    old: String,
    fingerprint: String,
    old_fingerprint: String,
}
fn journal_paths(root: &Path) -> Result<(PathBuf, PathBuf)> {
    let (parent, name) = root_parts(root)?;
    Ok((
        parent.join(format!(".{name}-move.json")),
        parent.join(format!(".{name}-move.complete")),
    ))
}
fn read_journal(root: &Path, path: &Path) -> Result<Journal> {
    let (parent, name) = root_parts(root)?;
    let _ = parent;
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(damaged());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?.take(4097).read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err(damaged());
    }
    let entry: Journal = serde_json::from_slice(&bytes).map_err(|_| damaged())?;
    if !entry.stage.starts_with(&format!(".{name}-move-stage-"))
        || !entry.old.starts_with(&format!(".{name}-move-old-"))
        || !safe_path(&entry.stage)
        || !safe_path(&entry.old)
        || entry.stage.contains('/')
        || entry.old.contains('/')
        || entry.fingerprint.len() != 64
        || entry.old_fingerprint.len() != 64
    {
        return Err(damaged());
    }
    Ok(entry)
}
pub struct MoveSwap {
    root: PathBuf,
    journal: PathBuf,
    complete: PathBuf,
    entry: Journal,
    finished: bool,
}
impl MoveSwap {
    fn begin(root: &Path, mut prepared: PreparedMove, permit: &MovePermit) -> Result<Self> {
        if !permit.matches_root(root)? {
            return Err(invalid(
                "Restore a move file only into an empty Peta library.",
            ));
        }
        recover(root)?;
        let (parent, name) = root_parts(root)?;
        let root_meta = fs::symlink_metadata(root)?;
        if !root_meta.is_dir() || root_meta.file_type().is_symlink() {
            return Err(damaged());
        }
        validate(&prepared.stage)?;
        if prepared.stage.parent() != Some(parent.as_path())
            || fingerprint(&prepared.stage)? != prepared.fingerprint
        {
            return Err(damaged());
        }
        let (journal, complete) = journal_paths(root)?;
        let entry = Journal {
            stage: prepared
                .stage
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or_else(damaged)?
                .into(),
            old: format!(".{name}-move-old-{}", crate::ids::new_gift_id()),
            fingerprint: prepared.fingerprint.clone(),
            old_fingerprint: fingerprint(root)?,
        };
        let temp = parent.join(format!(
            ".{name}-move-journal-{}.tmp",
            crate::ids::new_gift_id()
        ));
        let _temp = Cleanup(temp.clone());
        let mut file = private_file(&temp)?;
        file.write_all(&serde_json::to_vec(&entry).map_err(|_| damaged())?)?;
        file.sync_all()?;
        fs::rename(temp, &journal)?;
        sync_dir(&parent)?;
        prepared.kept = true;
        Ok(Self {
            root: parent.join(name),
            journal,
            complete,
            entry,
            finished: false,
        })
    }
    fn install(&self) -> Result<()> {
        let parent = self.root.parent().ok_or_else(damaged)?;
        fs::rename(&self.root, parent.join(&self.entry.old))?;
        sync_dir(parent)?;
        fs::rename(parent.join(&self.entry.stage), &self.root)?;
        sync_dir(parent)
    }
    pub fn committed(&self) -> bool {
        self.finished
    }
    pub fn open_library(&self) -> Result<Library> {
        Library::open_after_move(&self.root)
    }
    pub fn rollback(&mut self) -> Result<()> {
        let parent = self.root.parent().ok_or_else(damaged)?;
        let old = parent.join(&self.entry.old);
        if exists(&old)? {
            real_dir(&old, false)?;
            if fingerprint(&old)? != self.entry.old_fingerprint {
                return Err(damaged());
            }
            if exists(&self.root)? {
                real_dir(&self.root, false)?;
                fs::remove_dir_all(&self.root)?;
            }
            fs::rename(old, &self.root)?;
            sync_dir(parent)?;
        }
        let stage = parent.join(&self.entry.stage);
        if exists(&stage)? {
            real_dir(&stage, true)?;
            fs::remove_dir_all(stage)?;
        }
        if exists(&self.journal)? {
            fs::remove_file(&self.journal)?;
        }
        sync_dir(parent)?;
        self.finished = true;
        Ok(())
    }
    pub fn finish(&mut self) -> Result<()> {
        let parent = self.root.parent().ok_or_else(damaged)?;
        if fingerprint(&self.root)? != self.entry.fingerprint {
            return Err(damaged());
        }
        fs::rename(&self.journal, &self.complete)?;
        self.finished = true;
        sync_dir(parent)?;
        cleanup_complete(&self.root, &self.complete)
    }
}
impl Drop for MoveSwap {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self.rollback();
        }
    }
}
pub fn publish(root: &Path, prepared: PreparedMove, permit: &MovePermit) -> Result<MoveSwap> {
    let mut swap = MoveSwap::begin(root, prepared, permit)?;
    if let Err(e) = swap.install() {
        swap.rollback()?;
        return Err(e);
    }
    Ok(swap)
}
fn cleanup_complete(root: &Path, path: &Path) -> Result<()> {
    let (parent, _) = root_parts(root)?;
    let entry = read_journal(root, path)?;
    for name in [&entry.old, &entry.stage] {
        let path = parent.join(name);
        if exists(&path)? {
            real_dir(&path, false)?;
            fs::remove_dir_all(path)?;
        }
    }
    fs::remove_file(path)?;
    sync_dir(&parent)
}
/// Run before creating/opening the live root. A recorded complete tree wins; otherwise restore the old root as a unit.
pub fn recover(root: &Path) -> Result<()> {
    let (journal, complete) = journal_paths(root)?;
    if exists(&complete)? {
        cleanup_complete(root, &complete)?;
    }
    if !exists(&journal)? {
        return Ok(());
    }
    let (parent, _) = root_parts(root)?;
    let entry = read_journal(root, &journal)?;
    let stage = parent.join(&entry.stage);
    let old = parent.join(&entry.old);
    for (path, private) in [
        (stage.as_path(), true),
        (old.as_path(), false),
        (root, false),
    ] {
        if exists(path)? {
            real_dir(path, private)?;
        }
    }
    if exists(&old)? && fingerprint(&old)? != entry.old_fingerprint {
        return Err(damaged());
    }
    let valid = |path: &Path| -> bool {
        validate(path).is_ok() && fingerprint(path).is_ok_and(|v| v == entry.fingerprint)
    };
    if exists(&stage)? && valid(&stage) {
        if exists(root)? {
            if exists(&old)? {
                fs::remove_dir_all(root)?;
            } else {
                fs::rename(root, &old)?;
            }
            sync_dir(&parent)?;
        }
        fs::rename(&stage, root)?;
        sync_dir(&parent)?;
    } else if !exists(root)? || !valid(root) {
        if !exists(&old)? {
            if exists(root)? && fingerprint(root).is_ok_and(|v| v == entry.old_fingerprint) {
                if exists(&stage)? {
                    fs::remove_dir_all(stage)?;
                }
                fs::remove_file(journal)?;
                sync_dir(&parent)?;
                return Ok(());
            }
            return Err(damaged());
        }
        if !fingerprint(&old).is_ok_and(|v| v == entry.old_fingerprint) {
            return Err(damaged());
        }
        if exists(root)? {
            fs::remove_dir_all(root)?;
        }
        fs::rename(&old, root)?;
        sync_dir(&parent)?;
        if exists(&stage)? {
            real_dir(&stage, true)?;
            fs::remove_dir_all(stage)?;
        }
        fs::remove_file(journal)?;
        sync_dir(&parent)?;
        return Ok(());
    }
    fs::rename(journal, &complete)?;
    sync_dir(&parent)?;
    cleanup_complete(root, &complete)
}

/// A frozen first-launch state; callers cannot construct an arbitrary restore permission.
#[derive(Clone)]
pub struct MovePermit {
    root: PathBuf,
    fingerprint: String,
    changes: u64,
}
impl MovePermit {
    pub fn is_current(&self, lib: &Library) -> Result<bool> {
        Ok(lib.db().change_count() == self.changes && self.matches_root(lib.root())?)
    }
    fn matches_root(&self, root: &Path) -> Result<bool> {
        Ok(root.canonicalize()? == self.root && fingerprint(root)? == self.fingerprint)
    }
}
/// Use only after proving the application itself created the empty root and finished built-in bootstrap.
pub fn permit_bootstrap(lib: &Library) -> Result<MovePermit> {
    Ok(MovePermit {
        root: lib.root().canonicalize()?,
        fingerprint: fingerprint(lib.root())?,
        changes: lib.db().change_count(),
    })
}
/// Standalone callers must start with a genuinely blank database and no user files.
pub fn permit_empty(lib: &Library) -> Result<MovePermit> {
    let tables:Vec<String>=lib.db().conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('meta','material_unlocks','material_stock','sqlite_sequence')")?.query_map([],|r|r.get(0))?.collect::<std::result::Result<_,_>>()?;
    for table in tables {
        let quoted = table.replace('"', "\"\"");
        if lib
            .db()
            .conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{quoted}\""), [], |r| {
                r.get::<_, u64>(0)
            })?
            > 0
        {
            return Err(invalid(
                "Restore a move file only into an empty Peta library.",
            ));
        }
    }
    let blank = crate::Database::open_in_memory()?;
    let unlocked = |db: &crate::Database| -> Result<Vec<String>> {
        Ok(db
            .conn
            .prepare("SELECT material_id FROM material_unlocks ORDER BY material_id")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    };
    if unlocked(lib.db())? != unlocked(&blank)? {
        return Err(invalid(
            "Restore a move file only into an empty Peta library.",
        ));
    }
    for table in ["meta", "material_stock"] {
        let values = |db: &crate::Database| -> Result<Vec<(String, String)>> {
            Ok(db
                .conn
                .prepare(&format!(
                    "SELECT CAST({} AS TEXT),CAST({} AS TEXT) FROM {table} ORDER BY 1",
                    if table == "meta" {
                        "key"
                    } else {
                        "material_id"
                    },
                    if table == "meta" { "value" } else { "count" }
                ))?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?)
        };
        if values(lib.db())? != values(&blank)? {
            return Err(invalid(
                "Restore a move file only into an empty Peta library.",
            ));
        }
    }
    for entry in inventory(lib.root(), None)? {
        if !matches!(
            entry.path.as_str(),
            "peta.db" | "assets" | "device.key" | "box.key"
        ) {
            return Err(invalid(
                "Restore a move file only into an empty Peta library.",
            ));
        }
    }
    permit_bootstrap(lib)
}
pub fn matches(root: &Path, expected: &str) -> Result<bool> {
    Ok(fingerprint(root)? == expected)
}
impl PreparedMove {
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PASS: &str = "correct horse battery";
    fn dir() -> PathBuf {
        let dir = std::env::temp_dir().join(crate::ids::new_gift_id());
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn fixture() -> (PathBuf, Library, PathBuf) {
        let parent = dir();
        let mut source = Library::open(&parent.join("source")).unwrap();
        source.db_mut().set_display_name("Maker").unwrap();
        source
            .db()
            .conn
            .execute(
                "INSERT INTO meta VALUES('move-test','uncheckpointed row')",
                [],
            )
            .unwrap();
        source
            .write_asset("nested/blob.bin", &vec![71; CHUNK * 2 + 37])
            .unwrap();
        fs::create_dir(source.root().join("assets/empty")).unwrap();
        fs::write(source.root().join("durable-note.txt"), b"retain this too").unwrap();
        crate::device_key::load_or_create(source.root()).unwrap();
        crate::identity::sealing_key(source.root()).unwrap();
        let file = parent.join("library.petamove");
        export(&mut source, &file, PASS).unwrap();
        (parent, source, file)
    }
    fn blank(parent: &Path) -> (PathBuf, Library, MovePermit) {
        let root = parent.join("destination");
        let lib = Library::open(&root).unwrap();
        crate::device_key::load_or_create(&root).unwrap();
        crate::identity::sealing_key(&root).unwrap();
        let permit = permit_empty(&lib).unwrap();
        (root, lib, permit)
    }
    #[test]
    fn streaming_roundtrip_preserves_wal_rows_assets_both_keys_and_unknown_durable_files() {
        let (parent, source, file) = fixture();
        let (root, destination, permit) = blank(&parent);
        drop(destination);
        let prepared = prepare(&root, &file, PASS).unwrap();
        let mut swap = publish(&root, prepared, &permit).unwrap();
        let moved = swap.open_library().unwrap();
        assert_eq!(moved.db().display_name().unwrap(), "Maker");
        assert_eq!(
            database_digest(source.root()).unwrap(),
            database_digest(moved.root()).unwrap()
        );
        assert_eq!(
            moved.read_asset("nested/blob.bin").unwrap(),
            source.read_asset("nested/blob.bin").unwrap()
        );
        assert!(root.join("assets/empty").is_dir());
        assert_eq!(
            fs::read(root.join("durable-note.txt")).unwrap(),
            b"retain this too"
        );
        for key in ["device.key", "box.key"] {
            assert_eq!(
                fs::read(root.join(key)).unwrap(),
                fs::read(source.root().join(key)).unwrap()
            );
        }
        let code = crate::identity::code_here(source.root(), "Maker").unwrap();
        let sealed = crate::identity::seal(&code.enc_key, crate::identity::GIFT, b"hello").unwrap();
        assert_eq!(
            crate::identity::open(&root, crate::identity::GIFT, &sealed).unwrap(),
            b"hello"
        );
        swap.finish().unwrap();
        drop(moved);
        drop(source);
        recover(&root).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn wrong_passphrase_tampering_truncation_appending_and_reordered_records_leave_the_destination_unchanged(
    ) {
        let (parent, source, file) = fixture();
        let (root, destination, _) = blank(&parent);
        let original = fingerprint(&root).unwrap();
        assert!(prepare(&root, &file, "wrong horse battery").is_err());
        let bytes = fs::read(&file).unwrap();
        let mut flipped = bytes.clone();
        *flipped.last_mut().unwrap() ^= 1;
        let mut appended = bytes.clone();
        appended.push(0);
        let mut reordered = bytes.clone();
        let span = 13 + CHUNK + 16;
        reordered[HEADER..HEADER + span * 2].rotate_left(span);
        let mut sequence = bytes.clone();
        sequence[HEADER + 7] = 1;
        let mut final_flag = bytes.clone();
        final_flag[HEADER + 8] = 1;
        for (n, bent) in [
            flipped,
            appended,
            reordered,
            sequence,
            final_flag,
            bytes[..bytes.len() - 1].to_vec(),
        ]
        .into_iter()
        .enumerate()
        {
            let input = parent.join(format!("bad-{n}.petamove"));
            fs::write(&input, bent).unwrap();
            assert!(prepare(&root, &input, PASS).is_err());
            assert_eq!(fingerprint(&root).unwrap(), original);
        }
        drop(destination);
        drop(source);
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn an_exact_chunk_boundary_still_needs_an_authenticated_final_record() {
        let parent = dir();
        let file = parent.join("boundary");
        let mut writer = SealedWriter::new(private_file(&file).unwrap(), PASS).unwrap();
        writer.bytes(&vec![2; CHUNK]).unwrap();
        writer.finish().unwrap();
        let out = parent.join("plain");
        decrypt(&file, &out, PASS).unwrap();
        assert_eq!(fs::metadata(out).unwrap().len(), CHUNK as u64);
        let mut bytes = fs::read(&file).unwrap();
        bytes.truncate(HEADER + 13 + CHUNK + 16);
        fs::write(&file, bytes).unwrap();
        assert!(decrypt(&file, &parent.join("truncated"), PASS).is_err());
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn nonempty_libraries_and_stale_permissions_are_rejected_before_publication() {
        let (parent, source, file) = fixture();
        assert!(permit_empty(&source).is_err());
        let (root, mut destination, permit) = blank(&parent);
        destination
            .db_mut()
            .set_display_name("Do not overwrite")
            .unwrap();
        assert!(!permit.is_current(&destination).unwrap());
        let original = fingerprint(&root).unwrap();
        drop(destination);
        let prepared = prepare(&root, &file, PASS).unwrap();
        assert!(publish(&root, prepared, &permit).is_err());
        assert_eq!(fingerprint(&root).unwrap(), original);
        drop(source);
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn a_crash_after_root_rename_completes_valid_staging_and_rolls_back_corrupt_staging() {
        for corrupt in [false, true] {
            let (parent, source, file) = fixture();
            let (root, destination, permit) = blank(&parent);
            let original = fingerprint(&root).unwrap();
            drop(destination);
            let prepared = prepare(&root, &file, PASS).unwrap();
            let swap = MoveSwap::begin(&root, prepared, &permit).unwrap();
            let old = parent.join(&swap.entry.old);
            fs::rename(&root, old).unwrap();
            sync_dir(&parent).unwrap();
            if corrupt {
                fs::write(
                    parent
                        .join(&swap.entry.stage)
                        .join("assets/nested/blob.bin"),
                    b"damaged",
                )
                .unwrap();
            }
            std::mem::forget(swap);
            let reopened = Library::open(&root).unwrap();
            if corrupt {
                assert_eq!(fingerprint(&root).unwrap(), original);
            } else {
                assert_eq!(
                    database_digest(&root).unwrap(),
                    database_digest(source.root()).unwrap()
                );
            }
            recover(&root).unwrap();
            drop(reopened);
            drop(source);
            fs::remove_dir_all(parent).unwrap();
        }
    }
    #[test]
    fn a_failed_second_rename_and_corrupt_prepublication_stage_restore_the_original_root() {
        for before_rename in [false, true] {
            let (parent, source, file) = fixture();
            let (root, destination, permit) = blank(&parent);
            let original = fingerprint(&root).unwrap();
            drop(destination);
            let prepared = prepare(&root, &file, PASS).unwrap();
            let mut swap = MoveSwap::begin(&root, prepared, &permit).unwrap();
            if before_rename {
                fs::write(parent.join(&swap.entry.stage).join("device.key"), b"bad").unwrap();
                std::mem::forget(swap);
                recover(&root).unwrap();
            } else {
                fs::remove_dir_all(parent.join(&swap.entry.stage)).unwrap();
                assert!(swap.install().is_err());
                swap.rollback().unwrap();
            }
            assert_eq!(fingerprint(&root).unwrap(), original);
            drop(source);
            fs::remove_dir_all(parent).unwrap();
        }
    }
    #[test]
    fn authenticated_archive_paths_duplicates_and_symlinks_cannot_escape_staging() {
        let parent = dir();
        let destination = Library::open(&parent.join("destination")).unwrap();
        for path in [
            "../escaped",
            "/tmp/escaped",
            "assets/../escaped",
            "assets\\escaped",
            "assets/./escaped",
        ] {
            let input = parent.join("bad-path.petamove");
            let mut writer = SealedWriter::new(private_file(&input).unwrap(), PASS).unwrap();
            writer.bytes(&1u32.to_be_bytes()).unwrap();
            writer.bytes(&(path.len() as u32).to_be_bytes()).unwrap();
            writer.bytes(path.as_bytes()).unwrap();
            writer.finish().unwrap();
            assert!(prepare(destination.root(), &input, PASS).is_err());
            fs::remove_file(input).unwrap();
            assert!(!parent.join("escaped").exists());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                parent.join("missing"),
                destination.root().join("assets/link"),
            )
            .unwrap();
            assert!(inventory(destination.root(), None).is_err());
        }
        drop(destination);
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn legacy_market_paths_and_non_image_prizes_survive_a_move() {
        let (parent, mut source, file) = fixture();
        let id = crate::market::new_id();
        let seller =
            crate::sign::public_key(&crate::device_key::load_or_create(source.root()).unwrap());
        let relative = crate::market::relative_card_path(&id).unwrap();
        let path = source.root().join(&relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let card = crate::market::Card {
            version: 1,
            external_id: "pack".into(),
            pack_digest: "digest".into(),
            title: "Test card".into(),
            blurb: None,
            pouch: "paper".into(),
            cover: None,
            deco: None,
            layout: None,
            designs: vec![],
            prizes: vec![],
            peek: vec![],
        };
        fs::write(&path, serde_json::to_vec(&card).unwrap()).unwrap();
        source.db().conn.execute("INSERT INTO market_listings_seen VALUES(?1,?3,'pack',6,'open',2,2,'card','pack',NULL,?2,'now')",rusqlite::params![id,path.to_str().unwrap(),seller]).unwrap();
        source.db().conn.execute("INSERT INTO friends(public_key,name,first_seen_at,status,allowed) VALUES(?1,'Nao','now','friend',1)",[&seller]).unwrap();
        source.db().conn.execute_batch("INSERT INTO packs VALUES('prizes','Prizes','Maker','now'); INSERT INTO pack_items(id,pack_id,item_key) VALUES(1,'prizes','material'),(2,'prizes','tag'); INSERT INTO signed_pack_items(item_id,png_path,material_id,aspect,name,rarity,finished,kind) VALUES(1,'','paper',1,'Paper','common',1,'material'),(2,'','',1,'Link tag','common',1,'tag');").unwrap();
        fs::create_dir(source.root().join("tag-icons")).unwrap();
        fs::write(source.root().join("tag-icons/cache.png"), b"cache").unwrap();
        export(&mut source, &file, PASS).unwrap();
        // The live source is untouched; only the exported snapshot gets a portable path.
        let original: String = source
            .db()
            .conn
            .query_row("SELECT card_path FROM market_listings_seen", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(original, path.to_str().unwrap());
        let (root, destination, permit) = blank(&parent);
        drop(destination);
        let prepared = prepare(&root, &file, PASS).unwrap();
        let mut swap = publish(&root, prepared, &permit).unwrap();
        let moved = swap.open_library().unwrap();
        let stored: String = moved
            .db()
            .conn
            .query_row("SELECT card_path FROM market_listings_seen", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored, relative);
        assert_eq!(
            crate::market::seen(&moved).unwrap()[0]
                .card
                .as_ref()
                .unwrap()
                .title,
            "Test card"
        );
        assert_eq!(
            moved
                .db()
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM signed_pack_items WHERE kind!='sticker'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            2
        );
        assert!(!root.join("tag-icons").exists());
        swap.finish().unwrap();
        drop(moved);
        drop(source);
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn duplicate_entries_and_undeclared_parents_are_rejected() {
        let parent = dir();
        let stage = parent.join("stage");
        for paths in [vec!["one", "one"], vec!["missing/child"]] {
            private_dir(&stage).unwrap();
            let plain = parent.join("plain");
            let mut out = private_file(&plain).unwrap();
            out.write_all(&(paths.len() as u32).to_be_bytes()).unwrap();
            for path in paths {
                out.write_all(&(path.len() as u32).to_be_bytes()).unwrap();
                out.write_all(path.as_bytes()).unwrap();
                out.write_all(&[0]).unwrap();
                out.write_all(&0o600u32.to_be_bytes()).unwrap();
                out.write_all(&0u64.to_be_bytes()).unwrap();
                out.write_all(&Sha256::digest([])).unwrap();
            }
            drop(out);
            assert!(extract(&plain, &stage).is_err());
            fs::remove_dir_all(&stage).unwrap();
            fs::remove_file(plain).unwrap();
        }
        fs::remove_dir_all(parent).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn substituted_stage_or_backup_symlinks_fail_closed() {
        for substitute_old in [false, true] {
            let (parent, source, file) = fixture();
            let (root, destination, permit) = blank(&parent);
            drop(destination);
            let prepared = prepare(&root, &file, PASS).unwrap();
            let mut swap = MoveSwap::begin(&root, prepared, &permit).unwrap();
            let external = parent.join("external");
            fs::create_dir(&external).unwrap();
            fs::write(external.join("sentinel"), b"safe").unwrap();
            let substituted = if substitute_old {
                swap.install().unwrap();
                parent.join(&swap.entry.old)
            } else {
                parent.join(&swap.entry.stage)
            };
            let saved = parent.join("saved-tree");
            fs::rename(&substituted, &saved).unwrap();
            std::os::unix::fs::symlink(&external, &substituted).unwrap();
            assert!(recover(&root).is_err());
            if substitute_old {
                assert!(swap.rollback().is_err());
            }
            assert_eq!(fs::read(external.join("sentinel")).unwrap(), b"safe");
            assert!(root.join("peta.db").is_file());
            std::mem::forget(swap);
            drop(source);
            fs::remove_dir_all(parent).unwrap();
        }
    }
}
