from __future__ import annotations


def validate_employer_signup(role: str, company_name: str | None) -> str | None:
    if role != "employer":
        return None
    name = str(company_name or "").strip()
    if len(name) < 2:
        return "Company or vendor name is required for employer (vendor) accounts."
    return None


def login_role_mismatch_message(expected: str | None, actual: str | None) -> str | None:
    if not expected or not actual or expected == actual:
        return None
    if expected == "employer":
        return (
            "This email is registered as a candidate account. Use candidate sign-in, "
            "or create an employer account with a different email and phone."
        )
    return (
        "This email is registered as an employer (vendor) account. Sign in from the employer login "
        "or use a different email for candidate access."
    )
