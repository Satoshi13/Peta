//! Compiled only by the isolated owner test; impossible to select a real Peta library or production API.
use tauri::Manager;
fn snapshot(app: &tauri::AppHandle) -> serde_json::Value {
    let mut value = {
        let store = app.state::<crate::store::Store>();
        let lib = store.lock();
        serde_json::json!({"marker":lib.db().setting("updater.test.marker").unwrap(),"stickers":lib.db().sticker_count().unwrap(),"friends":lib.db().friends().unwrap().len(),"scraps":lib.db().scrap_status().unwrap().balance,"invite":std::fs::read_to_string(lib.root().join("invite.ok")).unwrap_or_default()})
    };
    value["location"] = serde_json::to_value(crate::board_auto::location(app)).unwrap();
    value
}
fn seed(app: &tauri::AppHandle) -> Result<(), String> {
    let store = app.state::<crate::store::Store>();
    let mut lib = store.lock();
    if lib
        .db()
        .setting("updater.test.marker")
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Ok(());
    }
    lib.db_mut()
        .set_setting("updater.test.marker", "preserved-through-update")
        .map_err(|e| e.to_string())?;
    lib.db_mut().scrap_welcome().map_err(|e| e.to_string())?;
    let png = include_bytes!("../../src/art/samples/good-day.png");
    let processed = peta_core::process_image(png).map_err(|e| e.to_string())?;
    lib.add_created(&processed, png, Some("test"), Some("matte"))
        .map_err(|e| e.to_string())?;
    let friend_root = lib.root().join("test-friend");
    std::fs::create_dir_all(&friend_root).map_err(|e| e.to_string())?;
    let friend = peta_core::identity::code_here(&friend_root, "Disposable test friend")
        .map_err(|e| e.to_string())?;
    let key = peta_core::device_key::load_or_create(lib.root()).map_err(|e| e.to_string())?;
    let me = peta_core::sign::public_key(&key);
    lib.db_mut()
        .friend_request_sent(&me, &friend, "test-request")
        .map_err(|e| e.to_string())?;
    lib.db_mut()
        .friend_accepted(&friend.sign_key)
        .map_err(|e| e.to_string())?;
    std::fs::write(lib.root().join("invite.ok"), me).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let root = std::path::PathBuf::from(std::env::var_os("PETA_UPDATER_TEST_ROOT").unwrap());
        let result:Result<(),String>=async {
            let version=app.package_info().version.to_string();
            if version=="0.0.2-test" {
                let before:serde_json::Value=serde_json::from_slice(&std::fs::read(root.join("before.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
                let after=snapshot(&app);let mut previous=before.clone();let mut current=after.clone();previous.as_object_mut().unwrap().remove("location");current.as_object_mut().unwrap().remove("location");let same=previous==current;let permissions=before["location"]==after["location"];
                std::fs::write(root.join("result.json"),serde_json::to_vec_pretty(&serde_json::json!({"version":version,"dataPreserved":same,"permissionsPreserved":permissions,"before":before,"after":after})).unwrap()).map_err(|e|e.to_string())?;
                app.exit(if same{0}else{1});return Ok(());
            }
            if version!="0.0.1-test" {return Err("Only the two disposable test versions may run this harness.".into());}
            seed(&app)?;
            if std::env::var_os("PETA_UPDATER_TEST_LOCATION").is_some() && crate::board_auto::location(&app).status=="unknown" {
                crate::board_auto::boards_location_request(app.clone()).await?;
                for _ in 0..120 {
                    if crate::board_auto::location(&app).status!="unknown" {break;}
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            }
            std::fs::write(root.join("before.json"),serde_json::to_vec_pretty(&snapshot(&app)).unwrap()).map_err(|e|e.to_string())?;
            let state=crate::updater::update_check(app.clone(),true).await?;
            let _=state;
            crate::updater::update_install(app.clone())?;Ok(())
        }.await;
        if let Err(error) = result {
            let _ = std::fs::write(root.join("failed.txt"), error);
            app.exit(1);
        }
    });
}
