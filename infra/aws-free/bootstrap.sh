#!/usr/bin/env bash
# One-time setup of the FREE-TIER test environment (run from a laptop, signed in to AWS as an administrator):
#   infra/aws-free/bootstrap.sh [github-owner/repo]
#
# Creates only free-tier resources: EC2 micro + Elastic IP, RDS PostgreSQL micro (20 GB), two S3 buckets,
# CloudFront, SSM parameters, a $1 budget alarm. It stops before creating anything if no free-tier-eligible
# instance type is reported for this account and region.
source "$(dirname "$0")/lib.sh"

load_config require-email
GITHUB_REPO="${1:-}"

step "AWS identity"
aws sts get-caller-identity --query Arn --output text || die "AWS CLI is not signed in (aws configure / aws sso login)"

step "Free-tier eligible instance type in $AWS_REGION"
eligible="$(aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true \
  --query 'InstanceTypes[].InstanceType' --output text | tr '\t' '\n')"
INSTANCE_TYPE=""
for candidate in t3.micro t2.micro t4g.micro t3.small t4g.small; do
  if grep -qx "$candidate" <<<"$eligible"; then INSTANCE_TYPE="$candidate"; break; fi
done
[[ -n "$INSTANCE_TYPE" ]] || die "this account reports no free-tier-eligible micro instance in $AWS_REGION; stopping (nothing created)"
case "$INSTANCE_TYPE" in
  t4g.*) AMI_PARAM=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 ;;
  *) AMI_PARAM=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 ;;
esac
echo "using $INSTANCE_TYPE (free-tier eligible)"

step "Default VPC"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
[[ "$VPC_ID" != "None" && -n "$VPC_ID" ]] || die "no default VPC in $AWS_REGION (create one: aws ec2 create-default-vpc)"
SUBNET_ID="$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true \
  --query 'sort_by(Subnets,&AvailabilityZone)[0].SubnetId' --output text)"
echo "$VPC_ID / $SUBNET_ID"

DB_VERSION="$(aws rds describe-db-engine-versions --engine postgres \
  --query "DBEngineVersions[?starts_with(EngineVersion, '16.')].EngineVersion" --output text | tr '\t' '\n' | sort -V | tail -1)"
[[ -n "$DB_VERSION" ]] || die "no PostgreSQL 16 version found"
CF_PREFIX_LIST="$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)"

step "Secrets in SSM Parameter Store (free; generated here, never printed)"
param_exists "$PARAM_ROOT/db-password" || put_param "$PARAM_ROOT/db-password" "$(random_secret 32)" SecureString
param_exists "$PARAM_ROOT/origin-verify" || put_param "$PARAM_ROOT/origin-verify" "$(random_secret 32)" String
param_exists "$PARAM_ROOT/app/SESSION_SECRET" || put_param "$PARAM_ROOT/app/SESSION_SECRET" "$(random_secret 48)" SecureString
param_exists "$PARAM_ROOT/app/CRON_SECRET" || put_param "$PARAM_ROOT/app/CRON_SECRET" "$(random_secret 32)" SecureString
DB_PASSWORD="$(aws ssm get-parameter --name "$PARAM_ROOT/db-password" --with-decryption --query Parameter.Value --output text)"
put_param "$PARAM_ROOT/app/DB_PASSWORD" "$DB_PASSWORD" SecureString
unset DB_PASSWORD

if [[ -n "$GITHUB_REPO" ]]; then
  if stack_exists hireright-github-deploy; then
    step "GitHub deploy role exists"
  else
    step "GitHub deploy role for $GITHUB_REPO (OpenID Connect; IAM is free)"
    create_provider=true
    aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text \
      | grep -q token.actions.githubusercontent.com && create_provider=false
    aws cloudformation deploy --stack-name hireright-github-deploy \
      --template-file "$FREE_DIR/../aws/github-oidc.yaml" --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
      --parameter-overrides "GitHubRepo=$GITHUB_REPO" "CreateOidcProvider=$create_provider"
  fi
fi

