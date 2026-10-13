use peta_core::{Database,Library,gift,edition_pack,creator_pack,ownership};

#[test]
fn unchosen_name_is_empty_and_existing_names_are_preserved() {
    let mut db=Database::open_in_memory().unwrap();
    assert_eq!(db.display_name().unwrap(), "");
    assert!(db.require_display_name().is_err());
    db.set_display_name("Previous name").unwrap();
    assert_eq!(db.display_name().unwrap(), "Previous name");
    db.set_display_name("Nao").unwrap();assert_eq!(db.require_display_name().unwrap(), "Nao");
    db.set_display_name("").unwrap();assert_eq!(db.display_name().unwrap(), "");
}

#[test]
fn gifts_and_packs_require_a_name_before_touching_inventory() {
    let root=std::env::temp_dir().join(peta_core::ids::new_gift_id());
    let mut lib=Library::open(&root).unwrap();
    assert_eq!(gift::build_gift(&mut lib,"missing","Nao",None).err().unwrap().to_string(),"Choose your name in Settings before sharing.");
    let items:Vec<_>=(0..3).map(|n|edition_pack::Selection{sticker_id:format!("missing-{n}"),name:"Sticker".into(),copies:1}).collect();
    assert_eq!(edition_pack::press(&mut lib,"Test pack","kraft",&items,&[],&creator_pack::Dress::default(),true,&ownership::NoReferee,|_,_|panic!("must not publish")).err().unwrap().to_string(),"Choose your name in Settings before sharing.");
    assert_eq!(lib.db().sticker_count().unwrap(),0);assert!(!root.join("device.key").exists());
    drop(lib);std::fs::remove_dir_all(root).unwrap();
}
