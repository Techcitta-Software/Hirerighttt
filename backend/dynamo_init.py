"""Create, verify, seed, or migrate HireRight DynamoDB tables (Neon is untouched).

  python dynamo_init.py              # create tables if missing + enable PITR/TTL
  python dynamo_init.py --verify     # check tables exist
  python dynamo_init.py --seed       # platform plans/org (idempotent)
  python dynamo_init.py --migrate    # copy rows from DATABASE_URL (Neon) -> DynamoDB
  python dynamo_init.py --migrate --dry-run
"""

from __future__ import annotations

import sys

from app.load_env import load_env


def main() -> None:
    load_env()
    from app.db.dynamo.create_tables import main as tables_main
    from app.db.dynamo.migrate_from_neon import main as migrate_main

    if "--migrate" in sys.argv:
        migrate_argv = [a for a in sys.argv[1:] if a != "--migrate"]
        raise SystemExit(migrate_main(migrate_argv))

    raise SystemExit(tables_main(sys.argv[1:]))


if __name__ == "__main__":
    main()