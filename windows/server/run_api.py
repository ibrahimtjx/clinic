"""Starts the clinic API as a Windows service (WinSW runs this with the bundled Python).

Reads the server's settings from %ProgramData%\\ClinicServer\\config\\clinic.env (readable by
Administrators and SYSTEM only), applies database migrations, then runs uvicorn on localhost.
Caddy serves it under /api (SPEC 2).
"""

import os
import sys
from pathlib import Path

DATA = Path(os.environ.get("CLINIC_DATA", r"C:\ProgramData\ClinicServer"))
APP = Path(__file__).resolve().parent.parent  # install folder
API = APP / "api"


def load_env() -> None:
    for line in (DATA / "config" / "clinic.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    load_env()
    os.environ.setdefault("TZ", "Asia/Riyadh")
    # WeasyPrint (PDF) finds Pango and its libraries here (bundled from MSYS2).
    gtk = APP / "gtk"
    if gtk.exists():
        os.environ["WEASYPRINT_DLL_DIRECTORIES"] = str(gtk / "bin")
        os.environ.setdefault("FONTCONFIG_PATH", str(gtk / "etc" / "fonts"))
    os.chdir(API)
    sys.path.insert(0, str(API))
    # In this process: os.exec* on Windows starts a new process, and the service would look stopped.
    from alembic.config import main as alembic

    alembic(argv=["upgrade", "head"])
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.environ.get("CLINIC_API_PORT", "8000")),
        root_path="/api",
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
