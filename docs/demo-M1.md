# Demo script: M1, auth and security

## Setup

```bash
cp .env.example .env        # set POSTGRES_PASSWORD and JWT_SECRET (openssl rand -hex 32)
docker compose up -d --build --wait
```

Create the first admin (production):

```bash
docker compose exec api python -m app.cli create-admin --username admin --name-ar "مدير النظام" --name-en "Admin"
```

Or, on a development machine only, fake users for every role (password `Clinic-dev-2026`, PIN `2468`):

```bash
docker compose exec api python -m app.cli seed-dev
```

| Username | Role |
|---|---|
| admin | Admin |
| manager | Manager |
| reception | Reception |
| dr.reem, dr.omar | Doctor |
| cashier | Cashier / Accountant |

## Walkthrough

1. **Sign in.** Open https://localhost. The sign-in page is Arabic by default; the language and theme
   buttons are at the top. The device name at the bottom is what the audit log records for this PC.
2. **Wrong password and lockout.** Sign in as `cashier` with a wrong password 5 times. The 5th attempt says
   the account is locked until a time 15 minutes away. Even the right password is refused now.
3. **Admin unlocks.** Sign in as `admin` → Settings → Users. `cashier` shows a red "Locked" chip. Row menu →
   Unlock. `cashier` can sign in again.
4. **Menu by role.** Sign in as `reception`: no Settings or Reports in the sidebar. `/settings/users` says
   there is no access. The API refuses too: `GET /api/users` returns 403 with the missing permission.
5. **Lock and PIN.** Signed in as `reception`, open the Design system page and type into a form field.
   Press `Ctrl+L` (or user menu → Lock screen). The screen blurs behind a lock card. Enter PIN `2468`: the
   typed text is still there. The lock ended the server session, so the old token is useless.
6. **Auto-lock.** Leave the app untouched for 5 minutes: it locks itself. (Admin can change the minutes
   under Settings → Security.)
7. **Quick switch.** Lock again → "Switch user" → `dr.reem`, PIN `2468`. The reception user's open
   screen is still there, but the sidebar now shows the doctor's items, and the user menu shows Dr. Reem.
   Anything saved now is recorded under Dr. Reem.
8. **New user and forced password change.** As `admin`: Settings → Users → New user. Give a temporary
   password (10+ characters) and a role. Sign in as the new user in a private window: a full-screen
   "Set a new password" form appears. Passwords under 10 characters, or equal to the username, are refused.
9. **PIN.** User menu → Set PIN: 4 to 6 digits, confirmed with the password. `1111` is refused as too simple.
10. **Role matrix.** Settings → Roles & permissions. Tick "View audit log" for Reception and Save. Sign in
    as `reception`: Settings → Audit log is now available. Leaving the matrix with unsaved ticks asks Save,
    Discard or Keep editing. The Admin column is fixed.
11. **Edit conflict.** Open the same user in two browser windows as admin. Save a name change in one, then
    save in the other: it says who changed the record, with a Reload button.
12. **Audit log.** Settings → Audit log. Every sign-in, failed sign-in, lock, user change and role change
    is listed with user, time, device and IP. Click a row to see the before and after values (password and
    PIN hashes are shown as `***`). The table cannot be changed, even directly in the database:
    `UPDATE audit_log ...` fails with "audit_log is append-only".
13. **Preferences follow the user.** Switch to English and dark mode, sign out, sign in on another browser:
    the same language and theme come back.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 40 tests: every endpoint, lockout, PIN, sessions, audit trigger, migrations
(cd web && pnpm test)             # 26 tests: sign-in, lock, PIN unlock, quick switch, auto-lock, nav by permission
(cd web && pnpm e2e)              # 9 tests on the full HTTPS stack (needs seed-dev users)
```
