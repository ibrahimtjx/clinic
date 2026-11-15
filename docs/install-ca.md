# Trusting the clinic CA on a client PC

The server uses HTTPS with a certificate from the clinic's own certificate authority (Caddy internal CA).
Each client PC must trust that CA once. (From M10 the Tauri installer does this on first launch.)

## 1. Export the root certificate (on the server)

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./clinic-ca.crt
```

The CA lives in the `caddy_data` volume. Back that volume up: if it is lost, a new CA is created
and every client must trust the new one.

## 2. Install it on Windows (on each client, as Administrator)

```powershell
certutil -addstore -f Root clinic-ca.crt
```

Or double-click `clinic-ca.crt` → Install Certificate → Local Machine → Place all certificates in
"Trusted Root Certification Authorities".

## 3. Check

Open `https://SERVER_NAME` in Edge or Chrome. There is no certificate warning and the
connection indicator in the top bar is green.

Firefox uses its own store: set `security.enterprise_roots.enabled` to `true` in `about:config`.
