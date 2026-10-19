# Back up Neon PostgreSQL to Amazon S3

HireRight’s live data is in **Neon** (`DATABASE_URL` in repo-root `.env`). S3 is for **backups / archives** — the app does not read from S3 at runtime.

## What you need

| Item | Purpose |
|------|---------|
| **Neon `DATABASE_URL`** | Already in `.env` (direct or pooler URI with `sslmode=require`) |
| **AWS account** | [aws.amazon.com](https://aws.amazon.com) |
| **S3 bucket** | e.g. `hireright-db-backups` in a region you choose (`ap-south-1`, `us-east-1`, …) |
| **IAM user** (recommended) | Programmatic access with **only** `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on that bucket |
| **AWS credentials** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| **`pg_dump`** | PostgreSQL client tool (see below) |

Optional env vars (for the script):

```env
S3_BACKUP_BUCKET=hireright-db-backups
S3_BACKUP_PREFIX=neon/hireright/
```

**Do not commit** AWS keys or `DATABASE_URL` to GitHub. Keep them in `.env` only (already gitignored).

---

## 1. Create S3 bucket (AWS Console)

1. **S3 → Create bucket** → name e.g. `hireright-db-backups`.
2. Block public access: **On** (default).
3. Versioning: **Enable** (optional but good for backups).
4. Note **Region** → use as `AWS_REGION`.

---

## 2. IAM policy (minimal)

Create a user `hireright-backup-uploader` with this policy (replace bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::hireright-db-backups",
        "arn:aws:s3:::hireright-db-backups/*"
      ]
    }
  ]
}
```

Create **Access key** → put in `.env`:

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-south-1
S3_BACKUP_BUCKET=hireright-db-backups
S3_BACKUP_PREFIX=neon/hireright/
```

---

## 3. Install `pg_dump` (Windows)

Neon is standard PostgreSQL. You need client tools:

- Install [PostgreSQL for Windows](https://www.postgresql.org/download/windows/) (include **Command Line Tools**), **or**
- `winget install PostgreSQL.PostgreSQL` and add `bin` to PATH.

Check:

```powershell
pg_dump --version
```

---

## 4. Run a backup (manual)

From **repo root** (loads `.env`):

```powershell
npm run db:backup:s3
```

This creates a timestamped `.sql.gz` in S3 under `S3_BACKUP_PREFIX`.

Manual one-liner (if you prefer):

```powershell
$ts = Get-Date -Format "yyyy-MM-ddTHHmmss"
pg_dump $env:DATABASE_URL --no-owner --no-acl | gzip > "backup-$ts.sql.gz"
aws s3 cp "backup-$ts.sql.gz" "s3://hireright-db-backups/neon/hireright/backup-$ts.sql.gz"
```

Requires [AWS CLI v2](https://aws.amazon.com/cli/) configured with the same IAM user.

---

## 5. Restore (if needed)

Download from S3, then:

```powershell
gunzip -c backup-2026-10-19.sql.gz | psql $env:DATABASE_URL
```

Use a **fresh Neon branch** or empty database for restore tests — never overwrite production without a plan.

---

## Neon built-in options (alternative)

Neon Console also offers **branching** and **PITR** on paid plans. S3 backups are still useful for:

- Long-term retention you control
- Compliance / off-platform copy
- Restore outside Neon

---

## Schedule (optional)

- **Windows Task Scheduler** → daily `npm run db:backup:s3`
- **GitHub Actions** (secrets: `DATABASE_URL`, AWS keys) on cron
- **AWS Lambda + EventBridge** if you move to fully automated cloud backups

---

## Security checklist

- [ ] Bucket is **private**
- [ ] IAM user is **least privilege** (S3 only)
- [ ] Backups are **encrypted** (S3 SSE-S3 or SSE-KMS default is fine)
- [ ] Rotate access keys periodically
- [ ] Never commit `.env` or dump files to git
