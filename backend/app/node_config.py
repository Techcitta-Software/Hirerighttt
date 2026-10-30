"""Runtime configuration aligned with backend/node/config.mjs."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from app.load_env import env_file_path, load_env

if not load_env():
    print(f"[config] No {env_file_path()} — copy .env.example to .env at repo root.", file=sys.stderr)

_env = os.environ.get("ENVIRONMENT") or os.environ.get("NODE_ENV") or "development"
is_production = _env == "production"
is_staging = _env == "staging"
is_prod_like = is_production or is_staging


@dataclass(frozen=True)
class NodeConfig:
    environment: str
    port: int
    cors_origins: list[str]
    database_url: str
    session_secret: str
    allow_demo_accounts: bool
    signup_enabled: bool
    max_body_bytes: int
    trust_proxy: bool


def _cors_origins() -> list[str]:
    raw = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    return [s.strip() for s in raw.split(",") if s.strip()]


config = NodeConfig(
    environment=_env,
    port=int(os.environ.get("PORT") or 8787),
    cors_origins=_cors_origins(),
    database_url=os.environ.get("DATABASE_URL") or "",
    session_secret=os.environ.get("SESSION_SECRET") or os.environ.get("SECRET_KEY") or "",
    allow_demo_accounts=os.environ.get("ALLOW_DEMO_ACCOUNTS") == "true",
    signup_enabled=os.environ.get("SIGNUP_ENABLED", "true").lower() != "false",
    max_body_bytes=int(os.environ.get("MAX_REQUEST_BYTES") or 3_000_000),
    trust_proxy=os.environ.get("TRUST_PROXY") == "true" or is_prod_like,
)


def assert_database_config() -> None:
    if not config.database_url.strip():
        print(
            "[config] DATABASE_URL is required.\n"
            "  Set DATABASE_URL in repo-root .env (see .env.example)\n"
            "  Then run: npm run db:init",
            file=sys.stderr,
        )
        raise SystemExit(1)


def assert_production_config() -> None:
    if is_prod_like:
        assert_database_config()
    elif not config.database_url.strip():
        print(
            "[config] DATABASE_URL not set — auth and data routes need Neon. "
            "Copy .env.example to repo-root .env for full local dev.",
            file=sys.stderr,
        )
    if not is_prod_like:
        return
    errors: list[str] = []
    if not config.session_secret or len(config.session_secret) < 32:
        errors.append("SESSION_SECRET (or SECRET_KEY) must be at least 32 random characters in production.")
    if not config.cors_origins or "*" in config.cors_origins:
        errors.append("Set CORS_ORIGINS to your exact frontend URL(s) — no wildcards in production.")
    has_llm = any(
        os.environ.get(k)
        for k in ("GEMINI_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "LLM_API_KEY")
    )
    if not has_llm:
        errors.append("GEMINI_API_KEY (or OPENAI_API_KEY / OPENROUTER_API_KEY) is required in production.")
    if errors:
        strict = os.environ.get("STRICT_PRODUCTION_CONFIG") == "true"
        msg = "\n".join(f"  - {e}" for e in errors)
        if strict:
            print(f"[config] Production configuration errors (strict mode):\n{msg}", file=sys.stderr)
            raise SystemExit(1)
        print(f"[config] Production notices:\n{msg}", file=sys.stderr)
