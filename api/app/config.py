from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLINIC_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://clinic:clinic@localhost:5432/clinic"
    timezone: str = "Asia/Riyadh"
    app_version: str = "0.2.0"

    # Auth (SPEC 3.3). The secret must be identical on primary and standby servers.
    jwt_secret: str = "dev-only-insecure-secret-change-me-0123456789"
    access_token_minutes: int = 15
    refresh_token_hours: int = 12
    cookie_secure: bool = True
    bcrypt_rounds: int = 12
    cookie_path: str = "/api/auth"  # path as the browser sees it, behind the proxy

    @field_validator("jwt_secret")
    @classmethod
    def _long_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("CLINIC_JWT_SECRET must be at least 32 characters")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
