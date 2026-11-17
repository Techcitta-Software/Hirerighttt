#!/usr/bin/env bash
# Release to the FREE-TIER test environment (GitHub Actions runs this on every push to dev1; also works by hand):
#   infra/aws-free/deploy.sh [release-id]        (default: the current git commit)
#
#   1. build the React site (API on the same origin)
#   2. package site + backend source + compose/nginx files -> S3 releases bucket (deleted after a day)
#   3. SSM Run Command on the server: unpack, build the API image there, start, health-check, roll back on failure
#   4. smoke test through CloudFront
source "$(dirname "$0")/lib.sh"

load_config
RELEASE="${1:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
RELEASE="${RELEASE:0:40}"
stack_exists "$CDN_STACK" || die "run infra/aws-free/bootstrap.sh first"

gemini="$(aws ssm get-parameter --name "$PARAM_ROOT/app/GEMINI_API_KEY" --with-decryption \
  --query Parameter.Value --output text 2>/dev/null || true)"
[[ -n "$gemini" && "$gemini" != "None" ]] || die "set the Gemini key first: infra/aws-free/set-param.sh GEMINI_API_KEY"
unset gemini

INSTANCE_ID="$(stack_output "$BASE_STACK" InstanceId)"
RELEASES_BUCKET="$(stack_output "$BASE_STACK" ReleasesBucket)"
SITE="https://$(stack_output "$CDN_STACK" SiteDomain)"

step "Build the React site for $SITE"
(
  cd "$REPO_ROOT" || exit 1
  [[ -d node_modules ]] || npm ci --no-audit --no-fund
  VITE_AUTH_PROVIDER=api VITE_API_URL="" VITE_PUBLIC_APP_URL="$SITE" npm run build
)
[[ -f "$REPO_ROOT/frontend/dist/index.html" ]] || die "frontend build produced no index.html"

step "Package release $RELEASE"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pkg="$work/pkg"
mkdir -p "$pkg"
# committed backend files only (no .env, caches or local data)
git -C "$REPO_ROOT" archive --format=tar HEAD backend | tar -x -C "$pkg"
cp -r "$REPO_ROOT/frontend/dist" "$pkg/site"
cp "$FREE_DIR/docker-compose.yml" "$FREE_DIR/nginx.conf.template" "$FREE_DIR/remote-deploy.sh" "$pkg/"
tar -czf "$work/$RELEASE.tgz" -C "$pkg" .
echo "$(du -h "$work/$RELEASE.tgz" | cut -f1) package"
aws s3 cp "$work/$RELEASE.tgz" "s3://$RELEASES_BUCKET/releases/$RELEASE.tgz" --only-show-errors

step "Install on $INSTANCE_ID through SSM (builds the API image on the server; a few minutes)"
params="$work/params.json"
"$PY" - "$RELEASES_BUCKET" "$RELEASE" "$AWS_REGION" > "$params" <<'PYEOF'
import json, sys
bucket, release, region = sys.argv[1:]
d = f"/opt/hireright/releases/{release}"
print(json.dumps({
    "commands": [
        "set -euo pipefail",
        f"mkdir -p {d}",
        f"aws s3 cp s3://{bucket}/releases/{release}.tgz /tmp/{release}.tgz --region {region} --only-show-errors",
        f"tar -xzf /tmp/{release}.tgz -C {d}",
        f"rm -f /tmp/{release}.tgz",
        f"bash {d}/remote-deploy.sh {release} {region}",
    ],
    "executionTimeout": ["1800"],
}))
PYEOF
COMMAND_ID="$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --comment "hireright release ${RELEASE:0:12}" --parameters "file://$params" --timeout-seconds 600 \
  --query Command.CommandId --output text)"
status=Pending
for _ in $(seq 1 180); do
  sleep 10
  status="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)"
  [[ "$status" == Pending || "$status" == InProgress || "$status" == Delayed ]] || break
done
aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent --output text | tail -25
if [[ "$status" != Success ]]; then
  aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query StandardErrorContent --output text | tail -25 >&2
  die "release failed on the server (status: $status); the previous release keeps running"
fi

step "Smoke test $SITE"
ok=""
for _ in $(seq 1 12); do
  if body="$(curl -fsS --max-time 10 "$SITE/api/health" 2>/dev/null)" && [[ "$body" == *'"ok":true'* ]]; then
    ok=1
    break
  fi
  sleep 10
done
[[ -n "$ok" ]] || die "$SITE/api/health did not answer ok"
curl -fsS --max-time 10 -o /dev/null "$SITE/login" || die "the site did not load"
echo
echo "Released ${RELEASE:0:12} to the test environment: $SITE"
