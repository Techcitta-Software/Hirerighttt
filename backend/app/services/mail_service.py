from __future__ import annotations

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def smtp_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY") or (os.environ.get("SMTP_EMAIL") and os.environ.get("SMTP_APP_PASSWORD")))


async def send_mail(*, to: str, subject: str, html: str, text: str | None = None) -> None:
    if os.environ.get("RESEND_API_KEY"):
        import httpx

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
                json={
                    "from": os.environ.get("EMAIL_FROM") or os.environ.get("SMTP_EMAIL"),
                    "to": [to],
                    "subject": subject,
                    "html": html,
                    "text": text or "",
                },
            )
            res.raise_for_status()
        return
    host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or 587)
    user = os.environ.get("SMTP_EMAIL") or ""
    password = os.environ.get("SMTP_APP_PASSWORD") or ""
    if not user or not password:
        raise RuntimeError("Mail not configured")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg.attach(MIMEText(text or "", "plain"))
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(user, [to], msg.as_string())
