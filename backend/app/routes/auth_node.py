from __future__ import annotations

from app.db.finders import find_user, find_user_by_phone as find_user_by_phone_in_db
import asyncio
import logging
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.auth_passwords import hash_password, verify_password
from app.auth_register import UniqueAccountError, register_account
from app.auth_roles import login_role_mismatch_message, validate_employer_signup
from app.auth_phone import is_valid_phone_input, normalize_phone
from app.db import db_pool
from app.db.talent_index import upsert_candidate_talent
from app.node_config import config, is_prod_like
from app.proctoring.strip_proctoring import strip_interview_result_for_candidate
from app.server import background, runtime
from app.services import audit, login_guard, password_reset as pw_reset
from app.services.candidate_name import apply_resume_name, is_candidate_account
from app.services.interview_invites import public_app_origin, trusted_request_origin
from app.services.mail_service import send_mail, smtp_configured

router = APIRouter()
logger = logging.getLogger("hireright.auth")


@router.post("/signup", status_code=201)
async def signup(request: Request, body: dict) -> dict:
    ip = runtime.client_ip(request)
    if not config.signup_enabled:
        raise HTTPException(status_code=403, detail="Sign-up is disabled on this deployment.")
    if not runtime.rate_limit(f"signup:{ip}", 8 if is_prod_like else 60, strict=True):
        raise HTTPException(status_code=429, detail="Too many signup attempts. Try again shortly.")
    name = str(body.get("name") or "").strip()[:200]
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    if not name or not email:
        raise HTTPException(status_code=400, detail="Name, email, and password required.")
    password_error = pw_reset.validate_new_password(password)  # same rule as password reset (8+ characters)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    if len(email) > 254:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    phone_raw = str(body.get("phone") or "").strip()
    if not is_valid_phone_input(phone_raw):
        raise HTTPException(
            status_code=400,
            detail="A valid mobile number is required at signup (10–15 digits, include country code if needed).",
        )
    phone = normalize_phone(phone_raw)
    db = runtime.load_db()
    if await asyncio.to_thread(find_user, db, email=email) is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                "An account with this email already exists. Each email can only be registered once "
                "as either a candidate or a vendor (employer)."
            ),
        )
    if await asyncio.to_thread(find_user_by_phone_in_db, db, phone_raw):
        raise HTTPException(status_code=409, detail="An account with this mobile number already exists.")
    from app.db.persistence import persistence_ready
    if not persistence_ready(config.database_url):
        raise HTTPException(
            status_code=503,
            detail="Database not configured. Set DATABASE_URL.",
        )
    role = "employer" if body.get("role") == "employer" else "jobseeker"
    company_name = str(body.get("companyName") or "").strip()
    employer_err = validate_employer_signup(role, company_name)
    if employer_err:
        raise HTTPException(status_code=400, detail=employer_err)
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    # scrypt is deliberately slow (tens of ms of CPU): never run it on the event loop thread.
    password_hash = await asyncio.to_thread(hash_password, password)
    try:
        registered = await asyncio.to_thread(
            register_account,
            config.database_url,
            {
                "id": secrets.token_hex(8),
                "name": name,
                "email": email,
                "phone": phone,
                "passwordHash": password_hash,
                "role": role,
                "companyName": company_name if role == "employer" else None,
                "createdAt": created_at,
            },
        )
        user = registered["user"]
        # (This used to reload the ENTIRE database after every sign-up. Each request now reads only its own rows.)
    except UniqueAccountError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    if role != "employer":
        await upsert_candidate_talent(config.database_url or "", user, {}, None)
        if config.database_url.strip():

            def _create_profile() -> None:
                pool = db_pool(config.database_url)
                with pool.connection() as conn:
                    conn.execute(
                        """INSERT INTO profiles (email, user_id, data, updated_at)
                           VALUES (%s, %s, '{"completedSteps":0}'::jsonb, NOW())
                           ON CONFLICT (email) DO UPDATE SET
                             user_id = EXCLUDED.user_id,
                             data = '{"completedSteps":0}'::jsonb,
                             updated_at = NOW()""",
                        (email, user["id"]),
                    )
                    conn.commit()

            await asyncio.to_thread(_create_profile)  # never block the event loop on the database
    token = secrets.token_hex(16)
    await runtime.register_session(token, email)
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
            "companyName": user.get("companyName"),
            "phone": user.get("phone"),
        },
    }


