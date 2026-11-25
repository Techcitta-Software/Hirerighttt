#!/usr/bin/env bash
# Deploy HireRighttt to AWS (free tier). Run from Git Bash / any bash:  bash infra/aws/deploy.sh
#   1. creates or updates the CloudFormation stack (EC2 + CloudFront + S3 + budget [+ RDS])
#   2. fills the non-secret settings in SSM Parameter Store
#   3. ships the backend to the instance and restarts it (with automatic rollback)
#   4. builds the website and uploads it to S3, then refreshes CloudFront
# Run ./set-secrets.sh once before the first deploy.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/config.env"
export AWS_PROFILE AWS_REGION AWS_PAGER=""
PARAMS="/hirerighttt/$ENV"
say() { printf '\n==> %s\n' "$*"; }

[ -n "${BUDGET_EMAIL// }" ] || { echo "Set BUDGET_EMAIL in infra/aws/config.env first."; exit 1; }
say "AWS account: $(aws sts get-caller-identity --query Arn --output text)  region: $AWS_REGION"

for required in SESSION_SECRET GEMINI_API_KEY; do
  aws ssm get-parameter --name "$PARAMS/$required" --query Parameter.Name --output text >/dev/null 2>&1 \
    || { echo "Missing $PARAMS/$required — run: bash infra/aws/set-secrets.sh"; exit 1; }
done
if [ "$CREATE_DATABASE" != "true" ]; then
  aws ssm get-parameter --name "$PARAMS/DATABASE_URL" --query Parameter.Name --output text >/dev/null 2>&1 \
    || { echo "Missing $PARAMS/DATABASE_URL (CREATE_DATABASE=false) — run set-secrets.sh"; exit 1; }
else
  aws ssm get-parameter --name "$PARAMS/DB_PASSWORD" >/dev/null 2>&1 || {
    say "Creating the RDS master password in SSM"
    aws ssm put-parameter --name "$PARAMS/DB_PASSWORD" --type SecureString --value "$(openssl rand -hex 24)" >/dev/null
  }
fi

say "Stack $STACK"
PREFIX_LIST=$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$HERE/template.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    Env="$ENV" InstanceType="$INSTANCE_TYPE" CloudFrontPrefixListId="$PREFIX_LIST" \
    ResumeBucketName="$RESUME_BUCKET" CreateDatabase="$CREATE_DATABASE" BudgetEmail="$BUDGET_EMAIL"

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
SITE_URL=$(out SiteUrl); DIST_ID=$(out DistributionId); SITE_BUCKET=$(out SiteBucket)
RELEASE_BUCKET=$(out ReleaseBucket); INSTANCE_ID=$(out InstanceId)

say "Settings in SSM ($PARAMS)"
put() { aws ssm put-parameter --name "$PARAMS/$1" --type "${3:-String}" --value "$2" --overwrite >/dev/null; }
put_if_missing() { aws ssm get-parameter --name "$PARAMS/$1" >/dev/null 2>&1 || put "$1" "$2" "${3:-String}"; }
put ENVIRONMENT production
put NODE_ENV production
put ALLOW_DEMO_ACCOUNTS false
put TRUST_PROXY true
put PUBLIC_APP_URL "$SITE_URL"
put_if_missing CORS_ORIGINS "$SITE_URL"
put S3_BUCKET "$RESUME_BUCKET"
put AWS_REGION "$RESUME_BUCKET_REGION"
put_if_missing CRON_SECRET "$(openssl rand -hex 32)" SecureString
if [ "$CREATE_DATABASE" = "true" ]; then
  put DB_HOST "$(out DbHost)"; put DB_PORT 5432; put DB_NAME hireright; put DB_USER hireright
fi

say "Backend → $INSTANCE_ID"
RELEASE="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)-$(date +%Y%m%d%H%M%S)"
BUILD="$HERE/.build"; mkdir -p "$BUILD"
tar -czf "$BUILD/backend.tgz" -C "$ROOT" \
  --exclude='backend/tests' --exclude='*/__pycache__' --exclude='backend/.pytest_*' --exclude='backend/.venv' backend
aws s3 cp "$BUILD/backend.tgz" "s3://$RELEASE_BUCKET/backend-$RELEASE.tgz" --only-show-errors

echo "Waiting for the instance to come online in SSM (first deploy: ~2 min)…"
for _ in $(seq 1 60); do
  [ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
      --query 'length(InstanceInformationList)' --output text)" = "1" ] && break
  sleep 10
done
SCRIPT_B64=$(base64 -w0 "$HERE/remote-deploy.sh" 2>/dev/null || base64 "$HERE/remote-deploy.sh" | tr -d '\n')
CMD="echo $SCRIPT_B64 | base64 -d > /tmp/hr-deploy.sh && bash /tmp/hr-deploy.sh $RELEASE_BUCKET $RELEASE $AWS_REGION $ENV"
COMMAND_ID=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --timeout-seconds 1200 --comment "hirerighttt $RELEASE" \
  --parameters "commands=[\"$CMD\"],executionTimeout=[\"1200\"]" --query Command.CommandId --output text)
echo "Building and starting the API (a few minutes on a micro instance)…"
STATUS=InProgress
while [ "$STATUS" = "InProgress" ] || [ "$STATUS" = "Pending" ] || [ "$STATUS" = "Delayed" ]; do
  sleep 10
  STATUS=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
done
aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text | tail -25
[ "$STATUS" = "Success" ] || { echo "Backend deploy failed ($STATUS)."; exit 1; }

say "Website → s3://$SITE_BUCKET"
( cd "$ROOT" && npm ci --no-audit --no-fund && VITE_API_URL= VITE_PUBLIC_APP_URL="$SITE_URL" npm run build )
DIST="$ROOT/frontend/dist"
aws s3 sync "$DIST/assets" "s3://$SITE_BUCKET/assets" --delete --only-show-errors \
  --cache-control "public,max-age=31536000,immutable"
aws s3 sync "$DIST" "s3://$SITE_BUCKET" --delete --only-show-errors --exclude "assets/*" --exclude "index.html" \
  --cache-control "public,max-age=3600"
aws s3 cp "$DIST/index.html" "s3://$SITE_BUCKET/index.html" --only-show-errors --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/" "/index.html" --query Invalidation.Id --output text >/dev/null

say "Done: $SITE_URL"
curl -s -m 30 -o /dev/null -w "API health through CloudFront: HTTP %{http_code}\n" "$SITE_URL/api/health/live" || true
