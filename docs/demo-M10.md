# Demo script: M10, desktop app

Needs a Windows 10/11 PC on the clinic network and the installer from the **Desktop** workflow run
(see [desktop.md](desktop.md)).

## Walkthrough

1. **Install** `Clinic_<version>_x64-setup.exe` (or the MSI). Start **Clinic**.
2. **First launch.** Enter the server address. The app shows the clinic certificate's SHA-256 fingerprint;
   compare it with the server (command in desktop.md) and choose "Trust certificate". Windows asks to
   confirm. The clinic system opens; sign in.
3. **PC name.** Make a change (e.g. edit a patient). Settings → Audit log shows the Windows PC name as the
   machine.
4. **Printers.** Settings → This PC: choose the A4 and the receipt printer, Save, and "Print a test page"
   for each.
5. **Silent printing.** Print an invoice (A4), a receipt and an appointment slip (receipt printer), a report
   and the day schedule (A4): each goes straight to its printer with no dialog. Turn a printer off and print:
   an error appears and the preview opens with the normal print dialog.
6. **PDF.** In any print preview choose "Save as PDF" and pick a folder. Reports also have a PDF button
   (made on the server, works in a browser too).
7. **Updates.** After the signing key is set up (desktop.md), publish a newer version to the server; restart
   the app or use Settings → This PC → Check for updates.
8. **Browser.** Open https://SERVER in Edge or Chrome: everything works; printing uses the print dialog and
   This PC explains that printers are set in the desktop app.

## Tests

```bash
(cd desktop/src-tauri && cargo test)                                    # server address, certificate fingerprint
(cd desktop/src-tauri && cargo check --target x86_64-pc-windows-msvc)  # WebView2 printing code against Windows APIs
(cd api && .venv/bin/pytest -q)   # 149 tests (PDF export added)
(cd web && pnpm test)             # 52 tests (desktop print bridge: silent print, fallback, ready signal)
(cd web && pnpm e2e)              # 27 tests
```

The Desktop workflow also builds the Windows installers on GitHub's Windows runners.
