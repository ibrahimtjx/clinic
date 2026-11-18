//! Clinic desktop app (SPEC 2, 3.8, milestone M10): wraps the clinic web app served by the server,
//! remembers the server and trusts the clinic CA on first launch, prints without a dialog, saves
//! PDFs, and updates itself from the clinic server.

mod ca;
mod config;
mod printing;

use serde::Serialize;
use tauri::{ipc::CapabilityBuilder, AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

use config::PcConfig;

/// What the clinic origin may call. The setup page (local) has its own, smaller capability.
const SERVER_COMMANDS: &[&str] = &[
    "allow-get-config",
    "allow-reset-server",
    "allow-list-printers",
    "allow-set-printers",
    "allow-print-url",
    "allow-print-ready",
    "allow-save-pdf",
    "allow-check-update",
    "allow-open-whatsapp",
];

#[derive(Serialize)]
struct DesktopInfo {
    version: String,
    machine: String,
    server: Option<String>,
    a4_printer: String,
    receipt_printer: String,
}

fn machine_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".into())
}

fn grant_server(app: &AppHandle, server: &str) -> Result<(), String> {
    let mut cap = CapabilityBuilder::new("clinic-server")
        .remote(format!("{server}/*"))
        .windows(["main", "print-*"])
        .permission("core:default");
    for p in SERVER_COMMANDS {
        cap = cap.permission(*p);
    }
    app.add_capability(cap).map_err(|e| e.to_string())
}

fn open_server(app: &AppHandle, server: &str) -> Result<(), String> {
    grant_server(app, server)?;
    let url = format!("{server}/")
        .parse()
        .map_err(|_| "server_invalid".to_string())?;
    if let Some(w) = app.get_webview_window("main") {
        w.navigate(url).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn same_server(cfg: &PcConfig, url: &str) -> Result<(), String> {
    match &cfg.server {
        Some(s) if url.starts_with(&format!("{s}/")) => Ok(()),
        _ => Err("url_not_on_server".into()),
    }
}

#[tauri::command]
fn get_config(app: AppHandle) -> DesktopInfo {
    let cfg = config::load(&app);
    DesktopInfo {
        version: app.package_info().version.to_string(),
        machine: machine_name(),
        server: cfg.server,
        a4_printer: cfg.a4_printer,
        receipt_printer: cfg.receipt_printer,
    }
}

#[tauri::command]
fn set_server(app: AppHandle, server: String) -> Result<String, String> {
    let server = config::normalize_server(&server)?;
    let mut cfg = config::load(&app);
    cfg.server = Some(server.clone());
    config::save(&app, &cfg)?;
    open_server(&app, &server)?;
    Ok(server)
}

#[tauri::command]
fn reset_server(app: AppHandle) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.server = None;
    config::save(&app, &cfg)?;
    app.restart();
}

#[tauri::command]
async fn fetch_ca(server: String) -> Result<ca::CaInfo, String> {
    let server = config::normalize_server(&server)?;
    ca::fetch(&server).await
}

#[tauri::command]
fn trust_ca(pem: String) -> Result<(), String> {
    ca::trust(&pem)
}

/// True if the server answers over HTTPS with a certificate this PC trusts.
#[tauri::command]
async fn check_server(server: String) -> Result<bool, String> {
    let server = config::normalize_server(&server)?;
    let res = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!("{server}/api/health"))
        .send()
        .await;
    Ok(matches!(res, Ok(r) if r.status().is_success()))
}

#[tauri::command]
async fn list_printers() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(printing::printers)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn set_printers(app: AppHandle, a4: String, receipt: String) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.a4_printer = a4;
    cfg.receipt_printer = receipt;
    config::save(&app, &cfg)
}

/// Print a page of the clinic server to this PC's A4 or receipt printer, without a dialog.
#[tauri::command]
async fn print_url(app: AppHandle, url: String, kind: String) -> Result<(), String> {
    let cfg = config::load(&app);
    same_server(&cfg, &url)?;
    let printer = if kind == "receipt" {
        cfg.receipt_printer
    } else {
        cfg.a4_printer
    };
    printing::run(&app, &url, printing::Mode::Print { printer }).await
}

/// Open a WhatsApp chat (wa.me link with the reminder text) in WhatsApp or the default browser.
/// Only wa.me links: the clinic page cannot use this to start other programs.
#[tauri::command]
fn open_whatsapp(url: String) -> Result<(), String> {
    // The page sends wa.me/<number>?text=<percent-encoded text>: nothing else gets through.
    let ok = url.starts_with("https://wa.me/")
        && url
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "%/:._?=-+".contains(c));
    if !ok {
        return Err("not a wa.me link".into());
    }
    #[cfg(windows)]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn print_ready(window: WebviewWindow, job: String) -> Result<(), String> {
    printing::ready(&window, &job)
}

/// Save a page of the clinic server as PDF where the user chooses. Returns the path, or None if
/// the user cancelled.
#[tauri::command]
async fn save_pdf(app: AppHandle, url: String, name: String) -> Result<Option<String>, String> {
    let cfg = config::load(&app);
    same_server(&cfg, &url)?;
    let dialog = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("PDF", &["pdf"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let path = path.to_string_lossy().to_string();
    printing::run(&app, &url, printing::Mode::Pdf { path: path.clone() }).await?;
    Ok(Some(path))
}

/// Looks for a newer version on the clinic server; installs it and restarts if found.
/// Returns None when up to date or updates are not set up (an installed update restarts the app).
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    let Some(server) = config::load(&app).server else {
        return Ok(None);
    };
    let endpoint = format!("{server}/desktop/latest.json")
        .parse()
        .map_err(|_| "server_invalid".to_string())?;
    let updater = match app
        .updater_builder()
        .endpoints(vec![endpoint])
        .and_then(|b| b.build())
    {
        Ok(u) => u,
        Err(_) => return Ok(None), // no signing key configured in this build
    };
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(printing::Jobs::default())
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_server,
            reset_server,
            fetch_ca,
            trust_ca,
            check_server,
            list_printers,
            set_printers,
            print_url,
            print_ready,
            save_pdf,
            check_update,
            open_whatsapp
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(server) = config::load(&handle).server {
                open_server(&handle, &server)?;
                // Quietly look for an update from the clinic server at start.
                tauri::async_runtime::spawn(async move {
                    let _ = check_update(handle).await;
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the clinic app");
}
