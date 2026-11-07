from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.server.json_safe import json_safe


def test_database_types_become_plain_json():
    payload = {
        "appliedAt": datetime(2026, 11, 7, 10, 30, tzinfo=timezone.utc),
        "day": date(2026, 11, 7),
        "id": uuid4(),
        "score": Decimal("92.50"),
        "count": Decimal("3"),
        "tags": {"a"},
        "nested": [{"when": datetime(2026, 1, 1)}],
    }
    out = json.loads(json.dumps(json_safe(payload)))
    assert out["appliedAt"].startswith("2026-11-07T10:30")
    assert out["score"] == 92.5 and out["count"] == 3
    assert out["nested"][0]["when"].startswith("2026-01-01")


def test_plain_values_are_unchanged():
    assert json_safe({"a": 1, "b": [None, True, "x"]}) == {"a": 1, "b": [None, True, "x"]}
