use std::{fs, io::Cursor, path::PathBuf};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use peta_core::{creator::{EditorState, Params, Session}, daily, gift, ids, materials, Library, SourceType};

fn original() -> Vec<u8> {
    let mut image = RgbaImage::new(100, 80);
    for y in 12..68 { for x in 14..86 { image.put_pixel(x, y, Rgba([100 + x as u8, 80, 60 + y as u8, 255])); } }
    let mut bytes = Cursor::new(Vec::new()); DynamicImage::ImageRgba8(image).write_to(&mut bytes, ImageFormat::Png).unwrap(); bytes.into_inner()
}
fn params() -> Params { Params { strength: 0.5, smooth: 0.3, recipe: materials::get("kraft").unwrap().recipe } }
fn fixture() -> (PathBuf, Library, Session, String) {
    let dir = std::env::temp_dir().join(format!("peta-original-test-{}", ids::new_sticker_id()));
    let mut lib = Library::open(&dir).unwrap(); lib.db_mut().set_display_name("Maker").unwrap(); let bytes=original(); let session=Session::new(&bytes, None).unwrap();
    let rendered=session.render(&params()).unwrap(); let state=EditorState::capture(&session,20.0,0.3,0.5);
    let id=lib.add_made_with_editor(&rendered,&bytes,"png","kraft",&state).unwrap().id;
    (dir,lib,session,id)
}
/// Load pre-removal copy rows without exposing a creation API in the application.
fn legacy_copies(lib:&Library,id:&str,count:u32)->Vec<peta_core::Sticker> {
    let mut conn=rusqlite::Connection::open(lib.root().join("peta.db")).unwrap();let tx=conn.transaction().unwrap();let mut ids=Vec::new();
    for no in 2..count+2 {
        let copy=ids::new_sticker_id();
        tx.execute("INSERT INTO stickers(id,created_at,original_asset_path,rendered_asset_path,mask_asset_path,material_id,source_type,aspect,lineage,copy_of,copy_no) SELECT ?2,created_at,original_asset_path,rendered_asset_path,mask_asset_path,material_id,'collection',aspect,'copy',id,?3 FROM stickers WHERE id=?1",rusqlite::params![id,copy,no]).unwrap();ids.push(copy);
    }
    tx.commit().unwrap();ids.into_iter().map(|id|lib.db().sticker(&id).unwrap().unwrap()).collect()
}
#[test]
fn editor_roundtrip_keeps_saved_brushwork_and_new_undo_returns_to_it() {
    let bytes=original(); let mut session=Session::new(&bytes,None).unwrap();
    session.stroke(&[(40.0,40.0)],7.0,false,true);
    let saved=session.render(&params()).unwrap().sticker_png;
    let state=EditorState::capture(&session,20.0,0.3,0.5);
    let state: EditorState=serde_json::from_slice(&serde_json::to_vec(&state).unwrap()).unwrap();
    let mut reopened=Session::new(&bytes,None).unwrap();state.restore(&mut reopened).unwrap();
    assert_eq!(reopened.render(&params()).unwrap().sticker_png,saved);
    reopened.stroke(&[(65.0,40.0)],7.0,false,true);
    assert_ne!(reopened.render(&params()).unwrap().sticker_png,saved);
    assert!(reopened.undo());assert_eq!(reopened.render(&params()).unwrap().sticker_png,saved);
    let mut invalid=state;invalid.outline=f32::NAN;assert!(invalid.restore(&mut reopened).is_err());
    assert!(reopened.restore_mask(&original()).is_ok());
}
#[test]
fn edit_keeps_identity_stock_print_queue_position_and_copies_across_restart() {
    let (dir,mut lib,mut session,id)=fixture();
    lib.db_mut().unlock_material("kraft").unwrap();lib.db_mut().add_material("kraft",1).unwrap();lib.db_mut().consume_material("kraft").unwrap();
    let sticker=lib.db().sticker(&id).unwrap().unwrap();let placement=lib.stick_new(&sticker,"display",0.3,0.6).unwrap();
    daily::confirm(lib.db_mut(),"2026-10-03",&id,SourceType::Created,0.5).unwrap();
    let old_png=lib.read_rendered(&id).unwrap();let copies=legacy_copies(&lib,&id,1);
    session.stroke(&[(50.0,40.0)],12.0,false,true);
    let rendered=session.render(&params()).unwrap();let state=EditorState::capture(&session,20.0,0.3,0.5);
    lib.update_original(&id,&rendered,&state).unwrap();
    assert_ne!(lib.read_rendered(&id).unwrap(),old_png);assert_eq!(lib.read_rendered(&copies[0].id).unwrap(),rendered.sticker_png);
    assert_eq!(lib.db().material_count("kraft").unwrap(),0);assert_eq!(lib.db().next_print().unwrap().as_deref(),Some(id.as_str()));
    assert_eq!(lib.db().on_desktop().unwrap(),vec![placement]);
    let changed=lib.db().sticker(&id).unwrap().unwrap();assert_eq!(changed.created_at,sticker.created_at);assert_eq!(changed.original_number,sticker.original_number);assert_eq!(changed.material_id,sticker.material_id);
    drop(lib);let lib=Library::open(&dir).unwrap();let (_,source,_,state)=lib.original_for_edit(&id).unwrap();
    assert_eq!(source,original());let mut reopened=Session::new(&source,None).unwrap();state.unwrap().restore(&mut reopened).unwrap();
    assert_eq!(reopened.render(&params()).unwrap().sticker_png,rendered.sticker_png);assert_eq!(lib.db().sticker_count().unwrap(),2);
    drop(lib);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn failed_revision_write_preserves_previous_files_and_database_pointer() {
    let (dir,mut lib,mut session,id)=fixture();let before=lib.db().sticker(&id).unwrap().unwrap();let png=lib.read_rendered(&id).unwrap();
    fs::write(dir.join("assets/stickers").join(&id).join("revisions"),b"blocked").unwrap();
    session.stroke(&[(50.0,40.0)],10.0,false,true);let state=EditorState::capture(&session,20.0,0.3,0.5);
    assert!(lib.update_original(&id,&session.render(&params()).unwrap(),&state).is_err());
    assert_eq!(lib.db().sticker(&id).unwrap().unwrap(),before);assert_eq!(lib.read_rendered(&id).unwrap(),png);
    drop(lib);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn delete_clears_book_desktop_queue_copies_and_assets_without_reclaiming_stock() {
    let (dir,mut lib,session,id)=fixture();let s=lib.db().sticker(&id).unwrap().unwrap();
    lib.stick_new(&s,"display",0.4,0.5).unwrap();daily::confirm(lib.db_mut(),"2026-10-03",&id,SourceType::Created,0.5).unwrap();
    legacy_copies(&lib,&id,2);
    lib.delete_original(&id).unwrap();assert!(lib.db().sticker(&id).unwrap().is_none());assert!(lib.db().next_print().unwrap().is_none());
    assert!(lib.db().on_desktop().unwrap().is_empty());assert!(lib.db().book_rows().unwrap().is_empty());assert!(!dir.join("assets/stickers").join(&id).exists());
    assert_eq!(lib.db().material_count("kraft").unwrap(),0);
    let bytes=original();let state=EditorState::capture(&session,20.0,0.3,0.5);let next=lib.add_made_with_editor(&session.render(&params()).unwrap(),&bytes,"png","kraft",&state).unwrap();
    assert!(next.original_number.unwrap()>s.original_number.unwrap());
    drop(lib);let lib=Library::open(&dir).unwrap();assert!(lib.db().sticker(&id).unwrap().is_none());drop(lib);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn pack_and_received_stickers_cannot_be_edited_or_deleted() {
    let (dir,mut lib,session,_)=fixture();let bytes=original();let rendered=session.render(&params()).unwrap();
    let pack=lib.add_from_pack(&rendered,&bytes,"png","Pack","Nao","kraft").unwrap();
    let (_,sealed)=gift::build_gift(&mut lib,&pack.id,"Me",None).unwrap();let mut other=Library::open(&dir.join("receiver")).unwrap();let incoming=gift::receive_gift(&mut other,&sealed).unwrap();let received=gift::open_gift(&mut other,&incoming.gift_id).unwrap();
    assert!(other.original_for_edit(&received.id).is_err());assert!(other.delete_original(&received.id).is_err());
    for id in [pack.id] {
        assert!(lib.original_for_edit(&id).is_err());assert!(lib.delete_original(&id).is_err());assert!(lib.db().sticker(&id).unwrap().is_some());
    }
    drop(lib);fs::remove_dir_all(dir).unwrap();
}

#[test]
fn registered_or_attempted_originals_require_a_new_identity() {
    let (dir,mut lib,mut session,id)=fixture();
    assert!(!lib.original_edit_requires_new(&id).unwrap());
    let conn=rusqlite::Connection::open(dir.join("peta.db")).unwrap();
    conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES ('server.migrated_at','2026-10-13')",[]).unwrap();
    conn.execute("UPDATE stickers SET checked='pending' WHERE id=?1",[&id]).unwrap();
    assert!(!lib.original_edit_requires_new(&id).unwrap());
    conn.execute("INSERT INTO referee_outbox(kind,target,body,queued_at,attempts) VALUES ('register',?1,'{}','2026-10-13',0)",[&id]).unwrap();
    assert!(!lib.original_edit_requires_new(&id).unwrap());
    conn.execute("UPDATE referee_outbox SET attempts=1 WHERE target=?1",[&id]).unwrap();
    assert!(lib.original_edit_requires_new(&id).unwrap());
    let before=lib.db().sticker(&id).unwrap().unwrap(); let old_png=lib.read_rendered(&id).unwrap();
    session.stroke(&[(50.0,40.0)],12.0,false,true);
    let rendered=session.render(&params()).unwrap(); let state=EditorState::capture(&session,20.0,0.3,0.5);
    assert!(lib.update_original(&id,&rendered,&state).is_err());
    assert_eq!(lib.db().sticker(&id).unwrap().unwrap(),before);
    assert_eq!(lib.read_rendered(&id).unwrap(),old_png);
    conn.execute("DELETE FROM referee_outbox WHERE target=?1",[&id]).unwrap();
    conn.execute("UPDATE stickers SET checked='checked' WHERE id=?1",[&id]).unwrap();
    assert!(lib.original_edit_requires_new(&id).unwrap());
    let next=lib.add_made_with_editor(&rendered,&original(),"png","kraft",&state).unwrap();
    assert_ne!(next.id,id); assert_ne!(next.original_number,before.original_number);
    assert_eq!(next.lineage,"real"); assert!(next.copy_of.is_none()); assert!(!next.new_image);
    assert_eq!(lib.read_rendered(&id).unwrap(),old_png);
    assert_eq!(lib.read_rendered(&next.id).unwrap(),rendered.sticker_png);
    assert_eq!(peta_core::server::checked(lib.db(),&id).unwrap().as_deref(),Some("checked"));
    assert_eq!(peta_core::server::checked(lib.db(),&next.id).unwrap().as_deref(),Some("pending"));
    drop(conn); drop(lib); fs::remove_dir_all(dir).unwrap();
}
