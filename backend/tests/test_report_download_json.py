"""GET /api/interview/artifacts/{id}/report/download?format=json returns the scored report."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from fastapi.responses import JSONResponse

from app.dispatch.route_extensions import try_extended_routes
from app.server import runtime


def test_report_download_format_json_returns_the_report_payload(monkeypatch):
    report = {
        "overall": 81,
        "role": "Backend Developer",
        "categories": [{"label": "Communication", "score": 70}],
    }

    async def email(_request):
        return "ada@example.com"

    monkeypatch.setattr(runtime, "require_auth_email", email)
    request = SimpleNamespace(
        method="GET",
        url=SimpleNamespace(path="/api/interview/artifacts/sess-9/report/download"),
        query_params={"format": "json"},
        headers={"authorization": "Bearer t", "accept": ""},
    )
    ctx = SimpleNamespace(
        load_db=lambda: {
            "interviewSessions": {"sess-9": {"email": "ada@example.com", "result": report}},
        }
    )

    def json_fn(status, body, **_kwargs):
        return JSONResponse(body, status_code=status)

    res = asyncio.run(try_extended_routes(request, ctx, None, json_fn, lambda *_a, **_k: None))
    assert res is not None and res.status_code == 200
    assert json.loads(res.body) == report
