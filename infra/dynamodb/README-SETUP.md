# DynamoDB setup (connect + create tables)

Your app uses IAM user **`bharathgoud`** (`AWS_ACCESS_KEY_ID` in repo-root `.env`).  
Creating a table in the console **as root/admin** does **not** grant that user API access.

## 1. Fix IAM (required once)

1. [IAM Users → bharathgoud](https://us-east-1.console.aws.amazon.com/iam/home#/users/details/bharathgoud?section=permissions)
2. **Permissions** tab → **Add permissions** → **Create inline policy**
3. **JSON** → paste `iam-hireright-dynamodb-policy.json` → **Next** → name e.g. `HireRightDynamo` → **Create policy**
4. Confirm **`bharathgoud`** shows that policy under **Permissions**

**Faster (dev only):** attach AWS managed policy **`AmazonDynamoDBFullAccess`** to **`bharathgoud`**.

Wait ~30 seconds, then:

```bash
npm run db:dynamo:probe
```

You should see `ListTables OK`.

## 2. Create tables from this repo (CLI)

Tables created automatically (not in console):

| Table | Keys |
|-------|------|
| `hirerighttt-dev-main` | `pk` + `sk` (+ Gsi1–Gsi4) |
| `hirerighttt-dev-audit` | `pk` + `sk` (+ Gsi1) |

```bash
npm run db:dynamo:init
npm run db:dynamo:seed
```

Or on Windows: `.\scripts\setup-dynamo.ps1`

Optional copy from Neon: `npm run db:dynamo:migrate`

## 3. Region

Tables must be in **`us-east-1`** (same as `AWS_REGION` in `.env`) unless you change region everywhere.