#!/usr/bin/env bash
# Set one API secret for an environment (stored in AWS Secrets Manager: hireright/<env>/app), then restart the API
# so it picks the value up. The value is read from a hidden prompt, so it never lands in shell history.
#   infra/aws/set-secret.sh staging GEMINI_API_KEY
source "$(dirname "$0")/lib.sh"

load_config "${1:-}"
KEY="${2:-}"
ALLOWED="GEMINI_API_KEY GEMINI_API_KEYS SMTP_EMAIL SMTP_APP_PASSWORD RESEND_API_KEY SENTRY_DSN ADMIN_EMAILS"
[[ " $ALLOWED " == *" $KEY "* ]] || die "usage: set-secret.sh staging|production KEY   (KEY one of: $ALLOWED)"

read -r -s -p "Value for $KEY ($ENV_NAME): " VALUE
echo
[[ -n "$VALUE" ]] || die "empty value"

SECRET_ID="hireright/$ENV_NAME/app"
current="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)"
updated="$(printf '%s' "$current" | KEY="$KEY" VALUE="$VALUE" "$PY" -c '
import json, os, sys
d = json.load(sys.stdin)
d[os.environ["KEY"]] = os.environ["VALUE"]
print(json.dumps(d))
')"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
printf '%s' "$updated" > "$tmp"
aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "file://$tmp" --query VersionId --output text >/dev/null
echo "Saved $KEY for $ENV_NAME."

if stack_exists "$STACK_PREFIX-app"; then
  cluster="$(stack_output "$STACK_PREFIX-app" ClusterName)"
  service="$(stack_output "$STACK_PREFIX-app" ServiceName)"
  aws ecs update-service --cluster "$cluster" --service "$service" --force-new-deployment \
    --query service.serviceName --output text >/dev/null
  echo "Restarting the API so it uses the new value (rolling, no downtime)."
fi
