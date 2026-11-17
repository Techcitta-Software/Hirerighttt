# HireRight TEST environment on the AWS Free Tier

A small but complete copy of HireRight for the testing period, using **only free-tier services**. It is not the
production design (that is `infra/aws/`: Aurora, autoscaling, WAF, multi-AZ, all billed).

```
  https://dxxxx.cloudfront.net  (CloudFront: HTTPS, always free up to 1 TB/month)
              |  secret header; the server only accepts CloudFront
              v
  EC2 micro (Amazon Linux 2023, Docker): nginx (site + /api proxy) -> API container (1 worker)
              |                                   |
  RDS PostgreSQL micro, 20 GB (private)     S3: files (resumes/recordings, kept 30 days), releases (kept 1 day)
  Secrets: SSM Parameter Store (free)      Spend alarm: AWS Budget, email at the first $0.01
```

## Will it cost anything?

| Service | Free allowance | This setup uses |
|---|---|---|
| EC2 | 750 h/month of a free-tier micro type | 1 instance (the script picks a type AWS reports as free-tier eligible, else it stops) |
| EBS | 30 GB | 20 GB |
| Public IPv4 | 750 h/month | 1 Elastic IP |
| RDS PostgreSQL | 750 h/month db.t3/t4g.micro, single-AZ, 20 GB, 20 GB backups | exactly that (storage autoscaling off) |
| S3 | 5 GB, 20k GET, 2k PUT | files expire after 30 days, releases after 1 day |
| CloudFront | 1 TB out + 10M requests (always free) | far below |
| SSM Parameter Store, SSM Run Command, IAM, CloudFormation, Budgets (2) | free | yes |
| NAT gateway, load balancer, Aurora, ElastiCache, WAF, Secrets Manager | **not free** | **not used** |

**Know which free tier your account has** (AWS changed it on 15 July 2025):
* **Account created on/after 15 July 2025, "Free plan"**: you get credits ($100-$200) and the account **cannot be
  charged**. Usage is deducted from the credits (this setup uses roughly $25-35/month of them), so the credits last
  several months. AWS emails you before they run out; nothing is billed unless you choose to upgrade.
* **Older account (classic 12-month free tier)**: free within the limits above *during the first 12 months*.
  Going over (for example running a second instance) is billed. The budget alarm emails you at the first cent.

Check: AWS console -> Billing and Cost Management -> Free Tier (shows your plan and remaining allowance).

Things that would leave the free tier, so avoid them: starting a second instance or database, changing the
instance/database size, turning on Multi-AZ, storing more than ~5 GB of recordings, leaving the Elastic IP attached
to a *stopped* instance for long. When testing is over, run `teardown.sh`.

The server reaches CloudFront over plain HTTP (with a secret header); viewers always get HTTPS. Use test data
only; real candidates belong on the production setup.

## Set up (about 25 minutes, mostly waiting for RDS)

Prerequisites: AWS CLI v2 signed in as an admin of the account (`aws sts get-caller-identity` works), Git Bash,
Python 3, Node 22.

```bash
# 1. your email for the spend alarm
#    edit infra/aws-free/config.env  ->  ALERT_EMAIL=you@techcitta.com

# 2. create everything (pass the ONE GitHub repo that should deploy, for automatic releases)
infra/aws-free/bootstrap.sh bharath-techcitta/HireRighttt-backend

# 3. secrets (hidden prompts)
infra/aws-free/set-param.sh GEMINI_API_KEY
infra/aws-free/set-param.sh SMTP_EMAIL
infra/aws-free/set-param.sh SMTP_APP_PASSWORD
infra/aws-free/set-param.sh ADMIN_EMAILS

# 4. first release (builds the site, ships it, builds the API on the server)
infra/aws-free/deploy.sh
```

Then confirm the AWS Budgets email, open the printed `https://dxxxx.cloudfront.net` and sign up.

### Automatic releases (CI/CD)

GitHub repo -> Settings -> Secrets and variables -> Actions -> **Variables**:
`AWS_DEPLOY_ROLE_ARN` (printed by bootstrap) and `AWS_TEST_DEPLOY` = `true`; Settings -> Environments -> create
`test`. Every push to `dev1` then runs the tests and releases (`.github/workflows/deploy-aws-test.yml`).
A release that fails its health check rolls back to the previous one automatically.

The paid production workflow (`deploy-aws.yml`) stays off unless you also set `AWS_FULL_DEPLOY=true`.

## Day to day

* **Shell on the server** (no SSH needed): `aws ssm start-session --target <instance-id>`
  (needs the Session Manager plugin), then `sudo docker compose -p hireright logs -f api`.
* **Change a secret**: `set-param.sh KEY`, then `deploy.sh` (or push).
* **Pause to save free hours**: stop the EC2 instance and RDS database in the console (RDS restarts itself after
  7 days). Note an Elastic IP on a stopped instance still counts against the public-IPv4 allowance.
* **Done testing**: `infra/aws-free/teardown.sh` removes everything (offers to delete the final DB snapshot).
