from __future__ import annotations

import asyncio
import logging
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.auth_passwords import hash_password, verify_password
from app.auth_register import UniqueAccountError, register_account
from app.auth_roles import login_role_mismatch_message, validate_employer_signup
from app.auth_phone import find_user_by_phone, is_valid_phone_input, normalize_phone
from app.db import db_pool
from app.db.talent_index import upsert_candidate_talent
from app.node_config import config, is_prod_like
from app.proctoring.strip_proctoring import strip_interview_result_for_candidate
from app.server import runtime
from app.services import password_reset as pw_reset
from app.services.interview_invites import public_app_origin
from app.services.mail_service import send_mail, smtp_configured

router = APIRouter()
logger = logging.getLogger("hireright.auth")


@router.post("/signup", status_code=201)
async def signup(request: Request, body: dict) -> dict:
    ip = runtime.client_ip(request)
    if not config.signup_enabled:
        raise HTTPException(status_code=403, detail="Sign-up is disabled on this deployment.")
    if is_prod_like and not runtime.rate_limit(f"signup:{ip}", 8):
        raise HTTPException(status_code=429, detail="Too many signup attempts. Try again shortly.")
    name = str(body.get("name") or "").strip()
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    if not name or not email or len(password) < 6 or len(password) > 1024:
        raise HTTPException(status_code=400, detail="Name, email, and 6+ char password required.")
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
    if any(u.get("email") == email for u in db.get("users") or []):
        raise HTTPException(
            status_code=409,
            detail=(
                "An account with this email already exists. Each email can only be registered once "
                "as either a candidate or a vendor (employer)."
            ),
        )
    if find_user_by_phone(db.get("users") or [], phone_raw):
        raise HTTPException(status_code=409, detail="An account with this mobile number already exists.")
    if not config.database_url.strip():
        raise HTTPException(
            status_code=503,
            detail="Database not configured. Set DATABASE_URL in repo-root .env, then run: npm run db:init",
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
        runtime.set_db_cache(await asyncio.to_thread(runtime.load_db_sync))
    except UniqueAccountError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    if role != "employer" and config.database_url:
        await upsert_candidate_talent(config.database_url, user, {}, None)
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
    if not runtime.rate_limit(f"login:{ip}", 300) or not runtime.rate_limit(f"login-email:{email}", 10):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again shortly.")
    db = runtime.load_db()
    user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    if (
        not user
        or user.get("status") != "active"
        or not await asyncio.to_thread(verify_password, password, user.get("passwordHash") or "")
    ):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
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
    if not runtime.rate_limit(f"pwforgot-ip:{ip}", 10, 15 * 60_000):
        raise HTTPException(status_code=429, detail="Too many reset requests. Try again in a few minutes.")
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    response = {"ok": True, "message": pw_reset.GENERIC_REQUEST_MESSAGE}
    if not runtime.rate_limit(f"pwforgot-email:{email}", 3, 60 * 60_000):
        return response
    if not config.database_url.strip():
        raise HTTPException(status_code=503, detail="Password reset is unavailable right now.")
    db = runtime.load_db()
    user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    if not user or user.get("status") != "active":
        return response
    token = pw_reset.new_reset_token()
    await asyncio.to_thread(pw_reset.store_reset_token, config.database_url, email, token, ip)
    try:
        link = f"{public_app_origin()}/reset-password?token={token}"
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
    asyncio.get_running_loop().create_task(_deliver())
    return response


@router.post("/password/reset")
async def reset_password(request: Request, body: dict) -> dict:
    ip = runtime.client_ip(request)
    if not runtime.rate_limit(f"pwreset:{ip}", 10, 15 * 60_000):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    token = str(body.get("token") or "").strip()
    password = str(body.get("password") or "")
    if not token:
        raise HTTPException(status_code=400, detail="This reset link is incomplete. Request a new one.")
    password_error = pw_reset.validate_new_password(password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    if not config.database_url.strip():
        raise HTTPException(status_code=503, detail="Password reset is unavailable right now.")
    email = await asyncio.to_thread(pw_reset.consume_reset_token, config.database_url, token)
    if not email:
        raise HTTPException(
            status_code=400,
            detail="This reset link is invalid or has expired. Request a new one.",
        )
    db = runtime.load_db()
    user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    user["passwordHash"] = hash_password(password)
    await runtime.save_db(db)
    runtime.forget_sessions(email=email)
    await asyncio.to_thread(pw_reset.revoke_all_sessions, config.database_url, email)
    return {"ok": True, "message": "Your password has been reset. Log in with your new password."}


@router.post("/logout")
async def logout(request: Request) -> dict:
    header = request.headers.get("authorization") or ""
    token = re.sub(r"^Bearer\s+", "", header, flags=re.I).strip()
    await runtime.logout_token(token)
    return {"ok": True}


@router.get("/me")
async def me(request: Request) -> dict:
    email = await runtime.require_auth_email(request)
    db = runtime.load_db()
    user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    tenant = runtime.tenant_context_for_user(db, user)
    plan = tenant.get("plan")
    return {
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
        "profile": (db.get("profiles") or {}).get(email),
        "interview": strip_interview_result_for_candidate((db.get("interviews") or {}).get(email)),
        "applications": (db.get("applications") or {}).get(email) or [],
    }


@router.put("/profile")
async def put_profile(request: Request, body: dict) -> dict:
    email = await runtime.require_auth_email(request)
    db = runtime.load_db()
    prev = dict((db.get("profiles") or {}).get(email) or {})
    prev.update(body)
    prev["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    db.setdefault("profiles", {})[email] = prev
    await runtime.save_db(db)
    account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
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
