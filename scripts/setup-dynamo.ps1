# After IAM policy is on user bharathgoud, run from repo root:
#   .\scripts\setup-dynamo.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "Step 1: Probe AWS DynamoDB..."
npm run db:dynamo:probe
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "If you see AccessDenied, attach DynamoDB permissions to IAM user bharathgoud:"
    Write-Host "  IAM -> Users -> bharathgoud -> Add permissions -> Create inline policy -> JSON"
    Write-Host "  Paste: infra/dynamodb/iam-hireright-dynamodb-policy.json"
    Write-Host "  Or attach managed policy: AmazonDynamoDBFullAccess (dev only)"
    exit 1
}

Write-Host "Step 2: Create tables hirerighttt-dev-main + hirerighttt-dev-audit..."
npm run db:dynamo:init
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Step 3: Seed platform catalog..."
npm run db:dynamo:seed
Write-Host "Done."