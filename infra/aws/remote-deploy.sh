#!/bin/bash
# Runs ON the EC2 instance (sent by deploy.sh through SSM Run Command). Arguments: <release-bucket> <release> <region> <env>
# Pulls the backend bundle, writes app.env from SSM Parameter Store, builds the image, swaps the container and rolls
# back to the previous image if the new one does not become healthy.
set -euo pipefail
BUCKET="$1"; RELEASE="$2"; REGION="$3"; ENV="$4"
APP=/opt/hirerighttt
cd "$APP"

aws s3 cp "s3://$BUCKET/backend-$RELEASE.tgz" /tmp/backend.tgz --region "$REGION" --only-show-errors
rm -rf "$APP/src" && mkdir -p "$APP/src" && tar -xzf /tmp/backend.tgz -C "$APP/src"

# Settings and secrets: every parameter under /hirerighttt/<env>/ becomes NAME=value.
aws ssm get-parameters-by-path --path "/hirerighttt/$ENV/" --with-decryption --recursive --region "$REGION" \
  --query 'Parameters[*].[Name,Value]' --output text \
  | while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > "$APP/app.env.new"
grep -q '^SESSION_SECRET=' "$APP/app.env.new" || { echo "SESSION_SECRET missing in SSM"; exit 1; }
mv "$APP/app.env.new" "$APP/app.env" && chmod 600 "$APP/app.env"

docker build -q -t "hirerighttt-api:$RELEASE" "$APP/src/backend"
PREVIOUS=$(docker inspect --format '{{.Config.Image}}' api 2>/dev/null || true)

run() {
  docker rm -f api >/dev/null 2>&1 || true
  docker run -d --name api --restart unless-stopped \
    --env-file "$APP/app.env" \
    -e WEB_CONCURRENCY=1 -e DB_POOL_MAX=5 -e TRUST_PROXY=true -e FORWARDED_ALLOW_IPS='*' \
    -p 80:8787 --memory 700m --log-opt max-size=10m --log-opt max-file=3 "$1" >/dev/null
}

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS -m 5 http://127.0.0.1/api/health/live >/dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

run "hirerighttt-api:$RELEASE"
if healthy; then
  echo "Deployed $RELEASE"
  docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
else
  echo "New release $RELEASE is not healthy. Last log lines:"; docker logs --tail 40 api || true
  if [ -n "$PREVIOUS" ]; then run "$PREVIOUS"; echo "Rolled back to $PREVIOUS"; fi
  exit 1
fi
