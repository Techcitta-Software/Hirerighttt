"""Password hashing compatible with Node authPasswords.mjs (scrypt + legacy sha256)."""

from __future__ import annotations

import hashlib
import hmac
import secrets


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=64)
    return f"scrypt${salt}${key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not isinstance(stored, str) or not isinstance(password, str) or len(password) > 1024:
        return False
    if stored.startswith("scrypt$"):
        parts = stored.split("$")
        if len(parts) != 3:
            return False
        _, salt, digest = parts
        if len(salt) != 32 or len(digest) != 128:
            return False
        if not all(c in "0123456789abcdef" for c in salt + digest):
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt),
            n=2**14,
            r=8,
            p=1,
            dklen=64,
        )
        expected = bytes.fromhex(digest)
        return hmac.compare_digest(actual, expected)
    # Legacy salt$sha256
    salt, _, digest = stored.partition("$")
    if not salt or len(digest) != 64:
        return False
    actual = hashlib.sha256(f"{salt}:{password}".encode("utf-8")).digest()
    try:
        expected = bytes.fromhex(digest)
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected)
