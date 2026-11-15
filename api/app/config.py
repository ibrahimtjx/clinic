from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLINIC_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://clinic:clinic@localhost:5432/clinic"
    timezone: str = "Asia/Riyadh"
    app_version: str = "0.1.0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
