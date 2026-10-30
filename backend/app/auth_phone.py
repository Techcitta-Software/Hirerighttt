from __future__ import annotations

import re


def normalize_phone(raw: str | None) -> str | None:
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) < 10 or len(digits) > 15:
        return None
    return digits


def is_valid_phone_input(raw: str | None) -> bool:
    return normalize_phone(raw) is not None


def find_user_by_phone(users: list[dict], raw_phone: str | None) -> dict | None:
    norm = normalize_phone(raw_phone)
    if not norm:
        return None
    for user in users:
        if normalize_phone(user.get("phone")) == norm:
            return user
    return None