@router.post("/login")
async def login(request: Request, body: dict) -> dict:
    ip = runtime.client_ip(request)
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    # Throttle per account (brute force) plus a generous per-IP ceiling. A flat 20/min per IP locked out whole
    # offices and campuses, where hundreds of people share one public address.
    if not runtime.rate_limit(f"login:{ip}", 300, strict=True) or not runtime.rate_limit(
        f"login-email:{email}", 10, strict=True
    ):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again shortly.")
    if len(password) > 1024 or len(email) > 254:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    # Failed sign-ins are counted in Postgres, so the lockout holds across every worker and instance (no Redis).
    if email and await asyncio.to_thread(login_guard.is_locked, config.database_url, email):
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts for this account. Try again in a few minutes or reset your password.",
        )
    db = runtime.load_db()
    user = await asyncio.to_thread(find_user, db, email=email)
    if (
        not user
        or user.get("status") != "active"
        or not await asyncio.to_thread(verify_password, password, user.get("passwordHash") or "")
    ):
        audit.fire(audit.LOGIN_FAILED, meta={"ip": ip, "email_fp": audit.email_fingerprint(email)})
        if email:
            await asyncio.to_thread(login_guard.record_failure, config.database_url, email)
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    await asyncio.to_thread(login_guard.clear, config.database_url, email)
    expected = body.get("expectedRole")
    expected_role = expected if expected in ("employer", "jobseeker") else None
    actual_role = "employer" if user.get("role") == "employer" else "jobseeker"
    role_err = login_role_mismatch_message(expected_role, actual_role)
    if role_err:
        raise HTTPException(status_code=403, detail=role_err)
    if not str(user.get("passwordHash") or "").startswith("scrypt$"):
        user["passwordHash"] = await asyncio.to_thread(hash_password, password)
        await runtime.save_db(db)
    token = secrets.token_hex(16)
    await runtime.register_session(token, email)
    audit.fire(
        audit.LOGIN_OK,
        user_id=user["id"],
        organization_id=user.get("primaryOrganizationId"),
        entity_type="user",
        entity_id=user["id"],
        meta={"ip": ip, "role": actual_role},
    )
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": actual_role,
            "companyName": user.get("companyName"),
            "phone": user.get("phone"),
            "primaryOrganizationId": user.get("primaryOrganizationId"),
        },
    }


@router.post("/password/forgot")
async def forgot_password(request: Request, body: dict) -> dict:
    """Email a single-use reset link. Always answers the same way so it can't reveal which emails have accounts."""
    ip = runtime.client_ip(request)
    email = str(body.get("email") or "").strip().lower()
    if not runtime.rate_limit(f"pwforgot-ip:{ip}", 10, 15 * 60_000, strict=True):
        raise HTTPException(status_code=429, detail="Too many reset requests. Try again in a few minutes.")
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    response = {"ok": True, "message": pw_reset.GENERIC_REQUEST_MESSAGE}
    if not runtime.rate_limit(f"pwforgot-email:{email}", 3, 60 * 60_000, strict=True):
        return response
    from app.db.persistence import persistence_ready
    if not persistence_ready(config.database_url):
        raise HTTPException(status_code=503, detail="Password reset is unavailable right now.")
    db = runtime.load_db()
    user = await asyncio.to_thread(find_user, db, email=email)
    if not user or user.get("status") != "active":
        return response
    token = pw_reset.new_reset_token()
    await asyncio.to_thread(pw_reset.store_reset_token, config.database_url or "", email, token, ip)
    try:
        link = f"{public_app_origin(trusted_request_origin(request))}/reset-password?token={token}"
    except RuntimeError:
        logger.error("Password reset requested but PUBLIC_APP_URL is not set; email not sent.")
        return response
    subject, body_html, text = pw_reset.reset_email_content(str(user.get("name") or ""), link)

    async def _deliver() -> None:
        try:
            if not smtp_configured():
                if is_prod_like:
                    logger.error("Password reset requested but email is not configured.")
                else:
                    logger.warning("Email not configured; dev password reset link for %s: %s", email, link)
                return
            await send_mail(to=email, subject=subject, html=body_html, text=text)
        except Exception:  # noqa: BLE001 — never surface delivery errors to the requester
            logger.exception("Failed to send password reset email")

    # Deliver in the background so response time does not reveal whether the account exists.
    background.spawn(_deliver(), "password-reset-email")
    return response


