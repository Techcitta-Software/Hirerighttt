# HireRight on AWS (ap-south-1, Mumbai)

```
            https://DOMAIN                      (Route 53 -> CloudFront + WAF, HTTPS)
                  |
        +---------+----------------------------+
        | /*  React site                       | /api/*
        v                                      v
   S3 (private, via CloudFront)     Load balancer (only CloudFront can reach it: prefix list + secret header)
                                               |
                                    ECS Fargate: API containers (autoscaling 1-2 staging, 2-10 production)
                                      |              |               |
                         Aurora PostgreSQL     Valkey (rate      S3 files bucket
                         Serverless v2         limits)           (resumes, recordings)
                                      \ all in private subnets; outbound via NAT (Gemini, email) /
```

| Piece | Why |
|---|---|
| CloudFront + WAF | HTTPS, fast in India, blocks bots and brute force on sign-in |
| ECS Fargate | the API (Docker image from `backend/`), several workers per container, rolling deploys with automatic rollback |
| Aurora PostgreSQL Serverless v2 | the database; grows and shrinks capacity with load; daily backups |
| ElastiCache Valkey | shared rate limits across all API containers |
| S3 | resumes / recordings / reports (private, encrypted, versioned) and the React site |
| Secrets Manager | DB password, session secret, Gemini keys: never in git or GitHub |
| CloudWatch + SNS | logs, alarms by email (5xx errors, unhealthy containers, slow API, database near max) |
| GitHub OIDC role | GitHub Actions deploys with short-lived credentials, no stored AWS keys |

Rough monthly cost: **staging $130-170**, **production $350-500** at launch (grows with traffic: mainly Aurora capacity
and the number of API containers). Gemini usage is billed by Google separately.

## Files

| File | What |
|---|---|
| `config/staging.env`, `config/production.env` | domain, hosted zone, alert email, sizes (not secret) |
| `network.yaml`, `data.yaml`, `edge.yaml`, `app.yaml`, `github-oidc.yaml` | CloudFormation stacks |
| `bootstrap.sh` | one-time setup per environment (run by an admin) |
| `deploy.sh` | a release: run by GitHub Actions (`.github/workflows/deploy-aws.yml`) |
| `set-secret.sh` | set Gemini key / email password etc. (hidden prompt) |
| `migrate-data.sh` | one-time copy of the current Postgres (Neon) data and S3 files into AWS |

## First-time setup (about 1 hour, mostly waiting)

**0. Prerequisites**
* AWS CLI v2 signed in as an administrator of the AWS account (`aws configure` or `aws sso login`).
  Check: `aws sts get-caller-identity`.
* The domain's DNS in **Route 53**: Route 53 -> Hosted zones -> Create hosted zone for your domain, then at your
  domain registrar replace the name servers with the four Route 53 ones. Note the hosted zone id (`Z0...`).
* Git Bash (Windows) or any bash shell, and Python 3.

**1. Fill in the settings**: `config/staging.env` and `config/production.env` (`DOMAIN_NAME`, `HOSTED_ZONE_ID`,
`ALERT_EMAIL`). Commit them.

**2. Bootstrap** (creates the certificate, firewall, network, Aurora, Valkey, S3, ECR, secrets):
```bash
infra/aws/bootstrap.sh staging bharath-techcitta/HireRighttt-backend     # the ONE repo that deploys
```
Aurora + certificate validation take 10-20 minutes. Confirm the "AWS Notification" email for alarms when it arrives.

**3. Secrets** (prompted, hidden):
```bash
infra/aws/set-secret.sh staging GEMINI_API_KEY
infra/aws/set-secret.sh staging SMTP_EMAIL          # Gmail/SMTP sender (or use EMAIL_PROVIDER=ses)
infra/aws/set-secret.sh staging SMTP_APP_PASSWORD
infra/aws/set-secret.sh staging ADMIN_EMAILS        # comma-separated platform admins
```

**4. GitHub** (in the repo you named in step 2) -> Settings:
* Secrets and variables -> Actions -> **Variables** -> `AWS_DEPLOY_ROLE_ARN` = the ARN bootstrap printed.
* Environments -> create `staging` and `production`; on `production` add yourself under *Required reviewers*.

**5. Deploy**: push to `dev1`. GitHub Actions runs the tests, builds the image, deploys, uploads the site and
smoke-tests `https://DOMAIN/api/health`. (Actions tab -> "Deploy to AWS".)

**6. Data** (before real users move over):
```bash
infra/aws/migrate-data.sh staging hirerighttt-tests    # Neon -> Aurora, old bucket -> new bucket
```
It prints row counts for the source and the target; check they match.

Repeat 2-6 with `production` (deployed from `main`, after your approval in GitHub).

## Day to day

* **Release**: merge to `dev1` (staging) or `main` (production). A release that fails its health checks rolls back
  by itself; nothing to do.
* **Roll back on purpose**: Actions -> Deploy to AWS -> re-run the job of an earlier commit (images are kept).
* **Logs**: CloudWatch -> Log groups -> `/hireright/<env>/api` (one JSON line per request with `request_id`).
* **Shell into a container**: `aws ecs execute-command --cluster hireright-<env> --task <task-id> --container api --interactive --command sh`
* **Change a secret**: `set-secret.sh` (restarts the API, no downtime).
* **Scale**: edit `config/<env>.env` (`MAX_TASKS`, `AURORA_MAX_ACU`, ...) and push.
* **Scheduled jobs** (interview reminders, daily maintenance) stay in GitHub Actions: set the repository secrets
  `API_BASE_URL=https://DOMAIN` and `CRON_SECRET` = the value of the `hireright/<env>/cron` secret.
* **Backups**: Aurora keeps daily snapshots (7 days staging, 14 production) and point-in-time restore.

## Before production traffic

* SES (if `EMAIL_PROVIDER=ses`): verify the domain in SES and request production access (the sandbox only sends
  to verified addresses).
* CloudFront waits at most 60 s for the API. If AI scoring ever takes longer, request a higher
  "origin response timeout" quota and raise `OriginReadTimeout` in `app.yaml`.
* Load-test staging (the k6/aiohttp scripts used locally work against `https://staging.DOMAIN`).
* After cut-over, turn off the old Render/Vercel deploys (`.github/workflows/deploy-render.yml`,
  `deploy-vercel.yml`) and delete the old access keys.
