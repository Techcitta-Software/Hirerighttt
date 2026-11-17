#!/usr/bin/env bash
# One-time setup of an environment, run by an AWS administrator from a laptop:
#   infra/aws/bootstrap.sh staging bharath-techcitta/HireRighttt-backend
#
# Creates: the GitHub deploy role (once per account), the HTTPS certificate + firewall (us-east-1), the network, and
# the data layer (Aurora, Valkey, S3, ECR, secrets). After this, set the secrets and let GitHub Actions deploy.
source "$(dirname "$0")/lib.sh"

load_config "${1:-}"
GITHUB_REPO="${2:-}"
[[ "$GITHUB_REPO" == */* ]] || die "usage: bootstrap.sh staging|production <github-owner/repo that deploys>"

step "AWS identity"
aws sts get-caller-identity --query Arn --output text || die "AWS CLI is not signed in (aws configure / aws sso login)"

step "Route 53 hosted zone $HOSTED_ZONE_ID"
zone_name="$(aws route53 get-hosted-zone --id "$HOSTED_ZONE_ID" --query HostedZone.Name --output text)" \
  || die "hosted zone $HOSTED_ZONE_ID not found"
zone_name="${zone_name%.}"
[[ "$DOMAIN_NAME" == "$zone_name" || "$DOMAIN_NAME" == *".$zone_name" ]] \
  || die "$DOMAIN_NAME is not inside the hosted zone $zone_name"
echo "ok: $DOMAIN_NAME is in $zone_name"

if stack_exists hireright-github-deploy "$AWS_REGION"; then
  step "GitHub deploy role exists"
else
  step "GitHub deploy role (OpenID Connect, no stored keys) for $GITHUB_REPO"
  create_provider=true
  if aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text \
    | grep -q 'token.actions.githubusercontent.com'; then
    create_provider=false
  fi
  ENV_NAME_SAVED="$ENV_NAME"
  cfn_deploy hireright-github-deploy "$AWS_DIR/github-oidc.yaml" "$AWS_REGION" \
    "GitHubRepo=$GITHUB_REPO" "CreateOidcProvider=$create_provider"
  ENV_NAME="$ENV_NAME_SAVED"
fi
ROLE_ARN="$(stack_output hireright-github-deploy DeployRoleArn)"

deploy_edge
deploy_network
deploy_data

cat <<EOF

Bootstrap of $ENV_NAME done. Next:

 1. Secrets (stored only in AWS Secrets Manager; you are prompted, nothing is echoed):
      infra/aws/set-secret.sh $ENV_NAME GEMINI_API_KEY
      infra/aws/set-secret.sh $ENV_NAME SMTP_EMAIL            # if EMAIL_PROVIDER=smtp
      infra/aws/set-secret.sh $ENV_NAME SMTP_APP_PASSWORD     # if EMAIL_PROVIDER=smtp
      infra/aws/set-secret.sh $ENV_NAME ADMIN_EMAILS          # who may watch interview recordings

 2. GitHub ($GITHUB_REPO -> Settings):
      Variables -> Actions -> New repository variable:  AWS_DEPLOY_ROLE_ARN = $ROLE_ARN
      Environments -> create "staging" and "production" (add yourself as a required reviewer on production)

 3. Optional, before the first production deploy: copy existing data and files
      infra/aws/migrate-data.sh $ENV_NAME

 4. Push to dev1 (staging) or main (production); GitHub Actions builds, tests and deploys.
EOF