@router.post("/password/reset")
async def reset_password(request: Request, body: dict) -> dict:
    ip = runtime.client_ip(request)
    if not runtime.rate_limit(f"pwreset:{ip}", 10, 15 * 60_000, strict=True):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    token = str(body.get("token") or "").strip()
    password = str(body.get("password") or "")
    if not token:
        raise HTTPException(status_code=400, detail="This reset link is incomplete. Request a new one.")
    password_error = pw_reset.validate_new_password(password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    from app.db.persistence import persistence_ready
    if not persistence_ready(config.database_url):
        raise HTTPException(status_code=503, detail="Password reset is unavailable right now.")
    email = await asyncio.to_thread(pw_reset.consume_reset_token, config.database_url or "", token)
    if not email:
        raise HTTPException(
            status_code=400,
            detail="This reset link is invalid or has expired. Request a new one.",
        )
    db = runtime.load_db()
    user = await asyncio.to_thread(find_user, db, email=email)
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    user["passwordHash"] = await asyncio.to_thread(hash_password, password)  # scrypt (~60 ms): off the event loop
    await runtime.save_db(db)
    runtime.forget_sessions(email=email)
    await asyncio.to_thread(pw_reset.revoke_all_sessions, config.database_url, email)
    await asyncio.to_thread(login_guard.clear, config.database_url, email)
    return {"ok": True, "message": "Your password has been reset. Log in with your new password."}


@router.post("/password/change")
async def change_password(request: Request, body: dict) -> dict:
    """Signed-in password change (Settings > Email & password). Needs the current password; signs out every other
    session and returns a fresh token for this one."""
    email = await runtime.require_auth_email(request)
    if not runtime.rate_limit(f"pwchange:{email}", 10, 15 * 60_000, strict=True):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    current = str(body.get("currentPassword") or "")
    new_password = str(body.get("newPassword") or "")
    if not current:
        raise HTTPException(status_code=400, detail="Enter your current password.")
    password_error = pw_reset.validate_new_password(new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    if new_password == current:
        raise HTTPException(status_code=400, detail="Choose a password different from your current one.")
    db = runtime.load_db()
    user = await asyncio.to_thread(find_user, db, email=email)
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=401, detail="Unauthorized")
    if len(current) > 1024 or not await asyncio.to_thread(verify_password, current, user.get("passwordHash") or ""):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    user["passwordHash"] = await asyncio.to_thread(hash_password, new_password)
    await runtime.save_db(db)
    runtime.forget_sessions(email=email)
    if config.database_url:
        await asyncio.to_thread(pw_reset.revoke_all_sessions, config.database_url, email)
    token = secrets.token_hex(16)
    await runtime.register_session(token, email)
    return {"ok": True, "token": token, "message": "Password updated. Other devices were signed out."}


@router.post("/logout")
async def logout(request: Request) -> dict:
    header = request.headers.get("authorization") or ""
    token = re.sub(r"^Bearer\s+", "", header, flags=re.I).strip()
    await runtime.logout_token(token)
    return {"ok": True}


def _me_payload(email: str, lite: bool) -> dict:
    """Blocking: every lookup is a database round trip, so this runs in a worker thread (never on the event loop)."""
    db = runtime.load_db()
    user = find_user(db, email=email)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    tenant = runtime.tenant_context_for_user(db, user)
    plan = tenant.get("plan")
    base = {
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": "employer" if user.get("role") == "employer" else "jobseeker",
            "companyName": user.get("companyName"),
            "phone": user.get("phone"),
            "primaryOrganizationId": user.get("primaryOrganizationId"),
        },
        "organization": tenant.get("organization"),
        "subscription": tenant.get("subscription"),
        "plan": {
            "id": plan["id"],
            "code": plan["code"],
            "name": plan["name"],
            "limits": plan.get("limits"),
            "features": plan.get("features"),
        }
        if plan
        else None,
    }
    if lite:
        # Session check: account, organization and plan only. The profile (with the full resume), interview and
        # applications are left out (not null) and skip their queries; the full form is unchanged.
        return {**base, "lite": True}
    return {
        **base,
        "profile": (db.get("profiles") or {}).get(email),
        "interview": strip_interview_result_for_candidate((db.get("interviews") or {}).get(email)),
        "applications": (db.get("applications") or {}).get(email) or [],
    }


