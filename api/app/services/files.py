"""Storing patient files on the server disk (SPEC 8.5).

Layout under CLINIC_FILES_DIR: YYYY/MM/<random>.<ext>, plus <name>.thumb.jpg for images. The database
keeps the path, SHA-256, size and type. Files are never overwritten or removed by the app; a deleted file
is only marked deleted, so backups and the audit trail stay complete.
"""

import hashlib
import os
import uuid
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.config import get_settings

# Accepted by their first bytes, not by the name the browser sends.
SIGNATURES: list[tuple[bytes, int, str, str]] = [
    (b"\xff\xd8\xff", 0, "image/jpeg", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", 0, "image/png", ".png"),
    (b"GIF87a", 0, "image/gif", ".gif"),
    (b"GIF89a", 0, "image/gif", ".gif"),
    (b"BM", 0, "image/bmp", ".bmp"),
    (b"II*\x00", 0, "image/tiff", ".tif"),
    (b"MM\x00*", 0, "image/tiff", ".tif"),
    (b"%PDF-", 0, "application/pdf", ".pdf"),
    (b"DICM", 128, "application/dicom", ".dcm"),
]
IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff", "image/webp"}
CHUNK = 1 << 20


def root() -> Path:
    return Path(get_settings().files_dir)


def sniff(head: bytes) -> tuple[str, str] | None:
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", ".webp"
    for sig, offset, ctype, ext in SIGNATURES:
        if head[offset : offset + len(sig)] == sig:
            return ctype, ext
    return None


@dataclass
class Stored:
    path: str
    content_type: str
    size: int
    sha256: str
    width: int | None
    height: int | None
    has_thumb: bool


def _err(code: str, **extra) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": code, **extra})


async def store(upload: UploadFile, today: date) -> Stored:
    limit = get_settings().max_upload_mb * 1024 * 1024
    base = root()
    rel_dir = Path(f"{today:%Y}") / f"{today:%m}"
    (base / rel_dir).mkdir(parents=True, exist_ok=True)
    (base / "tmp").mkdir(parents=True, exist_ok=True)
    tmp = base / "tmp" / f"{uuid.uuid4().hex}.part"
    digest, size, head = hashlib.sha256(), 0, b""
    try:
        with tmp.open("wb") as out:
            while chunk := await upload.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise _err("file_too_large", max_mb=get_settings().max_upload_mb)
                if len(head) < 132:
                    head += chunk[: 132 - len(head)]
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise _err("file_empty")
        kind = sniff(head)
        if kind is None:
            raise _err("file_type_not_allowed")
        ctype, ext = kind
        rel = rel_dir / f"{uuid.uuid4().hex}{ext}"
        os.replace(tmp, base / rel)
    finally:
        tmp.unlink(missing_ok=True)
    width = height = None
    has_thumb = False
    if ctype in IMAGE_TYPES:
        width, height, has_thumb = _thumbnail(base / rel)
    return Stored(rel.as_posix(), ctype, size, digest.hexdigest(), width, height, has_thumb)


def _thumbnail(path: Path) -> tuple[int | None, int | None, bool]:
    """A small JPEG preview for the grid. Images Pillow cannot read are kept without one."""
    try:
        from PIL import Image, ImageOps

        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            w, h = im.size
            im.thumbnail((480, 480))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(thumb_path(path), "JPEG", quality=82)
        return w, h, True
    except Exception:  # noqa: BLE001  (a damaged or exotic image is still stored)
        return None, None, False


def thumb_path(path: Path) -> Path:
    return path.with_name(path.name + ".thumb.jpg")


def absolute(rel: str) -> Path:
    p = (root() / rel).resolve()
    if root().resolve() not in p.parents:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    return p
