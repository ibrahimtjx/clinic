//! Per-PC settings: the server address and which printers to use (SPEC 2, 3.8).

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PcConfig {
    /// e.g. "https://clinic-server" (no trailing slash).
    pub server: Option<String>,
    /// Printer for A4 documents; empty = the Windows default printer.
    #[serde(default)]
    pub a4_printer: String,
    /// Printer for receipts and slips (80 mm); empty = the Windows default printer.
    #[serde(default)]
    pub receipt_printer: String,
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> PcConfig {
    path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, cfg: &PcConfig) -> Result<(), String> {
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path(app)?, text).map_err(|e| e.to_string())
}

/// Accepts "clinic-server", "192.168.1.10" or "https://clinic-server/"; returns "https://host[:port]".
pub fn normalize_server(input: &str) -> Result<String, String> {
    let raw = input.trim().trim_end_matches('/');
    if raw.is_empty() {
        return Err("server_required".into());
    }
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url = url::Url::parse(&with_scheme).map_err(|_| "server_invalid".to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.path() != "/" && !url.path().is_empty()
    {
        return Err("server_invalid".into());
    }
    let host = url.host_str().unwrap();
    Ok(match url.port() {
        Some(p) => format!("https://{host}:{p}"),
        None => format!("https://{host}"),
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_server;

    #[test]
    fn server_addresses() {
        assert_eq!(
            normalize_server("clinic-server").unwrap(),
            "https://clinic-server"
        );
        assert_eq!(
            normalize_server(" https://10.0.0.5:8443/ ").unwrap(),
            "https://10.0.0.5:8443"
        );
        assert!(normalize_server("http://clinic").is_err());
        assert!(normalize_server("https://clinic/api").is_err());
        assert!(normalize_server("").is_err());
    }
}
