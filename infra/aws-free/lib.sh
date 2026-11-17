#!/usr/bin/env bash
# Shared helpers for the free-tier TEST environment scripts. Sourced, not run.
set -euo pipefail

FREE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034 # used by the scripts that source this file
REPO_ROOT="$(cd "$FREE_DIR/../.." && pwd)"
# shellcheck disable=SC2034 # used by the scripts that source this file
BASE_STACK=hireright-test-base
# shellcheck disable=SC2034
CDN_STACK=hireright-test-cdn
# shellcheck disable=SC2034
PARAM_ROOT=/hireright/test

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

PY="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
if [[ -n "$PY" ]] && ! "$PY" -c "import sys" >/dev/null 2>&1; then PY="$(command -v python 2>/dev/null || true)"; fi
[[ -n "$PY" ]] || die "Python 3 is required"

# load_config [require-email]: only bootstrap needs ALERT_EMAIL (for the budget alarm); releases do not.
load_config() {
  local file="$FREE_DIR/config.env"
  if [[ "${1:-}" == require-email ]] && grep -Eq '^ALERT_EMAIL=.*CHANGE_ME' "$file"; then
    die "fill in ALERT_EMAIL in $file first (it receives the \$1 budget alarm)"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
  export AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""
}

stack_exists() { aws cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1; }

stack_output() { # stack key
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

random_secret() { "$PY" -c "import secrets; print(secrets.token_urlsafe(${1:-48}))"; }

param_exists() { aws ssm get-parameter --name "$1" >/dev/null 2>&1; }

# put_param name value [String|SecureString]  (value passed via a temp file: never on the command line)
put_param() {
  local name="$1" value="$2" type="${3:-String}" tmp
  tmp="$(mktemp)"
  printf '%s' "$value" > "$tmp"
  aws ssm put-parameter --name "$name" --type "$type" --value "file://$tmp" --overwrite \
    --query Version --output text >/dev/null
  rm -f "$tmp"
}
