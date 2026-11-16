fn main() {
    // App commands get permissions so the remote clinic origin can be granted exactly these.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_config",
            "set_server",
            "reset_server",
            "fetch_ca",
            "trust_ca",
            "check_server",
            "list_printers",
            "set_printers",
            "print_url",
            "print_ready",
            "save_pdf",
            "check_update",
        ]),
    ))
    .expect("failed to run tauri-build");
}
