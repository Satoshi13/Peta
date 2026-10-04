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
    let mut lib = Library::open(&dir).unwrap(); let bytes=original(); let session=Session::new(&bytes, None).unwrap();
    let rendered=session.render(&params()).unwrap(); let state=EditorState::capture(&session,20.0,0.3,0.5);
    let id=lib.add_made_with_editor(&rendered,&bytes,"png","kraft",&state).unwrap().id;
    (dir,lib,session,id)
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
fn edit_keeps_identity_stock_print_queue_position_and_sent_gift_across_restart() {
    let (dir,mut lib,mut session,id)=fixture();
    lib.db_mut().unlock_material("kraft").unwrap();lib.db_mut().add_material("kraft",1).unwrap();lib.db_mut().consume_material("kraft").unwrap();
    let sticker=lib.db().sticker(&id).unwrap().unwrap();let placement=lib.stick_new(&sticker,"display",0.3,0.6).unwrap();
    daily::confirm(lib.db_mut(),"2026-10-03",&id,SourceType::Created,0.5).unwrap();
    let old_png=lib.read_rendered(&id).unwrap();let (_,sent)=gift::build_gift(&mut lib,&id,"Nao",None).unwrap();
    session.stroke(&[(50.0,40.0)],12.0,false,true);
    let rendered=session.render(&params()).unwrap();let state=EditorState::capture(&session,20.0,0.3,0.5);
    lib.update_original(&id,&rendered,&state).unwrap();
    assert_ne!(lib.read_rendered(&id).unwrap(),old_png);assert_eq!(gift::decode_gift(&sent).unwrap().png,old_png);
    assert_eq!(lib.db().material_count("kraft").unwrap(),0);assert_eq!(lib.db().next_print().unwrap().as_deref(),Some(id.as_str()));
    assert_eq!(lib.db().on_desktop().unwrap(),vec![placement]);
    let changed=lib.db().sticker(&id).unwrap().unwrap();assert_eq!(changed.created_at,sticker.created_at);assert_eq!(changed.original_number,sticker.original_number);assert_eq!(changed.material_id,sticker.material_id);
    drop(lib);let lib=Library::open(&dir).unwrap();let (_,source,_,state)=lib.original_for_edit(&id).unwrap();
    assert_eq!(source,original());let mut reopened=Session::new(&source,None).unwrap();state.unwrap().restore(&mut reopened).unwrap();
    assert_eq!(reopened.render(&params()).unwrap().sticker_png,rendered.sticker_png);assert_eq!(lib.db().sticker_count().unwrap(),1);
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
fn delete_clears_book_desktop_queue_and_assets_without_reclaiming_stock_or_gifts() {
    let (dir,mut lib,session,id)=fixture();let s=lib.db().sticker(&id).unwrap().unwrap();
    lib.stick_new(&s,"display",0.4,0.5).unwrap();daily::confirm(lib.db_mut(),"2026-10-03",&id,SourceType::Created,0.5).unwrap();
    let (_,sent)=gift::build_gift(&mut lib,&id,"Nao",None).unwrap();let png=lib.read_rendered(&id).unwrap();
    lib.delete_original(&id).unwrap();assert!(lib.db().sticker(&id).unwrap().is_none());assert!(lib.db().next_print().unwrap().is_none());
    assert!(lib.db().on_desktop().unwrap().is_empty());assert!(lib.db().book_rows().unwrap().is_empty());assert!(!dir.join("assets/stickers").join(&id).exists());
    assert_eq!(gift::decode_gift(&sent).unwrap().png,png);assert_eq!(lib.db().material_count("kraft").unwrap(),0);
    let bytes=original();let state=EditorState::capture(&session,20.0,0.3,0.5);let next=lib.add_made_with_editor(&session.render(&params()).unwrap(),&bytes,"png","kraft",&state).unwrap();
    assert!(next.original_number.unwrap()>s.original_number.unwrap());
    drop(lib);let lib=Library::open(&dir).unwrap();assert!(lib.db().sticker(&id).unwrap().is_none());drop(lib);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn pack_and_received_stickers_cannot_be_edited_or_deleted() {
    let (dir,mut lib,session,_)=fixture();let bytes=original();let rendered=session.render(&params()).unwrap();
    let pack=lib.add_from_pack(&rendered,&bytes,"png","Pack","Nao","kraft").unwrap();
    let (_,sealed)=gift::build_gift(&mut lib,&pack.id,"Me",None).unwrap();let incoming=gift::receive_gift(&mut lib,&sealed).unwrap();let received=gift::open_gift(&mut lib,&incoming.gift_id).unwrap();
    for id in [pack.id,received.id] {
        assert!(lib.original_for_edit(&id).is_err());assert!(lib.delete_original(&id).is_err());assert!(lib.db().sticker(&id).unwrap().is_some());
    }
    drop(lib);fs::remove_dir_all(dir).unwrap();
}
