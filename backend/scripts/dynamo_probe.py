"""Quick DynamoDB connectivity check (uses repo-root .env). Run: python scripts/dynamo_probe.py"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.load_env import load_env
from app.db.dynamo.table_specs import physical_table_name

load_env()

import boto3
from botocore.exceptions import ClientError

from app.db.dynamo_config import dynamo_client_kwargs, dynamo_region


def main() -> int:
    client = boto3.client("dynamodb", **dynamo_client_kwargs())
    sts = boto3.client("sts", **dynamo_client_kwargs())
    ident = sts.get_caller_identity()
    print(f"IAM: {ident.get('Arn')}  region={dynamo_region()}")

    try:
        names = client.list_tables().get("TableNames", [])
        print(f"ListTables OK ({len(names)} tables):")
        for n in names:
            print(f"  - {n}")
    except ClientError as e:
        print(f"ListTables FAILED: {e.response['Error']['Code']} — {e.response['Error']['Message']}")
        names = []

    checks = list(dict.fromkeys(names + [
        physical_table_name("main"),
        physical_table_name("audit"),
        "content",
    ]))
    for table in checks:
        try:
            d = client.describe_table(TableName=table)
            t = d["Table"]
            keys = ", ".join(f"{k['AttributeName']}({k['KeyType']})" for k in t["KeySchema"])
            gsis = [g["IndexName"] for g in t.get("GlobalSecondaryIndexes", [])]
            print(f"DESCRIBE OK: {table} status={t['TableStatus']} keys={keys} gsis={gsis or 'none'}")
            if table == physical_table_name("main") or table in names:
                sample = client.scan(TableName=table, Limit=3)
                items = sample.get("Items", [])
                print(f"  sample items: {len(items)} (showing up to 3)")
                for it in items:
                    et = it.get("entity_type", {}).get("S", "?")
                    pk = it.get("pk", {}).get("S", "?")
                    sk = it.get("sk", {}).get("S", "?")
                    print(f"    entity_type={et} pk={pk} sk={sk}")
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code != "ResourceNotFoundException":
                print(f"DESCRIBE {table}: {code}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())