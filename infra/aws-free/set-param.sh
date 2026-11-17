#!/usr/bin/env bash
# Set one secret for the test environment (SSM Parameter Store, SecureString: free), from a hidden prompt.
# It takes effect on the next release (infra/aws-free/deploy.sh).
#   infra/aws-free/set-param.sh GEMINI_API_KEY
source "$(dirname "$0")/lib.sh"

load_config
KEY="${1:-}"
ALLOWED="GEMINI_API_KEY GEMINI_API_KEYS SMTP_EMAIL SMTP_APP_PASSWORD RESEND_API_KEY SENTRY_DSN ADMIN_EMAILS EMAIL_FROM"
[[ " $ALLOWED " == *" $KEY "* ]] || die "usage: set-param.sh KEY   (one of: $ALLOWED)"

read -r -s -p "Value for $KEY: " VALUE
echo
[[ -n "$VALUE" ]] || die "empty value"
put_param "$PARAM_ROOT/app/$KEY" "$VALUE" SecureString
echo "Saved $KEY. Run infra/aws-free/deploy.sh (or push to dev1) to apply it."
