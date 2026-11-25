#!/usr/bin/env bash
# Delete everything deploy.sh created (EC2, Elastic IP, CloudFront, site + release buckets, budget[, RDS]).
# The resume bucket and the SSM secrets are kept. An RDS database leaves a final snapshot (delete it in the console
# if you don't need it — snapshots beyond the free 20 GB are billed).
#   bash infra/aws/teardown.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/config.env"
export AWS_PROFILE AWS_REGION AWS_PAGER=""

read -rp "Delete stack $STACK in $AWS_REGION? Type the stack name to confirm: " answer
[ "$answer" = "$STACK" ] || { echo "Cancelled."; exit 1; }

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null || true; }
for bucket in "$(out SiteBucket)" "$(out ReleaseBucket)"; do
  [ -n "$bucket" ] && [ "$bucket" != "None" ] && aws s3 rm "s3://$bucket" --recursive --only-show-errors || true
done
aws cloudformation delete-stack --stack-name "$STACK"
echo "Deleting (CloudFront takes ~15 min)…"
aws cloudformation wait stack-delete-complete --stack-name "$STACK"
echo "Deleted. SSM parameters under /hirerighttt/$ENV were kept (free)."
