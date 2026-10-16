from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


class Settings(BaseSettings):
    """Runtime configuration from repo-root `.env` (same file as Node API)."""

    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "HireRight API"
    app_version: str = "4.0.0"
    environment: Literal["development", "test", "staging", "production"] = "development"
    host: str = "0.0.0.0"
    port: int = 8787
    debug: bool = False

    database_url: str = f"sqlite:///{(DATA_DIR / 'hireright.db').as_posix()}"
    database_echo: bool = False
    database_pool_size: int = Field(default=10, ge=1, le=100)

    secret_key: str = "dev-only-change-this-secret-key-before-production"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
    trusted_hosts: str = "localhost,127.0.0.1,testserver"
    access_token_minutes: int = Field(default=60, ge=5, le=1440)
    refresh_token_days: int = Field(default=30, ge=1, le=365)
    max_sessions_per_user: int = Field(default=10, ge=1, le=100)
    signup_enabled: bool = True
    docs_enabled: bool = True
    max_request_bytes: int = Field(default=2_000_000, ge=1024)

    @field_validator("database_url")
    @classmethod
    def normalize_postgres_scheme(cls, value: str) -> str:
        # Render/Heroku commonly expose postgres://, while SQLAlchemy expects postgresql+psycopg://.
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @model_validator(mode="after")
    def validate_production_secrets(self) -> Settings:
        if self.environment in {"staging", "production"}:
            if len(self.secret_key) < 32 or "change-this" in self.secret_key:
                raise ValueError("SECRET_KEY must be a random value of at least 32 characters")
            if self.database_url.startswith("sqlite"):
                raise ValueError("PostgreSQL is required in staging and production")
            if "*" in self.cors_origin_list:
                raise ValueError("Wildcard CORS origins are not allowed in staging or production")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        return [item.strip() for item in self.trusted_hosts.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
