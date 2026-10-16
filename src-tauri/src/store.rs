//! Tauri-side owner of the sticker library (peta-core): opening it, first-run seeding,
//! migrating the Phase 0 JSON file, and importing image files.

use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, MutexGuard,
    },
};

use peta_core::{process_image, Library, Placement, Sticker};
use tauri::{AppHandle, Manager};

/// Bundled sample so a first launch has something on the desktop.
const SAMPLE_CAT: &[u8] = include_bytes!("../assets/sample-cat.png");

const LEGACY_JSON: &str = "placements.json";

pub struct Store {
    lib: Mutex<Option<Library>>,
    needs_seed: AtomicBool,
    fresh_origin: AtomicBool,
    fresh_permit: Mutex<Option<peta_core::migration::MovePermit>>,
    cache_writes: Mutex<()>,
}

impl Default for Store {
    fn default() -> Self {
        Store { lib: Mutex::new(None), needs_seed: AtomicBool::new(false), fresh_origin:AtomicBool::new(false), fresh_permit:Mutex::new(None), cache_writes:Mutex::new(()) }
    }
}

pub struct Locked<'a>(MutexGuard<'a, Option<Library>>);

impl std::ops::Deref for Locked<'_> {
    type Target = Library;
    fn deref(&self) -> &Library {
        self.0.as_ref().expect("library not opened")
    }
}
impl std::ops::DerefMut for Locked<'_> {
    fn deref_mut(&mut self) -> &mut Library {
        self.0.as_mut().expect("library not opened")
    }
}

