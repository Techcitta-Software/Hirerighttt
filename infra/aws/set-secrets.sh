#!/usr/bin/env bash
# Store the app's secrets in AWS SSM Parameter Store (standard tier: free). Values are typed hidden and never written
# to disk. Re-run any time to change one; press Enter to keep the current value.
#   bash infra/aws/set-secrets.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/config.env"
export AWS_PROFILE AWS_REGION AWS_PAGER=""
PARAMS="/hirerighttt/$ENV"

exists() { aws ssm get-parameter --name "$PARAMS/$1" >/dev/null 2>&1; }
ask() { # name, description, required(yes/no)
  local name="$1" desc="$2" required="$3" value=""
  if exists "$name"; then printf '%s [set — Enter keeps it]: ' "$desc"; else printf '%s: ' "$desc"; fi
  read -rs value; echo
  if [ -n "$value" ]; then
    aws ssm put-parameter --name "$PARAMS/$name" --type SecureString --value "$value" --overwrite >/dev/null
    echo "  saved $name"
  elif [ "$required" = "yes" ] && ! exists "$name"; then
    echo "  $name is required"; exit 1
  fi
}

echo "Secrets go to SSM $PARAMS in $AWS_REGION (account: $(aws sts get-caller-identity --query Account --output text))."
if ! exists SESSION_SECRET; then
  aws ssm put-parameter --name "$PARAMS/SESSION_SECRET" --type SecureString --value "$(openssl rand -hex 48)" >/dev/null
  echo "  generated SESSION_SECRET"
fi
ask GEMINI_API_KEY "Gemini API key" yes
ask GEMINI_API_KEY_2 "Second Gemini key (optional, another Google project)" no
ask GEMINI_API_KEY_3 "Third Gemini key (optional)" no
if [ "$CREATE_DATABASE" != "true" ]; then
  ask DATABASE_URL "DATABASE_URL (Neon postgres://… connection string)" yes
fi
ask SMTP_EMAIL "SMTP email (Gmail address used to send mail)" no
ask SMTP_APP_PASSWORD "SMTP app password" no
ask EMAIL_FROM "From line, e.g. HireRighttt <no-reply@yourdomain>" no
ask RAZORPAY_KEY_ID "Razorpay key id (optional)" no
ask RAZORPAY_KEY_SECRET "Razorpay key secret (optional)" no
echo "Done. The instance reads these on every deploy (no AWS access keys are needed on the server)."
