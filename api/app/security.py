"""Password, PIN and token primitives (SPEC 3.3)."""

import hashlib
import hmac
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import get_settings

settings = get_settings()

PASSWORD_MIN = 10
BCRYPT_MAX_BYTES = 72
PIN_RE = re.compile(r"^\d{4,6}$")
JWT_ALG = "HS256"

# Verifying against this when the username is unknown keeps response times similar.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt()).decode()


class PolicyError(ValueError):
    """Carries an i18n-friendly error code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def check_password_policy(password: str, username: str) -> None:
    if len(password) < PASSWORD_MIN:
        raise PolicyError("password_too_short")
    if len(password.encode()) > BCRYPT_MAX_BYTES:
        raise PolicyError("password_too_long")
    if password.strip().lower() == username.strip().lower():
        raise PolicyError("password_equals_username")


def check_pin_policy(pin: str) -> None:
    if not PIN_RE.match(pin):
        raise PolicyError("pin_format")
    if len(set(pin)) == 1:
        raise PolicyError("pin_too_simple")


def hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode(), bcrypt.gensalt(rounds=settings.bcrypt_rounds)).decode()


def verify_secret(secret: str, hashed: str | None) -> bool:
    try:
        return (
            bcrypt.checkpw(secret.encode()[:BCRYPT_MAX_BYTES], (hashed or _DUMMY_HASH).encode())
            and hashed is not None
        )
    except ValueError:
        return False


def create_access_token(
    user_id: int, session_id: uuid.UUID, must_change_password: bool
) -> tuple[str, int]:
    ttl = settings.access_token_minutes * 60
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "mcp": must_change_password,
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALG), ttl


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(
        token, settings.jwt_secret, algorithms=[JWT_ALG], options={"require": ["exp", "sub", "sid"]}
    )
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def new_refresh_secret() -> tuple[str, str]:
    """Returns (secret for the cookie, sha256 hash to store)."""
    s = secrets.token_urlsafe(32)
    return s, sha256(s)


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def constant_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
