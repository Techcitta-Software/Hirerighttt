#!/usr/bin/env bash
# One-time move of existing data into AWS (run before switching real users over):
#   infra/aws/migrate-data.sh staging [old-s3-bucket]
#
#  * Postgres: pg_dump from the current database (e.g. Neon) -> pg_restore into Aurora. It runs as a one-off
#    container INSIDE the VPC (Aurora has no public endpoint). The source URL is read from a hidden prompt and kept
#    in Secrets Manager (hireright/<env>/migration-source); delete it afterwards (the script offers to).
#  * Files: copies resumes / recordings / reports from the old S3 bucket into the new one.
#
# Re-runnable: the restore uses --clean, so it replaces what is in Aurora with the source's current data.
# Stop writes to the old system first (or accept that later changes there are not copied).
source "$(dirname "$0")/lib.sh"

load_config "${1:-}"
OLD_BUCKET="${2:-}"
stack_exists "$STACK_PREFIX-app" || die "deploy the environment first (infra/aws/deploy.sh or GitHub Actions)"

SOURCE_SECRET="hireright/$ENV_NAME/migration-source"
if ! aws secretsmanager describe-secret --secret-id "$SOURCE_SECRET" >/dev/null 2>&1; then
  read -r -s -p "Source Postgres URL (e.g. the Neon DATABASE_URL): " SOURCE_URL
  echo
  [[ "$SOURCE_URL" == postgres* ]] || die "that does not look like a postgres:// URL"
  tmp="$(mktemp)"
  printf '%s' "$SOURCE_URL" > "$tmp"
  aws secretsmanager create-secret --name "$SOURCE_SECRET" --secret-string "file://$tmp" \
    --description "Temporary: source database for the one-time migration" --query ARN --output text >/dev/null
  rm -f "$tmp"
  unset SOURCE_URL
fi
SOURCE_ARN="$(aws secretsmanager describe-secret --secret-id "$SOURCE_SECRET" --query ARN --output text)"
DB_SECRET_ARN="$(stack_output "$STACK_PREFIX-data" DatabaseSecretArn)"
DB_HOST="$(stack_output "$STACK_PREFIX-data" DatabaseHost)"
APP_SG="$(stack_output "$STACK_PREFIX-data" AppSecurityGroupId)"
SUBNETS="$(aws cloudformation list-exports --query "Exports[?Name=='$STACK_PREFIX-PrivateSubnets'].Value" --output text)"
CLUSTER="$(stack_output "$STACK_PREFIX-app" ClusterName)"
SERVICE="$(stack_output "$STACK_PREFIX-app" ServiceName)"
LOG_GROUP="$(stack_output "$STACK_PREFIX-app" ApiLogGroup)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
EXEC_ROLE="arn:aws:iam::$ACCOUNT:role/hireright-$ENV_NAME-ecs-execution"

step "Register the one-off migration task (postgres:17 client)"
SCRIPT='set -u
TABLES="users profiles interview_results interview_sessions job_applications employer_applications jobs organizations"
for t in $TABLES; do echo "source $t: $(psql "$SOURCE_URL" -Atc "select count(*) from $t" 2>/dev/null)"; done
pg_dump --no-owner --no-privileges --format=custom --file=/tmp/db.dump "$SOURCE_URL" || exit 1
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$PGDATABASE" /tmp/db.dump
echo "pg_restore exit code $? (non-zero is normal when the source has provider-specific extensions)"
for t in $TABLES; do echo "target $t: $(psql -Atc "select count(*) from $t" 2>/dev/null)"; done
echo MIGRATION_DONE'
CONTAINER_JSON="$("$PY" - "$SCRIPT" "$DB_HOST" "$SOURCE_ARN" "$DB_SECRET_ARN" "$LOG_GROUP" "$AWS_REGION" <<'PYEOF'
import json, sys
script, host, source_arn, db_arn, log_group, region = sys.argv[1:]
print(json.dumps([{
    "name": "migrate",
    "image": "public.ecr.aws/docker/library/postgres:17",
    "essential": True,
    "command": ["sh", "-c", script],
    "environment": [
        {"name": "PGHOST", "value": host},
        {"name": "PGUSER", "value": "hireright"},
        {"name": "PGDATABASE", "value": "hireright"},
        {"name": "PGSSLMODE", "value": "require"},
    ],
    "secrets": [
        {"name": "SOURCE_URL", "valueFrom": source_arn},
        {"name": "PGPASSWORD", "valueFrom": db_arn + ":password::"},
    ],
    "logConfiguration": {"logDriver": "awslogs", "options": {
        "awslogs-group": log_group, "awslogs-region": region, "awslogs-stream-prefix": "migration"}},
}]))
PYEOF
)"
TASK_DEF="$(aws ecs register-task-definition --family "hireright-$ENV_NAME-data-migration" \
  --requires-compatibilities FARGATE --network-mode awsvpc --cpu 1024 --memory 4096 \
  --ephemeral-storage sizeInGiB=60 --execution-role-arn "$EXEC_ROLE" \
  --container-definitions "$CONTAINER_JSON" --query taskDefinition.taskDefinitionArn --output text)"

step "Run it inside the VPC (this can take a while for a large database)"
TASK_ARN="$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$TASK_DEF" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$APP_SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"
echo "task: $TASK_ARN"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN" || true
while [[ "$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].lastStatus' --output text)" != "STOPPED" ]]; do
  sleep 30
done
TASK_ID="${TASK_ARN##*/}"
step "Migration log"
aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "migration/migrate/$TASK_ID" \
  --query 'events[].message' --output text | tr '\t' '\n' | grep -v -i 'password' | tail -40
EXIT_CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)"
[[ "$EXIT_CODE" == "0" ]] || die "migration task exited with $EXIT_CODE (see the log above)"

step "Restart the API (applies any newer schema migrations to the restored data)"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --query service.serviceName --output text >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"

if [[ -n "$OLD_BUCKET" ]]; then
  NEW_BUCKET="$(stack_output "$STACK_PREFIX-data" FilesBucketName)"
  OLD_REGION="$(aws s3api get-bucket-location --bucket "$OLD_BUCKET" --query LocationConstraint --output text)"
  [[ "$OLD_REGION" == "None" ]] && OLD_REGION=us-east-1
  step "Copy files s3://$OLD_BUCKET ($OLD_REGION) -> s3://$NEW_BUCKET"
  aws s3 sync "s3://$OLD_BUCKET" "s3://$NEW_BUCKET" --source-region "$OLD_REGION" --region "$AWS_REGION" --only-show-errors
  echo "files copied"
fi

read -r -p "Delete the temporary source secret $SOURCE_SECRET now? [y/N] " answer
if [[ "$answer" == [yY]* ]]; then
  aws secretsmanager delete-secret --secret-id "$SOURCE_SECRET" --force-delete-without-recovery --query Name --output text >/dev/null
  echo "deleted"
fi
echo "Done. Compare the source/target row counts above, then try signing in on https://$DOMAIN_NAME"
