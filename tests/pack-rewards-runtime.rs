//! Production pack commands with real SQLite/assets and a minimal Tauri state/asset adapter.
//! This verifies command behavior without GTK; it does not exercise native IPC or windows.
extern crate self as tauri;
pub use tauri_test_macros::command;
use std::{any::{Any,TypeId}, future::Future, path::PathBuf, sync::{Arc,Mutex}, task::{Context,Poll,Wake,Waker}};

pub type State<T> = Arc<T>;
#[derive(Clone)]
pub struct AppHandle { store:Arc<store::Store>, today:Arc<today::Today>, asset:Option<Vec<u8>> }
pub trait Manager { fn state<T:Send+Sync+'static>(&self)->Arc<T>; }
impl Manager for AppHandle {
    fn state<T:Send+Sync+'static>(&self)->Arc<T> {
        let value:Arc<dyn Any+Send+Sync>=if TypeId::of::<T>()==TypeId::of::<store::Store>() {self.store.clone()}else{self.today.clone()};
        value.downcast().ok().unwrap()
    }
}
pub struct Asset { pub bytes:Vec<u8> }
pub struct Resolver(Option<Vec<u8>>);
impl Resolver { pub fn get(&self,_:String)->Option<Asset> {self.0.clone().map(|bytes|Asset{bytes})} }
impl AppHandle { pub fn asset_resolver(&self)->Resolver {Resolver(self.asset.clone())} }
pub mod async_runtime {
    pub async fn spawn_blocking<T>(f:impl FnOnce()->T)->Result<T,String> {Ok(f())}
}
mod store {
    use super::*;
    pub struct Store(pub Mutex<peta_core::Library>);
    impl Store {pub fn lock(&self)->std::sync::MutexGuard<'_,peta_core::Library>{self.0.lock().unwrap()}}
}
mod today {
    pub struct Today;
    impl Today {pub fn date(&self)->String{"2026-10-07".into()}}
    pub fn announce(_: &super::AppHandle) {}
}
#[path="../src-tauri/src/packs.rs"] mod packs;
struct Noop;
impl Wake for Noop {fn wake(self:Arc<Self>) {}}
fn run<T>(future:impl Future<Output=T>)->T {
    let waker=Waker::from(Arc::new(Noop));let mut cx=Context::from_waker(&waker);let mut f=std::pin::pin!(future);
    match f.as_mut().poll(&mut cx) {Poll::Ready(value)=>value,Poll::Pending=>panic!("adapter should complete immediately")}
}
struct Fixture {app:AppHandle,dir:PathBuf}
impl Fixture {
    fn new(opened:usize,total:usize)->Self {
        let dir=std::env::temp_dir().join(format!("peta-pack-command-{}",peta_core::ids::new_sticker_id()));
        let mut lib=peta_core::Library::open(&dir).unwrap();
        lib.db_mut().pack_install("welcome","Welcome Pack","Peta",&vec!["cat-skateboard";total]).unwrap();
        for n in 0..opened {
            let (id,_)=lib.db().pack_pick("welcome",0.0).unwrap().unwrap();
            lib.db_mut().pack_open_on(id,&format!("old-{n}"),&format!("2026-10-{:02}",n+1)).unwrap();
        }
        let mut bytes=std::io::Cursor::new(Vec::new());
        let mut image=image::RgbaImage::new(24,20);
        for y in 4..16 {for x in 4..20 {image.put_pixel(x,y,image::Rgba([140,90,50,255]));}}
        image.write_to(&mut bytes,image::ImageFormat::Png).unwrap();
        Self{app:AppHandle{store:Arc::new(store::Store(Mutex::new(lib))),today:Arc::new(today::Today),asset:Some(bytes.into_inner())},dir}
    }
    fn free(&self)->Result<packs::Opened,String> {run(packs::pack_open_free(self.app.clone(),"welcome".into()))}
}
impl Drop for Fixture {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.dir);}}

#[test]
fn free_command_adds_a_real_copy_and_queue_entry_without_spending_stock_or_welcome_quota() {
    let f=Fixture::new(10,12);
    let status=packs::pack_status(f.app.clone(),f.app.store.clone()).unwrap();
    assert!(!status.can_open);assert_eq!(status.packs[0].free_openings,1);
    let opened=f.free().unwrap();
    assert_eq!(opened.remaining,2);
    let lib=f.app.store.lock();
    assert_eq!(lib.db().pack_free_openings("welcome").unwrap(),0);
    assert_eq!(lib.db().next_print().unwrap().as_deref(),Some(opened.sticker_id.as_str()));
    assert!(lib.db().book_rows().unwrap().iter().any(|r|r.sticker_id==opened.sticker_id && r.daily_date.as_deref()==Some("2026-10-07")));
    assert!(lib.read_rendered(&opened.sticker_id).unwrap().starts_with(b"\x89PNG"));
    assert_eq!(lib.db().packs().unwrap()[0].total,12);
    assert_eq!(lib.db().sticker(&opened.sticker_id).unwrap().unwrap().original_number,None);
    assert!(!lib.db().welcome_available("2026-10-07").unwrap());
    drop(lib);
    assert!(f.free().is_err());
    assert_eq!(f.app.store.lock().db().sticker_count().unwrap(),1);
}

#[test]
fn exhausted_pack_and_unspent_daily_allowance_both_work_with_a_bonus() {
    let f=Fixture::new(10,10);
    // Today's allowance is independently available after moving the fixture's daily clock.
    let conn=rusqlite::Connection::open(f.dir.join("peta.db")).unwrap();
    conn.execute("DELETE FROM welcome_openings WHERE date='2026-10-07'",[]).unwrap();
    assert!(f.app.store.lock().db().welcome_available("2026-10-07").unwrap());
    assert_eq!(f.free().unwrap().remaining,0);
    assert!(f.app.store.lock().db().welcome_available("2026-10-07").unwrap());
}

#[test]
fn asset_failure_preserves_credit_and_creates_no_copy() {
    let mut f=Fixture::new(10,10);f.app.asset=None;
    assert!(f.free().err().unwrap().contains("picture"));
    let lib=f.app.store.lock();
    assert_eq!(lib.db().pack_free_openings("welcome").unwrap(),1);
    assert_eq!(lib.db().sticker_count().unwrap(),0);
}

#[test]
fn transaction_failure_preserves_credit_and_removes_prepared_copy_and_assets() {
    let f=Fixture::new(10,10);
    let conn=rusqlite::Connection::open(f.dir.join("peta.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_bonus BEFORE INSERT ON sticker_events BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
    assert!(f.free().is_err());
    let lib=f.app.store.lock();
    assert_eq!(lib.db().pack_free_openings("welcome").unwrap(),1);
    assert_eq!(lib.db().sticker_count().unwrap(),0);
    assert!(lib.db().next_print().unwrap().is_none());
    assert_eq!(std::fs::read_dir(f.dir.join("assets/stickers")).unwrap().count(),0);
    drop(lib);conn.execute_batch("DROP TRIGGER fail_bonus;").unwrap();
    f.free().unwrap();
}

#[test]
fn normal_command_still_obeys_welcome_limit_and_does_not_spend_a_bonus() {
    let f=Fixture::new(10,12);
    assert_eq!(run(packs::pack_open(f.app.clone(),"welcome".into())).err().unwrap(),"welcome_already_opened_today");
    assert_eq!(f.app.store.lock().db().pack_free_openings("welcome").unwrap(),1);
}