@router.get("/me")
async def me(request: Request) -> dict:
    email = await runtime.require_auth_email(request)
    return await asyncio.to_thread(_me_payload, email, str(request.query_params.get("lite") or "") == "1")


# Profile fields only the server may set (V-02/V-03). resumeStoragePath used to be client-writable, which let anyone
# point it at another user's S3 object and then download or delete it. interviewScore feeds talent-search ranking.
SERVER_OWNED_PROFILE_FIELDS = frozenset(
    {
        "resumeStoragePath",
        "resumeUrl",
        "resumeFileId",
        "storageProvider",
        "updatedAt",
        "interviewScore",
        "interviewResult",
        "email",
        "userId",
    }
)
PROFILE_VISIBILITY_VALUES = ("marketplace", "organization_only", "private")
MAX_PROFILE_KEYS = 200


def _has_non_finite(value, depth: int = 0) -> bool:
    import math

    if isinstance(value, float):
        return not math.isfinite(value)
    if depth > 20:
        return False
    if isinstance(value, dict):
        return any(_has_non_finite(v, depth + 1) for v in value.values())
    if isinstance(value, list):
        return any(_has_non_finite(v, depth + 1) for v in value)
    return False


def sanitize_profile_patch(body: dict) -> dict:
    """The client's profile patch minus server-owned fields, with the few typed fields validated."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON object")
    if len(body) > MAX_PROFILE_KEYS:
        raise HTTPException(status_code=400, detail="Too many profile fields.")
    patch = {k: v for k, v in body.items() if isinstance(k, str) and k not in SERVER_OWNED_PROFILE_FIELDS}
    if _has_non_finite(patch):
        # NaN / Infinity parse in Python but are not JSON: Postgres jsonb rejected them with an unhandled 500.
        raise HTTPException(status_code=400, detail="Invalid JSON object")
    if "profileVisibility" in patch and patch["profileVisibility"] not in PROFILE_VISIBILITY_VALUES:
        patch.pop("profileVisibility")
    if "shareContactWithRecruiters" in patch:
        patch["shareContactWithRecruiters"] = patch["shareContactWithRecruiters"] is True
    return patch


@router.put("/profile")
async def put_profile(request: Request, body: dict) -> dict:
    email = await runtime.require_auth_email(request)
    patch = sanitize_profile_patch(body)
    db = runtime.load_db()

    def _merge() -> dict:
        prev = dict((db.get("profiles") or {}).get(email) or {})
        prev.update(patch)  # server-owned fields (resume storage key, ...) keep their stored values
        account = find_user(db, email=email)
        if is_candidate_account(account):
            # The candidate's name always comes from the resume (a contradicting name in the patch is dropped).
            prev = apply_resume_name(prev, (account or {}).get("name") or "")
        prev["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        db.setdefault("profiles", {})[email] = prev
        return prev

    await asyncio.to_thread(_merge)
    await runtime.save_db(db)
    account = await asyncio.to_thread(find_user, db, email=email)
    if account and config.database_url:
        try:
            await upsert_candidate_talent(
                config.database_url,
                account,
                db["profiles"][email],
                (db.get("interviews") or {}).get(email),
            )
        except Exception:
            pass
    return {"profile": db["profiles"][email]}
