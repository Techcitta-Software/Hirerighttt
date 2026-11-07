"""Send one test email to confirm your mail settings work.

Usage (from the backend folder):  python send_test_email.py you@example.com
Reads the repo-root .env (RESEND_API_KEY + EMAIL_FROM, or SMTP_EMAIL + SMTP_APP_PASSWORD) and
PUBLIC_APP_URL, then sends the real invite template with a sample link. Secrets are never printed.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone

from app.load_env import load_env

load_env()

from app.services.interview_invites import build_interview_invite_email, public_app_origin  # noqa: E402
from app.services.mail_service import send_mail, smtp_configured  # noqa: E402


async def main(to: str) -> int:
    if not smtp_configured():
        print("Mail is NOT configured. Set RESEND_API_KEY + EMAIL_FROM, or SMTP_EMAIL + SMTP_APP_PASSWORD in .env")
        return 1
    try:
        origin = public_app_origin()
    except RuntimeError as err:
        print(f"Warning: {err}")
        origin = "https://your-app.example"
    now = datetime.now(timezone.utc)
    mail = build_interview_invite_email(
        candidateName="Test Candidate",
        jobTitle="Sample role",
        scheduledStart=now.isoformat(),
        scheduledEnd=(now + timedelta(days=7)).isoformat(),
        inviteUrl=f"{origin}/interview/invite/sample-token",
        openInvite=True,
    )
    await send_mail(to=to, subject="[Test] " + mail["subject"], html=mail["html"], text=mail["text"])
    print(f"Sent a test invite email to {to}. Check the inbox (and spam).")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2 or "@" not in sys.argv[1]:
        print("Usage: python send_test_email.py you@example.com")
        raise SystemExit(2)
    raise SystemExit(asyncio.run(main(sys.argv[1])))
