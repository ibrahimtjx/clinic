# Demo script: M0, skeleton and design system

## Setup

```bash
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose up -d --build --wait
docker compose ps       # proxy, api, db, web all up; api and db healthy
```

## Walkthrough

1. **HTTPS.** Open https://localhost. After trusting the CA ([install-ca.md](install-ca.md)) there is no
   certificate warning. `http://localhost` redirects to HTTPS.
2. **API through the proxy.** https://localhost/api/health returns `status: ok`, the database status and
   the server time in `Asia/Riyadh` (+03:00). The database has no port published on the host.
3. **Arabic RTL by default.** The sidebar is on the right, text is right-aligned, font is IBM Plex Sans Arabic.
   The Home page shows server time as `dd/MM/yyyy hh:mm م` with Western digits.
4. **Connection indicator.** Green dot on the Wi-Fi icon in the top bar. Run `docker compose stop api`:
   within about 10 seconds a red banner appears and "New appointment" is disabled. Run
   `docker compose start api`: the banner disappears by itself.
5. **Language toggle.** User menu → English. The layout flips to LTR, the sidebar moves to the left, the
   font switches to IBM Plex Sans. Reload: the choice is kept.
6. **Theme toggle.** User menu → Dark (or `Ctrl+Shift+L`). Reload: the choice is kept.
7. **Command palette.** Press `Ctrl+K`, type `دليل` or `design`, press Enter → the design system page.
8. **Sidebar.** Collapse it to icons with the chevron at the bottom; hover icons for tooltips.
9. **`/design` style guide.** Walk through colors (accent, neutral, status tints), type scale, numbers and money,
   spacing and radius, buttons, inputs, status chips, table, cards, empty state, drawer, modal, skeleton loader,
   toasts and keyboard shortcuts. Check it in Arabic and English, light and dark.
10. **Form behavior.** In the drawer form: leave the mobile as `0551` and press `Ctrl+Enter` → inline
    validation message. Use the quote icon in the Note field to insert a saved phrase at the cursor. Type
    something, then close the drawer → the unsaved-changes dialog offers Save, Discard and Keep editing.

## Tests

```bash
(cd api && .venv/bin/pytest -q)       # health, migrations up/down/up
(cd web && pnpm test)                 # formatting, i18n key parity, shell, design page, phrase picker
(cd web && pnpm e2e)                  # full stack over HTTPS
```

CI (`.github/workflows/ci.yml`) runs the API tests against Postgres 16, the web typecheck, unit tests and build,
then brings the Compose stack up and runs the Playwright tests against it.