impl Store {
    pub fn lock(&self) -> Locked<'_> {
        Locked(self.lib.lock().unwrap())
    }

    pub fn open(&self, app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        #[cfg(feature="updater-test")]
        let dir = {
            let _=dir;
            let path=std::path::PathBuf::from(std::env::var_os("PETA_UPDATER_TEST_ROOT").ok_or("Test library path required")?);
            let temp=std::env::temp_dir().canonicalize()?;
            if !path.is_dir() || path.canonicalize()?!=path || !path.starts_with(temp) || app.config().identifier!="app.peta.updater-test" {return Err("Updater test requires a canonical isolated temporary library without symlinks.".into());}
            path
        };
        if let Some(parent)=dir.parent(){fs::create_dir_all(parent)?;}
        peta_core::migration::recover(&dir)?;
        let fresh=match fs::symlink_metadata(&dir){
            Ok(meta)=>meta.is_dir()&&!meta.file_type().is_symlink()&&fs::read_dir(&dir)?.next().is_none(),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>true,
            Err(e)=>return Err(e.into()),
        };
        self.fresh_origin.store(fresh,Ordering::SeqCst);
        fs::create_dir_all(&dir)?;
        let first_run = !dir.join("peta.db").exists() && !dir.join(LEGACY_JSON).exists();
        let mut lib = Library::open(&dir)?;
        #[cfg(feature="developer")]
        lib.db_mut().enable_developer()?;

        if dir.join(LEGACY_JSON).exists() && lib.db().sticker_count()? == 0 {
            migrate_legacy_json(&mut lib, &dir.join(LEGACY_JSON));
        }
        if let Err(e) = peta_core::pack::ensure_welcome_pack(lib.db_mut()) {
            eprintln!("[peta] installing the Welcome Pack failed: {e}");
        }
        #[cfg(feature="server")]
        peta_core::server::migrate(&mut lib)?;
        *self.lib.lock().unwrap() = Some(lib);
        self.needs_seed.store(first_run, Ordering::SeqCst);
        Ok(())
    }

    /// Called once after the frontend's synchronous built-in bootstrap, before interaction.
    pub fn capture_move_bootstrap(&self)->Result<(),String>{
        if !self.fresh_origin.load(Ordering::SeqCst){return Ok(());}
        let lib=self.lock();let mut permit=self.fresh_permit.lock().unwrap();
        if permit.is_none(){*permit=Some(peta_core::migration::permit_bootstrap(&lib).map_err(|e|e.to_string())?);}
        Ok(())
    }
    pub fn can_import_move(&self)->Result<bool,String>{
        if !self.fresh_origin.load(Ordering::SeqCst){return Ok(false);}
        let lib=self.lock();let permit=self.fresh_permit.lock().unwrap();
        match permit.as_ref(){Some(p)=>p.is_current(&lib).map_err(|e|e.to_string()),None=>Ok(false)}
    }
    pub fn with_cache_write<T>(&self,write:impl FnOnce()->T)->T{let _cache=self.cache_writes.lock().unwrap();write()}
    pub fn import_move(&self,input:&Path,passphrase:&str)->Result<(),String>{
        if !self.can_import_move()?{return Err("Restore on the first launch of a fresh installation, before you use Peta or close it.".into());}
        let root=self.lock().root().to_owned();
        if input.canonicalize().map_err(|e|e.to_string())?.starts_with(root.canonicalize().map_err(|e|e.to_string())?){return Err("Choose a move file outside the Peta data folder.".into());}
        let prepared=peta_core::migration::prepare(&root,input,passphrase).map_err(|e|e.to_string())?;
        let expected=prepared.fingerprint().to_owned();
        // Cache writers cannot recreate the live root in the gap between its two renames.
        let _cache=self.cache_writes.lock().unwrap();let mut current=self.lib.lock().unwrap();
        let permit=self.fresh_permit.lock().unwrap().as_ref().cloned().ok_or("This library is not empty.")?;
        if !self.fresh_origin.load(Ordering::SeqCst)||!permit.is_current(current.as_ref().ok_or("Library unavailable.")?).map_err(|e|e.to_string())?{return Err("This library changed while the move file was being opened. Restore only into an empty library.".into());}
        drop(current.take());
        let result=(||->peta_core::Result<()> {
            let mut swap=peta_core::migration::publish(&root,prepared,&permit)?;
            let moved=match swap.open_library(){Ok(lib)=>lib,Err(e)=>{swap.rollback()?;return Err(e);}};
            match swap.finish(){
                Ok(())=>{*current=Some(moved);Ok(())},
                Err(e)=>{drop(moved);if !swap.committed(){swap.rollback()?;} peta_core::migration::recover(&root)?;
                    if peta_core::migration::matches(&root,&expected)?{*current=Some(Library::open(&root)?);Ok(())}else{Err(e)}
                },
            }
        })();
        if current.is_none(){*current=Some(Library::open(&root).map_err(|e|e.to_string())?);}
        if result.is_ok(){self.fresh_origin.store(false,Ordering::SeqCst);self.needs_seed.store(false,Ordering::SeqCst);}
        else{*self.fresh_permit.lock().unwrap()=Some(peta_core::migration::permit_bootstrap(current.as_ref().unwrap()).map_err(|e|e.to_string())?);}
        result.map_err(|e|e.to_string())
    }

    /// First launch only: one sample cat on the primary display.
    pub fn seed_if_needed(&self, primary_display_id: &str) {
        if self.needs_seed.swap(false, Ordering::SeqCst) {
            if let Err(e) = self.add_sample(primary_display_id) {
                eprintln!("[peta] seeding sample failed: {e}");
            }
        }
    }

    pub fn add_sample(&self, display_id: &str) -> Result<Sticker, String> {
        self.import_bytes(SAMPLE_CAT, display_id, 0.72, 0.31)
    }

    /// Placements to draw (everything currently on the desktop, bottom -> top).
    pub fn on_desktop(&self) -> Vec<Placement> {
        self.lock().db().on_desktop().unwrap_or_else(|e| {
            eprintln!("[peta] reading placements failed: {e}");
            Vec::new()
        })
    }

    /// Developer path: decode + downscale OUTSIDE the lock (it's the slow part), then store and stick it down.
    /// Ignores the Daily Slot — real Create goes through `today::create_today`.
    pub fn import_bytes(&self, bytes: &[u8], display_id: &str, rx: f64, ry: f64) -> Result<Sticker, String> {
        let processed = process_image(bytes).map_err(|e| e.to_string())?;
        let mut lib = self.lock();
        let sticker = lib.add_created(&processed, bytes, None, None).map_err(|e| e.to_string())?;
        lib.stick_new(&sticker, display_id, rx, ry).map_err(|e| e.to_string())?;
        Ok(sticker)
    }
}

/// Phase 0 kept one sample cat in placements.json. Carry its position over, then retire the file.
fn migrate_legacy_json(lib: &mut Library, json: &Path) {
    let migrated = (|| -> Result<(), String> {
        let bytes = fs::read(json).map_err(|e| e.to_string())?;
        let legacy: Vec<Placement> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        for old in legacy {
            let processed = process_image(SAMPLE_CAT).map_err(|e| e.to_string())?;
            let sticker = lib.add_created(&processed, SAMPLE_CAT, None, None).map_err(|e| e.to_string())?;
            lib.db_mut()
                .place(Placement { sticker_id: sticker.id, z: 0, ..old })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    match migrated {
        Ok(()) => {
            let _ = fs::rename(json, json.with_extension("json.migrated"));
        }
        Err(e) => eprintln!("[peta] legacy placements.json not migrated: {e}"),
    }
}
