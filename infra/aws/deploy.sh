#!/usr/bin/env bash
# Release HireRight to AWS. Run by the GitHub Actions pipeline on every push (dev1 -> staging, main -> production);
# can also be run by hand:  infra/aws/deploy.sh staging "$(git rev-parse HEAD)"
#
#   1. network + data stacks (no-op when unchanged)
#   2. API image -> ECR (tagged with the git commit; skipped if that tag already exists)
#   3. app stack -> ECS rolling deploy (rolls back automatically if the new containers fail health checks)
#   4. React build -> S3, CloudFront refresh
#   5. smoke test against the live site
source "$(dirname "$0")/lib.sh"

load_config "${1:-}"
IMAGE_TAG="${2:-}"
[[ -n "$IMAGE_TAG" ]] || die "usage: deploy.sh staging|production <image-tag (git commit)>"
IMAGE_TAG="${IMAGE_TAG:0:40}"

stack_exists "$STACK_PREFIX-edge" us-east-1 || die "run infra/aws/bootstrap.sh $ENV_NAME first (edge stack missing)"

deploy_network
deploy_data
require_app_secrets

# ---------------------------------------------------------------- API image
REPO_URI="$(stack_output "$STACK_PREFIX-data" ApiRepositoryUri)"
REPO_NAME="$(stack_output "$STACK_PREFIX-data" ApiRepositoryName)"
if aws ecr describe-images --repository-name "$REPO_NAME" --image-ids "imageTag=$IMAGE_TAG" >/dev/null 2>&1; then
  step "Image $IMAGE_TAG already in ECR"
else
  step "Build and push API image $REPO_URI:$IMAGE_TAG"
  aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO_URI%%/*}"
  docker build --pull -t "$REPO_URI:$IMAGE_TAG" "$REPO_ROOT/backend"
  docker push "$REPO_URI:$IMAGE_TAG"
fi

# ---------------------------------------------------------------- app stack (ECS deploy)
EDGE_CERT_ARN="$(stack_output "$STACK_PREFIX-edge" CertificateArn us-east-1)"
WEB_ACL_ARN="$(stack_output "$STACK_PREFIX-edge" WebAclArn us-east-1)"
CF_PREFIX_LIST="$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)"
step "App ($STACK_PREFIX-app): rolling deploy of $IMAGE_TAG (waits until the new containers are healthy)"
cfn_deploy "$STACK_PREFIX-app" "$AWS_DIR/app.yaml" "$AWS_REGION" \
  "EnvironmentName=$ENV_NAME" "DomainName=$DOMAIN_NAME" "HostedZoneId=$HOSTED_ZONE_ID" \
  "EdgeCertificateArn=$EDGE_CERT_ARN" "WebAclArn=$WEB_ACL_ARN" "CloudFrontPrefixListId=$CF_PREFIX_LIST" \
  "ImageTag=$IMAGE_TAG" "TaskCpu=$TASK_CPU" "TaskMemory=$TASK_MEMORY" "MinTasks=$MIN_TASKS" "MaxTasks=$MAX_TASKS" \
  "WebConcurrency=$WEB_CONCURRENCY" "DbPoolMax=$DB_POOL_MAX" "EmailProvider=$EMAIL_PROVIDER" \
  "EmailFrom=${EMAIL_FROM:-}" "AlertEmail=$ALERT_EMAIL"

# ---------------------------------------------------------------- React site
SITE_BUCKET="$(stack_output "$STACK_PREFIX-app" FrontendBucketName)"
DISTRIBUTION_ID="$(stack_output "$STACK_PREFIX-app" DistributionId)"
step "Build the React site (API on the same origin: https://$DOMAIN_NAME/api)"
(
  cd "$REPO_ROOT" || exit 1
  [[ -d node_modules ]] || npm ci --no-audit --no-fund
  VITE_AUTH_PROVIDER=api VITE_API_URL="" VITE_PUBLIC_APP_URL="https://$DOMAIN_NAME" npm run build
)
DIST="$REPO_ROOT/frontend/dist"
[[ -f "$DIST/index.html" ]] || die "frontend build produced no index.html"
step "Upload the site to s3://$SITE_BUCKET"
# Hashed bundles never change: cache for a year. Old bundles are kept so open tabs keep working mid-deploy.
if [[ -d "$DIST/assets" ]]; then
  aws s3 sync "$DIST/assets" "s3://$SITE_BUCKET/assets" --cache-control "public,max-age=31536000,immutable" --only-show-errors
fi
aws s3 sync "$DIST" "s3://$SITE_BUCKET" --exclude "assets/*" --exclude "index.html" \
  --cache-control "public,max-age=300" --only-show-errors
aws s3 cp "$DIST/index.html" "s3://$SITE_BUCKET/index.html" --cache-control "no-cache" --only-show-errors
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/index.html" "/" \
  --query "Invalidation.Id" --output text >/dev/null

# ---------------------------------------------------------------- smoke test
step "Smoke test https://$DOMAIN_NAME"
ok=""
for _ in $(seq 1 20); do
  if body="$(curl -fsS --max-time 10 "https://$DOMAIN_NAME/api/health" 2>/dev/null)" && [[ "$body" == *'"ok":true'* ]]; then
    ok=1
    break
  fi
  sleep 10
done
[[ -n "$ok" ]] || die "https://$DOMAIN_NAME/api/health did not answer ok after the deploy"
curl -fsS --max-time 10 -o /dev/null "https://$DOMAIN_NAME/" || die "the site did not load"
curl -fsS --max-time 10 -o /dev/null "https://$DOMAIN_NAME/login" || die "client-side routes are not served"
echo
echo "Deployed $IMAGE_TAG to $ENV_NAME: https://$DOMAIN_NAME"
