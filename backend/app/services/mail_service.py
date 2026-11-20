"""Outgoing email, with a pluggable provider.

MAIL_PROVIDER selects the sender (EMAIL_PROVIDER is accepted as an older alias):

* ``smtp``   (default) SMTP + STARTTLS, e.g. Gmail with an app password: SMTP_EMAIL, SMTP_APP_PASSWORD,
             optional SMTP_HOST / SMTP_PORT / EMAIL_FROM.
* ``resend`` Resend's HTTPS API: RESEND_API_KEY and EMAIL_FROM (a sender on a domain verified in Resend).

When MAIL_PROVIDER is unset, ``resend`` is used if RESEND_API_KEY is set, otherwise ``smtp`` (the behaviour before
the provider switch existed). Amazon SES is intentionally NOT supported (no AWS mail service, no extra IAM rights).

Blocking work (the SMTP handshake, login and send take 1-5 s) always runs in a worker thread, never on the event
loop. Subjects are stripped of CR/LF so user-supplied text (contact-form names, job titles) cannot inject headers.
"""

from __future__ import annotations

import asyncio
import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, parseaddr

PROVIDERS = ("smtp", "resend")
RESEND_URL = "https://api.resend.com/emails"
SMTP_TIMEOUT_S = 20.0
RESEND_TIMEOUT_S = 15.0


class MailNotConfigured(RuntimeError):
    pass


def mail_provider() -> str:
    raw = (os.environ.get("MAIL_PROVIDER") or os.environ.get("EMAIL_PROVIDER") or "").strip().lower()
    if raw in PROVIDERS:
        return raw
    return "resend" if os.environ.get("RESEND_API_KEY") else "smtp"


def _smtp_ready() -> bool:
    return bool(os.environ.get("SMTP_EMAIL") and os.environ.get("SMTP_APP_PASSWORD"))


def _resend_ready() -> bool:
    return bool(os.environ.get("RESEND_API_KEY") and (os.environ.get("EMAIL_FROM") or os.environ.get("SMTP_EMAIL")))


def smtp_configured() -> bool:
    """True when the selected provider has everything it needs (name kept for existing callers)."""
    return _resend_ready() if mail_provider() == "resend" else _smtp_ready()


mail_configured = smtp_configured


def _clean_header(value: str, limit: int = 250) -> str:
    return re.sub(r"[\r\n\x00]+", " ", str(value or "")).strip()[:limit]


def _clean_address(value: str) -> str:
    addr = _clean_header(value, 320)
    if not re.match(r"^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$", parseaddr(addr)[1] or ""):
        raise ValueError("Invalid recipient address")
    return addr


def _send_smtp_sync(to: str, subject: str, html: str, text: str | None) -> None:
    host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or 587)
    user = os.environ.get("SMTP_EMAIL") or ""
    password = os.environ.get("SMTP_APP_PASSWORD") or ""
    if not user or not password:
        raise MailNotConfigured("Mail not configured")
    # The SMTP account is the envelope and header sender (Gmail rewrites any other From). EMAIL_FROM only adds a
    # display name when it names the same address.
    name, addr = parseaddr(os.environ.get("EMAIL_FROM") or "")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((name, user)) if name and addr.lower() == user.lower() else user
    msg["To"] = to
    msg.attach(MIMEText(text or "", "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    with smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT_S) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(user, [to], msg.as_string())


async def _send_resend(to: str, subject: str, html: str, text: str | None) -> None:
    import httpx

    key = os.environ.get("RESEND_API_KEY") or ""
    sender = os.environ.get("EMAIL_FROM") or os.environ.get("SMTP_EMAIL") or ""
    if not key or not sender:
        raise MailNotConfigured("Resend is selected but RESEND_API_KEY / EMAIL_FROM are not set")
    timeout = httpx.Timeout(RESEND_TIMEOUT_S, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={"from": sender, "to": [to], "subject": subject, "html": html, "text": text or ""},
        )
        res.raise_for_status()


async def send_mail(*, to: str, subject: str, html: str, text: str | None = None) -> None:
    to = _clean_address(to)
    subject = _clean_header(subject)
    if mail_provider() == "resend":
        await _send_resend(to, subject, html, text)
        return
    await asyncio.to_thread(_send_smtp_sync, to, subject, html, text)
