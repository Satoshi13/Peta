//! Local bundled notices. Legal service links are configured separately by the owner.
use tauri::{AppHandle, Manager};
#[tauri::command]
pub async fn about_notices(app: AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .resolve("THIRD_PARTY_NOTICES", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("Third-party notices are unavailable. Reinstall Peta.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let status = std::process::Command::new("/usr/bin/open")
            .args(["-a", "TextEdit"])
            .arg(path)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not open third-party notices.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// The owner-reviewed documents, served by peta-api from docs/legal (scripts/build-legal.py). Developer builds read dev's copy.
const SERVICE_LINKS: [(&str, &str, Option<&str>); 2] = [
    ("terms", "Terms of use", Some(if cfg!(feature = "developer") { "https://peta-api-dev.peta-api.workers.dev/terms" } else { "https://peta-api-prod.peta-api.workers.dev/terms" })),
    ("privacy", "Privacy policy", Some(if cfg!(feature = "developer") { "https://peta-api-dev.peta-api.workers.dev/privacy" } else { "https://peta-api-prod.peta-api.workers.dev/privacy" })),
];
#[derive(serde::Serialize)]
pub struct ServiceLink {
    id: &'static str,
    label: &'static str,
}
fn service_url(id: &str) -> Result<&'static str, String> {
    let url = SERVICE_LINKS
        .iter()
        .find(|(key, _, _)| *key == id)
        .and_then(|(_, _, url)| *url)
        .ok_or("This document is not available yet.")?;
    if !url.starts_with("https://") || url.contains(['\r', '\n']) {
        return Err("The document URL is not configured correctly.".into());
    }
    Ok(url)
}
#[tauri::command]
pub fn about_links() -> Vec<ServiceLink> {
    SERVICE_LINKS
        .iter()
        .filter(|(id, _, _)| service_url(id).is_ok())
        .map(|(id, label, _)| ServiceLink { id, label })
        .collect()
}
#[tauri::command]
pub async fn about_open_link(id: String) -> Result<(), String> {
    let url = service_url(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let status = std::process::Command::new("/usr/bin/open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not open this document.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configured_documents_are_listed_and_arbitrary_links_are_refused() {
        assert_eq!(about_links().iter().map(|l|l.id).collect::<Vec<_>>(), ["terms", "privacy"]);
        let host = if cfg!(feature="developer") { "https://peta-api-dev.peta-api.workers.dev" } else { "https://peta-api-prod.peta-api.workers.dev" };
        for id in ["terms", "privacy"] { assert_eq!(service_url(id).unwrap(), format!("{host}/{id}")); }
        for id in ["https://example.invalid", "--help", "unknown"] { assert!(service_url(id).is_err()); }
    }
}
