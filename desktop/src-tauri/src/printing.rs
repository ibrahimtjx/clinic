//! Printing without a dialog (SPEC 3.8, milestone M0.5/M10).
//!
//! The web app asks for a print page of the clinic server to be printed. A hidden window loads that
//! page; when its data is on screen the page calls `print_ready`, and WebView2 prints it straight to
//! the PC's chosen printer (or saves a PDF). No external program is involved.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

#[cfg_attr(not(windows), allow(dead_code))] // printing is Windows-only
pub enum Mode {
    Print { printer: String },
    Pdf { path: String },
}

pub struct Job {
    mode: Mode,
    tx: oneshot::Sender<Result<(), String>>,
}

#[derive(Default)]
pub struct Jobs {
    next: AtomicU64,
    pending: Mutex<HashMap<String, Job>>,
}

/// Opens `url` in a hidden window and waits until it has been printed (or saved as PDF).
pub async fn run(app: &AppHandle, url: &str, mode: Mode) -> Result<(), String> {
    let jobs = app.state::<Jobs>();
    let label = format!("print-{}", jobs.next.fetch_add(1, Ordering::SeqCst) + 1);
    let mut target = url::Url::parse(url).map_err(|_| "invalid_url".to_string())?;
    target.query_pairs_mut().append_pair("job", &label);
    let (tx, rx) = oneshot::channel();
    jobs.pending
        .lock()
        .unwrap()
        .insert(label.clone(), Job { mode, tx });
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(target))
        .title("print")
        .visible(false)
        .skip_taskbar(true)
        .inner_size(900.0, 1200.0)
        .build()
        .map_err(|e| e.to_string());
    let window = match window {
        Ok(w) => w,
        Err(e) => {
            jobs.pending.lock().unwrap().remove(&label);
            return Err(e);
        }
    };
    let result = match tokio::time::timeout(Duration::from_secs(45), rx).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("print_cancelled".into()),
        Err(_) => Err("print_timeout".into()),
    };
    jobs.pending.lock().unwrap().remove(&label);
    let _ = window.close();
    result
}

/// Called by the print page (in the hidden window) once its content is ready.
pub fn ready(window: &tauri::WebviewWindow, job: &str) -> Result<(), String> {
    if window.label() != job {
        return Err("wrong_window".into());
    }
    let jobs = window.state::<Jobs>();
    let Some(job) = jobs.pending.lock().unwrap().remove(job) else {
        return Err("unknown_job".into());
    };
    let Job { mode, tx } = job;
    let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
    let tx2 = tx.clone();
    let res = window.with_webview(move |w| platform::print(w, mode, tx2));
    if let Err(e) = res {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(Err(e.to_string()));
        }
    }
    Ok(())
}

type Reply = std::sync::Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>;

fn reply(tx: &Reply, r: Result<(), String>) {
    if let Some(tx) = tx.lock().unwrap().take() {
        let _ = tx.send(r);
    }
}

#[cfg(windows)]
mod platform {
    use super::{reply, Mode, Reply};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_16, ICoreWebView2_7,
        COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
    };
    use webview2_com::{PrintCompletedHandler, PrintToPdfCompletedHandler};
    use windows_core::{Interface, HSTRING};

    pub fn print(w: tauri::webview::PlatformWebview, mode: Mode, tx: Reply) {
        let done = tx.clone();
        let result = (|| -> windows_core::Result<()> {
            unsafe {
                let controller = w.controller();
                // A hidden window's WebView2 does not render; make it visible to the engine only.
                let _ = controller.SetIsVisible(true);
                let core = controller.CoreWebView2()?;
                let env: ICoreWebView2Environment6 = w.environment().cast()?;
                let settings = env.CreatePrintSettings()?;
                settings.SetShouldPrintHeaderAndFooter(false)?;
                settings.SetShouldPrintBackgrounds(true)?;
                match mode {
                    Mode::Print { printer } => {
                        if !printer.is_empty() {
                            let s2: ICoreWebView2PrintSettings2 = settings.cast()?;
                            s2.SetPrinterName(&HSTRING::from(printer.as_str()))?;
                        }
                        let handler = PrintCompletedHandler::create(Box::new(move |hr, status| {
                            let r = match hr {
                                Err(e) => Err(e.message()),
                                Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED => Ok(()),
                                Ok(()) => Err(format!("print_failed_{}", status.0)),
                            };
                            reply(&done, r);
                            Ok(())
                        }));
                        let wv: ICoreWebView2_16 = core.cast()?;
                        wv.Print(&settings, &handler)?;
                    }
                    Mode::Pdf { path } => {
                        let handler =
                            PrintToPdfCompletedHandler::create(Box::new(move |hr, ok| {
                                let r = match hr {
                                    Err(e) => Err(e.message()),
                                    Ok(()) if ok => Ok(()),
                                    Ok(()) => Err("pdf_failed".to_string()),
                                };
                                reply(&done, r);
                                Ok(())
                            }));
                        let wv: ICoreWebView2_7 = core.cast()?;
                        wv.PrintToPdf(&HSTRING::from(path.as_str()), &settings, &handler)?;
                    }
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            reply(&tx, Err(e.message()));
        }
    }

    /// Printer names from Windows (PowerShell, no console window).
    pub fn printers() -> Vec<String> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | Select-Object -ExpandProperty Name"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
            .unwrap_or_default()
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{reply, Mode, Reply};

    pub fn print(_w: tauri::webview::PlatformWebview, _mode: Mode, tx: Reply) {
        reply(&tx, Err("unsupported_platform".into()));
    }

    pub fn printers() -> Vec<String> {
        Vec::new()
    }
}

pub use platform::printers;
