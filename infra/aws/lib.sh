#!/usr/bin/env bash
# Shared helpers for the HireRight AWS scripts. Sourced, not run.
set -euo pipefail

AWS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034 # used by the scripts that source this file
REPO_ROOT="$(cd "$AWS_DIR/../.." && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }
# python3 on Linux/macOS/CI, python on Windows (Git Bash)
PY="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
if [[ -n "$PY" ]] && ! "$PY" -c "import sys" >/dev/null 2>&1; then PY="$(command -v python 2>/dev/null || true)"; fi
step() { echo; echo "==> $*"; }

# load_config staging|production  -> exports the settings in config/<env>.env
load_config() {
  ENV_NAME="${1:-}"
  [[ "$ENV_NAME" == "staging" || "$ENV_NAME" == "production" ]] || die "environment must be staging or production"
  local file="$AWS_DIR/config/$ENV_NAME.env"
  [[ -f "$file" ]] || die "missing $file"
  if grep -Eq '^[A-Z_]+=.*CHANGE_ME' "$file"; then
    die "fill in $file first (DOMAIN_NAME, HOSTED_ZONE_ID, ALERT_EMAIL still say CHANGE_ME)"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
  export AWS_DEFAULT_REGION="$AWS_REGION"
  export AWS_PAGER=""
  STACK_PREFIX="hireright-$ENV_NAME"
}

stack_exists() { # stack [region]
  aws cloudformation describe-stacks --stack-name "$1" --region "${2:-$AWS_REGION}" >/dev/null 2>&1
}

stack_output() { # stack key [region]
  aws cloudformation describe-stacks --stack-name "$1" --region "${3:-$AWS_REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

stack_param() { # stack key [region]
  aws cloudformation describe-stacks --stack-name "$1" --region "${3:-$AWS_REGION}" \
    --query "Stacks[0].Parameters[?ParameterKey=='$2'].ParameterValue" --output text
}

cfn_deploy() { # stack template region param=value...
  local stack="$1" template="$2" region="$3"
  shift 3
  aws cloudformation deploy \
    --stack-name "$stack" \
    --template-file "$template" \
    --region "$region" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --tags Project=hireright "Environment=$ENV_NAME" \
    --parameter-overrides "$@"
}

# Aurora version: keep the running cluster's version; for a new cluster use the newest 16.x in the region.
aurora_engine_version() {
  local stack="$STACK_PREFIX-data"
  if stack_exists "$stack"; then
    stack_param "$stack" AuroraEngineVersion
    return
  fi
  aws rds describe-db-engine-versions --engine aurora-postgresql --region "$AWS_REGION" \
    --query "DBEngineVersions[?starts_with(EngineVersion, '16.')].EngineVersion" --output text \
    | tr '\t' '\n' | sort -V | tail -1
}

deploy_network() {
  step "Network ($STACK_PREFIX-network)"
  cfn_deploy "$STACK_PREFIX-network" "$AWS_DIR/network.yaml" "$AWS_REGION" \
    "EnvironmentName=$ENV_NAME" "NatGateways=$NAT_GATEWAYS"
}

deploy_data() {
  local version
  version="$(aurora_engine_version)"
  [[ -n "$version" && "$version" != "None" ]] || die "no aurora-postgresql 16.x version found in $AWS_REGION"
  step "Data ($STACK_PREFIX-data): Aurora PostgreSQL $version, Valkey, S3, ECR, secrets"
  cfn_deploy "$STACK_PREFIX-data" "$AWS_DIR/data.yaml" "$AWS_REGION" \
    "EnvironmentName=$ENV_NAME" "DomainName=$DOMAIN_NAME" "AuroraEngineVersion=$version" \
    "AuroraMinCapacity=$AURORA_MIN_ACU" "AuroraMaxCapacity=$AURORA_MAX_ACU" "AuroraReader=$AURORA_READER" \
    "BackupRetentionDays=$BACKUP_RETENTION_DAYS"
}

deploy_edge() {
  step "Edge ($STACK_PREFIX-edge, us-east-1): HTTPS certificate + firewall (certificate validation takes a few minutes)"
  cfn_deploy "$STACK_PREFIX-edge" "$AWS_DIR/edge.yaml" us-east-1 \
    "EnvironmentName=$ENV_NAME" "DomainName=$DOMAIN_NAME" "HostedZoneId=$HOSTED_ZONE_ID"
}

# A secret-free check that the API's required secrets were filled in.
require_app_secrets() {
  local secret_json
  secret_json="$(aws secretsmanager get-secret-value --secret-id "hireright/$ENV_NAME/app" \
    --query SecretString --output text)"
  if ! printf '%s' "$secret_json" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
keys = [k for k in ("GEMINI_API_KEY",) if d.get(k) in (None, "", "REPLACE_ME")]
sys.exit(1 if keys else 0)
' 2>/dev/null; then
    die "GEMINI_API_KEY is not set for $ENV_NAME. Run: infra/aws/set-secret.sh $ENV_NAME GEMINI_API_KEY"
  fi
}
