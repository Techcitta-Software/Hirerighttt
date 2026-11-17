#!/usr/bin/env bash
# Runs ON the test server (sent by deploy.sh through SSM Run Command, as root):
#   remote-deploy.sh <release> <region>
# The release is already unpacked in /opt/hireright/releases/<release>. Renders the API env file from SSM Parameter
# Store, builds and starts the containers, checks health, and rolls back to the previous release if it fails.
set -euo pipefail

RELEASE="$1"
REGION="$2"
ROOT=/opt/hireright
DIR="$ROOT/releases/$RELEASE"
export AWS_DEFAULT_REGION="$REGION"
export AWS_PAGER=""

[[ -f "$ROOT/bootstrapped" ]] || { echo "server setup (user data) has not finished yet; retry in a minute"; exit 1; }
cd "$DIR"

echo "==> Render the API environment from SSM (/hireright/test/app/*)"
umask 077
tmp="$(mktemp)"
aws ssm get-parameters-by-path --path /hireright/test/app/ --with-decryption --recursive \
  --query 'Parameters[].[Name,Value]' --output text \
  | while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > "$tmp"
grep -q '^DB_HOST=' "$tmp" || { echo "SSM parameters are missing (run infra/aws-free/bootstrap.sh)"; exit 1; }
printf 'API_BUILD_ID=%s\nGIT_COMMIT=%s\n' "$RELEASE" "$RELEASE" >> "$tmp"
mv "$tmp" "$ROOT/api.env"
chmod 600 "$ROOT/api.env"
ORIGIN_VERIFY="$(aws ssm get-parameter --name /hireright/test/origin-verify --query Parameter.Value --output text)"
export ORIGIN_VERIFY RELEASE

previous="$(cat "$ROOT/current-release" 2>/dev/null || true)" # the release that is live now

start() { # dir release
  (cd "$1" && RELEASE="$2" docker compose up -d --build --remove-orphans)
}
healthy() {
  for _ in $(seq 1 40); do
    if curl -fsS --max-time 5 -H "X-Origin-Verify: $ORIGIN_VERIFY" http://127.0.0.1/api/health/live >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

echo "==> Build and start release $RELEASE"
start "$DIR" "$RELEASE"
if healthy; then
  echo "$RELEASE" > "$ROOT/current-release"
  echo "==> Healthy: $RELEASE is live"
else
  echo "==> $RELEASE failed its health check. Last API log lines:"
  (cd "$DIR" && docker compose logs --tail 60 api) || true
  if [[ -n "$previous" && "$previous" != "$RELEASE" && -d "$ROOT/releases/$previous" ]]; then
    echo "==> Rolling back to $previous"
    start "$ROOT/releases/$previous" "$previous" || true
  fi
  exit 1
fi

echo "==> Clean up (keep the last 3 releases)"
for old in $(ls -1t "$ROOT/releases" | tail -n +4); do
  [[ "$old" == "$RELEASE" ]] || rm -rf "${ROOT:?}/releases/$old"
done
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
docker builder prune -af --filter "until=72h" >/dev/null 2>&1 || true
df -h / | tail -1
