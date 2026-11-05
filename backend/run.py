"""
HIRERIGHT Python API — always served by Uvicorn (ASGI).

Preferred:
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload

This module forwards to the same command for Docker and legacy callers.
"""

from __future__ import annotations

import os
import subprocess
import sys

from app.node_config import config


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = str(config.port)
    reload = os.environ.get("DEBUG", "").lower() in {"1", "true", "yes"}
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        host,
        "--port",
        port,
    ]
    if reload:
        cmd.append("--reload")
    raise SystemExit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
