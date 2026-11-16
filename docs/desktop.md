# Desktop app (Windows)

The desktop app (`desktop/`, Tauri 2) wraps the same web app the server serves. It adds what a browser
cannot: printing straight to the PC's printers without a dialog, saving PDFs, the Windows PC name in the
audit log, and updates from the clinic server. In a normal browser everything still works; printing then
uses the print dialog.

## Get the installer

Every change to `desktop/` runs the **Desktop** workflow on GitHub. Its Windows job builds:

- `Clinic_<version>_x64_ar-SA.msi` and `..._en-US.msi` (MSI, for installing on many PCs), and
- `Clinic_<version>_x64-setup.exe` (NSIS, a normal setup program).

Download them from the workflow run (Artifacts → `clinic-desktop-windows`). The installer includes the
WebView2 bootstrapper, so it also works on PCs that do not have WebView2 yet.

## First launch on each PC

1. Start **Clinic**. Enter the server address (e.g. `clinic-server` or `192.168.1.10`) → Continue.
2. If the PC does not trust the clinic's certificate yet, the app downloads it from
   `http://SERVER/ca.crt` and shows its SHA-256 fingerprint. Compare it with the server's:

   ```bash
   docker compose exec proxy cat /data/caddy/pki/authorities/local/root.crt | openssl x509 -noout -fingerprint -sha256
   ```

   If they match, choose "Trust certificate". Windows asks to confirm adding it to the user's trusted
   roots. (To trust it for all users of the PC instead, see [install-ca.md](install-ca.md).)
3. The app opens the clinic system and remembers the server. Sign in as usual.

## Printers (per PC)

Settings → This PC (needs `settings.manage`): choose the **A4 printer** (invoices, quotations, reports,
visit records, day schedule) and the **receipt printer** (receipts, appointment slips). "Windows default"
uses the PC's default printer. "Print a test page" checks each one.

From then on every Print button sends the document straight to the right printer. If printing fails, the
preview opens so the user can still print with the dialog. Print previews also have "Save as PDF".

How it works: a hidden window loads the print page from the server; when its data is on screen it tells
the app, and WebView2 (Microsoft Edge's engine, part of Windows) prints it to the chosen printer. No other
program is installed.

## Updates from the clinic server

The app checks `https://SERVER/desktop/latest.json` at start (and from Settings → This PC). Updates must
be signed, so they are off until a signing key is set up once:

1. On a trusted PC: `cd desktop && pnpm install && pnpm tauri signer generate -w clinic-updates.key`.
   Keep the private key and its password safe (not in the repository).
2. Put the printed **public** key in `desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and
   set `bundle.createUpdaterArtifacts` to `true`.
3. In the GitHub repository settings add the secrets `TAURI_SIGNING_PRIVATE_KEY` (the key file's
   contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

To release a version: raise `version` in `desktop/src-tauri/tauri.conf.json` (and `Cargo.toml`), let the
workflow build it, then copy the setup `.exe`, its `.sig` and a `latest.json` to the server:

```bash
docker compose cp Clinic_0.11.0_x64-setup.exe proxy:/srv/desktop/
docker compose cp latest.json proxy:/srv/desktop/
```

`latest.json`:

```json
{
  "version": "0.11.0",
  "notes": "What changed",
  "pub_date": "2026-12-01T09:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of Clinic_0.11.0_x64-setup.exe.sig>",
      "url": "https://SERVER/desktop/Clinic_0.11.0_x64-setup.exe"
    }
  }
}
```

PCs update the next time the app starts.

## Changing the server

Settings → This PC → Change server (the app restarts at the first-launch screen). Useful when moving to
the standby server (SPEC 15).
