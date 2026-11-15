# Clinic Management System

Offline-first clinic system for a dental and medical complex. Arabic first (RTL), English supported.
[`SPEC.md`](SPEC.md) is the source of truth.

## Layout

| Path | What |
|---|---|
| `api/` | FastAPI backend, SQLAlchemy 2, Alembic migrations, pytest |
| `web/` | React 18 + TypeScript + Vite + Mantine 7 UI, Vitest, Playwright |
| `proxy/` | Caddy reverse proxy with the clinic's internal CA (HTTPS on the LAN) |
| `docs/` | Demo scripts per milestone, runbooks |

## Run the full stack

```bash
cp .env.example .env   # then set POSTGRES_PASSWORD and JWT_SECRET to long random values
docker compose up -d --build --wait
```

Open https://localhost (or `https://$SERVER_NAME`). The certificate comes from the clinic's own CA.
To trust it on a client PC, see [docs/install-ca.md](docs/install-ca.md).

Create the first admin user:

```bash
docker compose exec api python -m app.cli create-admin --username admin --name-ar "مدير النظام"
```

Development only: `docker compose exec api python -m app.cli seed-dev` creates fake users for every role
(see [docs/demo-M1.md](docs/demo-M1.md)).

## Develop

Backend (needs a Postgres 16 on `localhost:5432`, user/password/db `clinic`):

```bash
cd api && uv venv -p 3.12 && uv pip install -e '.[dev]'
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/pytest -q
```

Frontend (Vite proxies `/api` to `localhost:8000`):

```bash
cd web && pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # Vitest
pnpm lint         # TypeScript
pnpm e2e          # Playwright against https://localhost with seed-dev users (E2E_BASE_URL to change)
```

## Conventions

See SPEC section 18. In short: no hard-coded UI strings (use `web/src/i18n/*.json`) or colors
(use `web/src/app/theme.ts`), money is `NUMERIC(12,2)` and travels as a decimal string, server
time only, every migration reversible, every endpoint tested.

## Builds behind a TLS-inspecting proxy

Both Dockerfiles accept an optional BuildKit secret `ca` (an extra CA bundle used only while
installing packages):

```bash
docker build --secret id=ca,src=/path/to/ca.crt -t clinic-web ./web
```
