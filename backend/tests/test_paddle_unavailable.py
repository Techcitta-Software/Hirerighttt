"""A missing PaddleOCR install prints JSON and exits 2, instead of a traceback."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "paddle_resume_parser.py"


def test_paddle_script_missing_dep_prints_json_error(tmp_path):
    if importlib.util.find_spec("paddleocr") is not None:
        pytest.skip("paddleocr is installed")
    target = tmp_path / "x.pdf"
    target.write_bytes(b"%PDF-1.4\n")
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), str(target)],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=str(ROOT),
    )
    assert proc.returncode == 2
    assert json.loads(proc.stdout.strip()) == {"error": "ocr_unavailable"}
    assert "Traceback" not in proc.stderr
