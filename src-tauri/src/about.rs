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

// Publish owner-reviewed documents by setting these URLs here, then rebuilding.
const SERVICE_LINKS: [(&str, &str, Option<&str>); 2] = [
    ("terms", "Terms of use", None),
    ("privacy", "Privacy policy", None),
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
    fn unset_documents_are_hidden_and_cannot_be_opened() {
        assert!(about_links().is_empty());
        for id in ["terms", "privacy", "https://example.invalid", "--help"] {
            assert!(service_url(id).is_err());
        }
    }
}
