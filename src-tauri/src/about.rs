//! Local bundled notices. Legal service links are configured separately by the owner.
use tauri::{AppHandle,Manager};
#[tauri::command]
pub async fn about_notices(app:AppHandle)->Result<(),String> {
    let path=app.path().resolve("THIRD_PARTY_NOTICES",tauri::path::BaseDirectory::Resource).map_err(|e|e.to_string())?;
    if !path.is_file(){return Err("Third-party notices are unavailable. Reinstall Peta.".into());}
    tauri::async_runtime::spawn_blocking(move || {
        let status=std::process::Command::new("/usr/bin/open").args(["-a","TextEdit"]).arg(path).status().map_err(|e|e.to_string())?;
        if status.success(){Ok(())}else{Err("Could not open third-party notices.".into())}
    }).await.map_err(|e|e.to_string())?
}