step "Server + database + buckets ($BASE_STACK). RDS takes about 10 minutes."
aws cloudformation deploy --stack-name "$BASE_STACK" --template-file "$FREE_DIR/base.yaml" \
  --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --tags Project=hireright Environment=test \
  --parameter-overrides "InstanceType=$INSTANCE_TYPE" "AmiParameter=$AMI_PARAM" "DbEngineVersion=$DB_VERSION" \
  "VpcId=$VPC_ID" "SubnetId=$SUBNET_ID" "CloudFrontPrefixListId=$CF_PREFIX_LIST" "AlertEmail=$ALERT_EMAIL"

PUBLIC_IP="$(stack_output "$BASE_STACK" PublicIp)"
ORIGIN_DOMAIN="ec2-${PUBLIC_IP//./-}.$AWS_REGION.compute.amazonaws.com"

step "CloudFront ($CDN_STACK) -> $ORIGIN_DOMAIN. Takes about 5 minutes."
aws cloudformation deploy --stack-name "$CDN_STACK" --template-file "$FREE_DIR/cdn.yaml" \
  --no-fail-on-empty-changeset --tags Project=hireright Environment=test \
  --parameter-overrides "OriginDomain=$ORIGIN_DOMAIN"
SITE="https://$(stack_output "$CDN_STACK" SiteDomain)"

step "App settings in SSM ($PARAM_ROOT/app/)"
FILES_BUCKET="$(stack_output "$BASE_STACK" FilesBucket)"
while IFS='=' read -r key value; do
  [[ -n "$key" ]] && put_param "$PARAM_ROOT/app/$key" "$value" String
done <<EOF
ENVIRONMENT=staging
NODE_ENV=production
STRICT_PRODUCTION_CONFIG=true
ALLOW_DEMO_ACCOUNTS=false
SIGNUP_ENABLED=true
TRUST_PROXY=true
PORT=8787
WEB_CONCURRENCY=1
DB_POOL_MIN=1
DB_POOL_MAX=5
MAX_REQUEST_BYTES=3000000
LOG_LEVEL=INFO
DATABASE_PROVIDER=neon
PG_DIRECT_DNS=true
DB_HOST=$(stack_output "$BASE_STACK" DatabaseHost)
DB_NAME=hireright
DB_USER=hireright
S3_BUCKET=$FILES_BUCKET
AWS_REGION=$AWS_REGION
CORS_ORIGINS=$SITE
PUBLIC_APP_URL=$SITE
EMAIL_PROVIDER=$EMAIL_PROVIDER
EOF

step "Allow the site to upload/play recordings in s3://$FILES_BUCKET"
cors="$(mktemp)"
printf '{"CORSRules":[{"AllowedOrigins":["%s"],"AllowedMethods":["GET","PUT","POST","HEAD"],"AllowedHeaders":["*"],"ExposedHeaders":["ETag"],"MaxAgeSeconds":3600}]}' "$SITE" > "$cors"
aws s3api put-bucket-cors --bucket "$FILES_BUCKET" --cors-configuration "file://$cors"
rm -f "$cors"

ROLE_LINE=""
if stack_exists hireright-github-deploy; then
  ROLE_LINE="      Variables: AWS_DEPLOY_ROLE_ARN = $(stack_output hireright-github-deploy DeployRoleArn)   and   AWS_TEST_DEPLOY = true
      Environments: create one named \"test\""
fi

cat <<EOF

Test environment ready (free tier): $SITE

 1. Confirm the "AWS Budgets" / notification email sent to $ALERT_EMAIL.
 2. Set the app's secrets (hidden prompt):
      infra/aws-free/set-param.sh GEMINI_API_KEY
      infra/aws-free/set-param.sh SMTP_EMAIL
      infra/aws-free/set-param.sh SMTP_APP_PASSWORD
      infra/aws-free/set-param.sh ADMIN_EMAILS
 3. First release:   infra/aws-free/deploy.sh
 4. Automatic releases from GitHub on every push to dev1 (repository Settings -> Secrets and variables -> Actions):
${ROLE_LINE:-      run this script again with your owner/repo to create the GitHub deploy role}
 5. When testing is over:   infra/aws-free/teardown.sh   (removes everything so nothing can bill later)
EOF
