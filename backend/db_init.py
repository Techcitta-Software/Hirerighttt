"""Apply and verify Neon/Postgres schema. Run: python db_init.py [--verify]"""

from __future__ import annotations

import sys

import psycopg

from app.db.apply_schema import EXPECTED_TABLES, apply_schema
from app.load_env import load_env
from app.node_config import config


def main() -> None:
    load_env()
    url = (config.database_url or "").strip()
    if not url:
        print("DATABASE_URL is required in repo-root .env", file=sys.stderr)
        sys.exit(1)
    verify_only = "--verify" in sys.argv
    with psycopg.connect(url) as conn:
        if verify_only:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(%s)",
                    (EXPECTED_TABLES,),
                )
                found = {r[0] for r in cur.fetchall()}
            missing = [t for t in EXPECTED_TABLES if t not in found]
            if missing:
                print("Missing tables:", ", ".join(missing), file=sys.stderr)
                sys.exit(1)
            print(f"OK — {len(found)} expected tables present.")
            return
        apply_schema(conn)
        conn.commit()
    print("Schema applied successfully.")


if __name__ == "__main__":
    main()
