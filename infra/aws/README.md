# HireRighttt on AWS (free tier)

```
 Browser ──HTTPS──► CloudFront (free tier: 1 TB / 10M requests a month)
                      ├── /*      → S3 bucket (the built website, private)
                      └── /api/*  → EC2 t3.micro (Docker: the FastAPI API, port 80, only CloudFront can reach it)
                                      ├── Database: Neon (DATABASE_URL)  — or free-tier RDS PostgreSQL (CREATE_DATABASE=true)
                                      ├── Files: S3 bucket hirerighttt-tests (resumes, videos, reports) via the instance role
                                      └── Settings/secrets: SSM Parameter Store /hirerighttt/prod/*
 Budget alarm: email at 50% of $1 actual or 100% forecast.
```

Files: `template.yaml` (everything AWS), `deploy.sh` (create/update + ship code), `set-secrets.sh`, `remote-deploy.sh`
(runs on the server), `teardown.sh`, `config.env` (non-secret settings).

## What it costs

| Service | Free allowance | This setup uses |
|---|---|---|
| EC2 t3.micro | 750 h/month | 1 instance, 24×7 (≈730 h) |
| EBS gp3 | 30 GB | 20 GB |
| Public IPv4 (Elastic IP) | 750 h/month in the free tier | 1 address |
| CloudFront | 1 TB out + 10M requests / month (always free) | site + API |
| S3 | 5 GB (12 months) | website + releases + resumes |
| SSM Parameter Store (standard) | always free | settings + secrets |
| AWS Budgets | 2 budgets free | 1 |
| RDS db.t4g.micro (optional) | 750 h + 20 GB (12 months) | only if `CREATE_DATABASE=true` |

Not used (these cost money): load balancer, NAT gateway, Secrets Manager, SES, Aurora, ElastiCache, ECS/EKS.

Which free tier you have matters:
* **Account created before 15 July 2025** – 12-month free tier: the table above is $0 for 12 months.
* **Account created on/after 15 July 2025** – "Free plan": you get credits ($100–$200) for 6 months; nothing is charged,
  usage is taken from the credits. Upgrade only when you choose to.
Check: Billing console → Free tier / Credits.

Rules to stay at $0: run **one** instance, don't add a second Elastic IP, delete the stack (`teardown.sh`) if you stop
using it, and watch the budget email.

## One-time setup

1. **Deploy login (admin user).** `bharathgoud` can only use S3, so create a deploy user:
   IAM → Users → Create user `hirerighttt-deployer` → Attach policy **AdministratorAccess** → Create.
   Then Security credentials → Create access key → "Command Line Interface (CLI)" → copy both keys.
   On your PC: `aws configure --profile hirerighttt-admin` (paste the keys, region `ap-south-1`, output `json`).
   Keep these keys only on your PC — the server never needs them.
2. **Settings:** edit `infra/aws/config.env` → set `BUDGET_EMAIL`. Keep `CREATE_DATABASE=false` to keep Neon
   (no data move). Use `true` for a free-tier RDS (then move the data, see below).
3. **Secrets:** `bash infra/aws/set-secrets.sh` (Gemini key, DATABASE_URL, SMTP…). Typed hidden, stored in SSM.

## Deploy (first time and every update)

```bash
bash infra/aws/deploy.sh
```
First run ~10–20 min (CloudFront creation). Updates ~5 min. At the end it prints the site URL
(`https://xxxx.cloudfront.net`) and checks `/api/health/live`. Confirm the budget email AWS sends you.

## After the first deploy

* Open the printed URL, sign up / log in, upload a resume, run an interview.
* The API uses the instance role for S3 — no AWS keys in the app. Remove `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` from anything server-side.
* Scheduled jobs run on the instance: interview reminders every 15 min, maintenance daily 03:00 UTC.
* Point people at the CloudFront URL. When you're happy, switch off Vercel + Render (or keep them as backup).
* Logs: EC2 → instance → Connect → Session Manager → `sudo docker logs --tail 100 api`.

## Moving the database to RDS (only if CREATE_DATABASE=true)

1. `bash infra/aws/deploy.sh` once (creates RDS and stores DB_HOST etc.).
2. From an SSM session on the instance (RDS is private):
   `sudo dnf install -y postgresql16` →
   `pg_dump "<NEON_URL>" -Fc -f /tmp/db.dump` →
   `pg_restore --no-owner -d "postgresql://hireright:<DB_PASSWORD>@<DB_HOST>:5432/hireright?sslmode=require" /tmp/db.dump`
   (DB_PASSWORD: SSM → `/hirerighttt/prod/DB_PASSWORD`).
3. Delete `/hirerighttt/prod/DATABASE_URL` in SSM so the app uses RDS, then `bash infra/aws/deploy.sh`.

## Limits to know

* CloudFront waits at most 60 s for the API. Interview question generation is designed to finish within ~45 s.
* 1 GB RAM: the API runs one worker; fine for testing and early users. Bigger traffic → `t3.small` (not free).
* A custom domain needs a certificate in us-east-1 (ACM, free) and a CloudFront alias — ask when you have one.

## Remove everything

```bash
bash infra/aws/teardown.sh
```
