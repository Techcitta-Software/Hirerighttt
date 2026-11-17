#!/usr/bin/env bash
# Remove the whole test environment so nothing can bill after the testing period:
#   infra/aws-free/teardown.sh
# Deletes CloudFront, the server, its Elastic IP, both buckets (after emptying them), the SSM parameters and the
# budget. The database leaves a final snapshot (your data); the script offers to delete it as well.
source "$(dirname "$0")/lib.sh"

load_config
read -r -p "Delete the HireRighttt TEST environment in $AWS_REGION (site, server, database, files)? Type 'delete': " answer
[[ "$answer" == delete ]] || die "cancelled"

if stack_exists "$BASE_STACK"; then
  for key in FilesBucket ReleasesBucket; do
    bucket="$(stack_output "$BASE_STACK" "$key")"
    step "Empty s3://$bucket"
    aws s3 rm "s3://$bucket" --recursive --only-show-errors || true
  done
fi

if stack_exists "$CDN_STACK"; then
  step "Delete CloudFront ($CDN_STACK; disabling takes about 15 minutes)"
  aws cloudformation delete-stack --stack-name "$CDN_STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$CDN_STACK"
fi
if stack_exists "$BASE_STACK"; then
  step "Delete the server, database and buckets ($BASE_STACK; about 10 minutes)"
  aws cloudformation delete-stack --stack-name "$BASE_STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$BASE_STACK"
fi

step "Delete the SSM parameters"
names="$(aws ssm get-parameters-by-path --path "$PARAM_ROOT" --recursive --query 'Parameters[].Name' --output text)"
for name in $names; do aws ssm delete-parameter --name "$name"; done

snapshots="$(aws rds describe-db-snapshots --db-instance-identifier hireright-test --snapshot-type manual \
  --query 'DBSnapshots[].DBSnapshotIdentifier' --output text 2>/dev/null || true)"
if [[ -n "$snapshots" && "$snapshots" != "None" ]]; then
  echo
  echo "Final database snapshot(s) kept: $snapshots"
  echo "(free while within the 20 GB free backup storage; billed after the free tier ends)"
  read -r -p "Delete them too? [y/N] " del
  if [[ "$del" == [yY]* ]]; then
    for s in $snapshots; do aws rds delete-db-snapshot --db-snapshot-identifier "$s" --query DBSnapshot.Status --output text; done
  fi
fi
echo
echo "Test environment removed. (The GitHub deploy role, if created, is free and was left in place.)"
