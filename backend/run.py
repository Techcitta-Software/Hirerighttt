"""
HIRERIGHT Python API
Run:  python -m uvicorn app.main:app --reload --port 8787
  or: python run.py
"""

from __future__ import annotations

import os

import uvicorn

from app.node_config import config


def main() -> None:
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=config.port,
        reload=os.environ.get("DEBUG", "").lower() in {"1", "true", "yes"},
    )


if __name__ == "__main__":
    main()
