"""A vendor's shortlist or rejection shows on the candidate's own application, with a timeline.

These tests stay in memory. They do not need Postgres.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from fastapi.responses import JSONResponse

from app.dispatch import api_dispatch, route_extensions
from app.dispatch.api_dispatch import handle_api_dispatch
from app.server import runtime
from app.services.vendor.candidate_applications import (
    application_timeline,
    build_candidate_job_application_record,
    map_employer_status_to_candidate_status,
)

APPLIED_AT = "2026-11-01T00:00:00Z"
JOB = {
    "id": "job-1",
    "organizationId": "org-1",
    "title": "Backend Engineer",
    "company": "Acme",
    "location": "Bengaluru",
    "status": "published",
}


def _steps(employer_status: str) -> dict[str, dict]:
    return {step["key"]: step for step in application_timeline(employer_status, APPLIED_AT)}


def test_shortlisted_maps_to_selected_and_timeline_current_is_selected() -> None:
    assert map_employer_status_to_candidate_status("shortlisted") == "Selected"
    steps = _steps("shortlisted")
    assert steps["applied"] == {"key": "applied", "label": "Applied", "done": True, "current": False}
    assert steps["review"]["done"] is True and steps["review"]["current"] is False
    assert steps["review"]["label"] == "In review"
    assert steps["selected"] == {"key": "selected", "label": "Selected", "done": True, "current": True}
    assert steps["closed"]["done"] is False and steps["closed"]["current"] is False
    assert sum(1 for step in steps.values() if step["current"]) == 1

    record = build_candidate_job_application_record(
        JOB,
        {"id": "app-1", "status": "shortlisted", "appliedAt": APPLIED_AT, "data": {}},
    )
    assert record["status"] == "Selected"
    assert record["employerStatus"] == "shortlisted"
    assert record["timeline"][2]["key"] == "selected" and record["timeline"][2]["current"] is True


def test_rejected_maps_to_not_selected() -> None:
    assert map_employer_status_to_candidate_status("rejected") == "Not selected"
    steps = _steps("rejected")
    assert steps["applied"]["done"] is True and steps["review"]["done"] is True
    assert steps["selected"]["done"] is False
    assert steps["closed"] == {"key": "closed", "label": "Not selected", "done": True, "current": True}
    assert sum(1 for step in steps.values() if step["current"]) == 1
    record = build_candidate_job_application_record(
        JOB,
        {"id": "app-1", "status": "rejected", "appliedAt": APPLIED_AT, "data": {}},
    )
    assert record["status"] == "Not selected"
    assert record["employerStatus"] == "rejected"


def test_applied_and_in_review_keep_a_single_current_step() -> None:
    assert map_employer_status_to_candidate_status("applied") == "Applied"
    assert map_employer_status_to_candidate_status("interviewed") == "In Review"
    applied = _steps("applied")
    assert applied["applied"]["current"] is True
    assert applied["review"]["done"] is False and applied["selected"]["done"] is False
    review = _steps("interviewed")
    assert review["review"]["done"] is True and review["review"]["current"] is True
    assert review["selected"]["done"] is False and review["closed"]["done"] is False


def _world(email: str | None = "ada@example.com") -> dict:
    app: dict = {
        "id": "app-1",
        "organizationId": "org-1",
        "jobId": "job-1",
        "status": "applied",
        "appliedAt": APPLIED_AT,
        "data": {},
    }
    if email is not None:
        app["candidateEmail"] = email
    return {
        "jobs": [dict(JOB)],
        "employerApplications": [app],
        "applications": {},
    }


def _patch(db: dict, status: str, monkeypatch, *, persistence: bool = False, upserts: list | None = None):
    async def fake_employer(_request, _db):
        return {
            "user": {"id": "u-vend", "email": "vendor@example.com", "role": "employer"},
            "tenant": {"organization": {"id": "org-1"}, "membership": {"role": "admin"}},
        }

    async def fake_body(_request):
        return {"status": status}

    async def save_db(_db):
        return None

    monkeypatch.setattr(runtime, "require_employer_tenant", fake_employer)
    monkeypatch.setattr(runtime, "read_json_body", fake_body)
    monkeypatch.setattr(route_extensions, "persistence_ready", lambda _url: persistence)
    if upserts is not None:
        def fake_upsert(_url, email, record):
            upserts.append((email, record))

        monkeypatch.setattr(route_extensions.db_store, "upsert_job_application_record", fake_upsert)

    request = SimpleNamespace(
        method="PATCH",
        url=SimpleNamespace(path="/api/vendor/applicants/app-1"),
        query_params={},
        headers={},
    )
    ctx = SimpleNamespace(load_db=lambda: db, save_db=save_db, rate_limit=lambda *_a, **_k: True)

    def json_fn(code, body, **_kwargs):
        return JSONResponse(body, status_code=code)

    return asyncio.run(try_extended(request, ctx, json_fn))


def try_extended(request, ctx, json_fn):
    return route_extensions.try_extended_routes(request, ctx, None, json_fn, lambda _access: {})


def test_vendor_patch_updates_the_candidate_list(monkeypatch) -> None:
    db = _world()
    res = _patch(db, "shortlisted", monkeypatch)
    assert res is not None and res.status_code == 200
    assert json.loads(res.body)["application"]["status"] == "shortlisted"
    rows = db["applications"]["ada@example.com"]
    assert len(rows) == 1
    assert rows[0]["status"] == "Selected"
    assert rows[0]["employerStatus"] == "shortlisted"
    current = [step for step in rows[0]["timeline"] if step["current"]]
    assert [step["key"] for step in current] == ["selected"]

    res = _patch(db, "rejected", monkeypatch)
    assert res.status_code == 200
    assert len(db["applications"]["ada@example.com"]) == 1
    updated = db["applications"]["ada@example.com"][0]
    assert updated["status"] == "Not selected"
    assert [step["key"] for step in updated["timeline"] if step["current"]] == ["closed"]
    assert updated["timeline"][2]["done"] is False


def test_vendor_patch_does_not_create_an_application_without_email(monkeypatch) -> None:
    db = _world(email=None)
    res = _patch(db, "shortlisted", monkeypatch)
    assert res is not None and res.status_code == 200
    assert db["applications"] == {}

    db = _world(email="   ")
    res = _patch(db, "shortlisted", monkeypatch)
    assert res.status_code == 200
    assert db["applications"] == {}


def test_vendor_patch_upserts_the_candidate_row_when_the_database_is_configured(monkeypatch) -> None:
    db = _world()
    upserts: list = []
    res = _patch(db, "shortlisted", monkeypatch, persistence=True, upserts=upserts)
    assert res is not None and res.status_code == 200
    assert len(upserts) == 1
    email, record = upserts[0]
    assert email == "ada@example.com"
    assert record["status"] == "Selected"
    assert record["employerStatus"] == "shortlisted"
    assert [step["key"] for step in record["timeline"] if step["current"]] == ["selected"]


def _get(db: dict, path: str, email: str, monkeypatch):
    async def fake_auth(_request):
        return email

    monkeypatch.setattr(runtime, "require_auth_email", fake_auth)
    monkeypatch.setattr(api_dispatch, "persistence_ready", lambda _url: False)
    request = SimpleNamespace(
        method="GET",
        url=SimpleNamespace(path=path),
        query_params={},
        headers={},
    )
    ctx = SimpleNamespace(
        load_db=lambda: db,
        save_db=_async_noop,
        rate_limit=lambda *_a, **_k: True,
        client_ip=lambda _request: "127.0.0.1",
    )
    return asyncio.run(handle_api_dispatch(request, ctx))


async def _async_noop(_db=None):
    return None


def test_candidate_can_read_their_application_with_timeline(monkeypatch) -> None:
    record = build_candidate_job_application_record(
        JOB,
        {"id": "app-1", "status": "shortlisted", "appliedAt": APPLIED_AT, "data": {}},
    )
    db = {
        "applications": {
            "ada@example.com": [record],
            "other@example.com": [{"id": "app-9", "status": "Applied", "employerStatus": "applied"}],
        }
    }
    res = _get(db, "/api/applications/app-1", "ada@example.com", monkeypatch)
    assert res is not None and res.status_code == 200
    body = json.loads(res.body)
    assert body["application"]["status"] == "Selected"
    assert body["application"]["employerStatus"] == "shortlisted"
    assert [step["key"] for step in body["application"]["timeline"] if step["current"]] == ["selected"]

    missing = _get(db, "/api/applications/app-9", "ada@example.com", monkeypatch)
    assert missing is not None and missing.status_code == 404
    someone_elses = _get(db, "/api/applications/app-1", "other@example.com", monkeypatch)
    assert someone_elses is not None and someone_elses.status_code == 404
