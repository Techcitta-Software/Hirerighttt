"""Password reset: single-use, short-lived tokens delivered by email.

Only a SHA-256 hash of each token is stored, so a database leak cannot be used to reset
passwords. Requesting a reset never reveals whether an account exists.
"""

from __future__ import annotations

import hashlib
import html
import logging
import secrets
from datetime import datetime, timedelta, timezone

from app.db import db_pool

logger = logging.getLogger("hireright.password_reset")

TOKEN_TTL_MINUTES = 30
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 1024

GENERIC_REQUEST_MESSAGE = (
    "If an account exists for that email, we've sent a link to reset the password. "
    "The link expires in 30 minutes."
)


def new_reset_token() -> str:
    return secrets.token_urlsafe(32)


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_new_password(password: str) -> str | None:
    """Return an error message, or None when the password is acceptable."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Use at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > MAX_PASSWORD_LENGTH:
        return "That password is too long."
    if not password.strip():
        return "Password cannot be only spaces."
    return None


def store_reset_token(database_url: str, email: str, token: str, ip: str | None) -> None:
    """Invalidate earlier unused tokens for this email, then store the new token's hash."""
    expires = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES)
    pool = db_pool(database_url)
    with pool.connection() as conn:
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = NOW() WHERE email = %s AND used_at IS NULL",
            (email,),
        )
        conn.execute(
            """INSERT INTO password_reset_tokens (token_hash, email, expires_at, requested_ip)
               VALUES (%s, %s, %s, %s)""",
            (hash_reset_token(token), email, expires, ip),
        )
        conn.commit()


def consume_reset_token(database_url: str, token: str) -> str | None:
    """Atomically mark a valid token as used. Returns the account email, or None if invalid/expired/used."""
    if not token:
        return None
    pool = db_pool(database_url)
    with pool.connection() as conn:
        row = conn.execute(
            """UPDATE password_reset_tokens SET used_at = NOW()
               WHERE token_hash = %s AND used_at IS NULL AND expires_at > NOW()
               RETURNING email""",
            (hash_reset_token(token),),
        ).fetchone()
        conn.commit()
    return row["email"] if row else None


def revoke_all_sessions(database_url: str, email: str) -> None:
    """Sign the account out everywhere after a password change."""
    pool = db_pool(database_url)
    with pool.connection() as conn:
        conn.execute("DELETE FROM hireright_sessions WHERE email = %s", (email,))
        conn.commit()


def reset_email_content(name: str, link: str) -> tuple[str, str, str]:
    """Return (subject, html, text) for the reset email."""
    safe_name = html.escape(name or "there")
    safe_link = html.escape(link, quote=True)
    subject = "Reset your HireRighttt password"
    body_html = f"""<div style="font-family:Nunito,Segoe UI,Arial,sans-serif;color:#141638;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 12px">Reset your password</h1>
  <p style="color:#363b5c;line-height:1.6;margin:0 0 20px">Hi {safe_name}, we received a request to reset the password for your HireRighttt account. This link works once and expires in {TOKEN_TTL_MINUTES} minutes.</p>
  <p style="margin:0 0 24px"><a href="{safe_link}" style="display:inline-block;background:#5046e5;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Choose a new password</a></p>
  <p style="color:#5f6686;font-size:13px;line-height:1.6;margin:0">If you didn't ask for this, you can ignore this email; your password won't change.</p>
</div>"""
    text = (
        f"Hi {name or 'there'},\n\nReset your HireRighttt password here (works once, expires in "
        f"{TOKEN_TTL_MINUTES} minutes):\n{link}\n\nIf you didn't ask for this, ignore this email."
    )
    return subject, body_html, text
