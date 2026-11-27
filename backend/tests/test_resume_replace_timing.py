"""Resume replace writes the profile and returns before purge or the talent upsert finish."""

from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace

from app.dispatch import api_dispatch
from app.services import resume_replace
from tests.test_security_fixes import _auth, env  # noqa: F401


class _Conn:
    def execute(self, *_a, **_k):
        return None

    def commit(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


class _Pool:
    def connection(self):
        return _Conn()


def test_response_returns_before_purge_finishes(monkeypatch):
    release = asyncio.Event()
    state = {"purge_started": False, "purge_finished": False, "talent_started": False, "saved": False}

    async def slow_purge(*_a, **_k):
        state["purge_started"] = True
        await release.wait()
        state["purge_finished"] = True
        return {"recordings": 0, "artifacts": 0}

    async def slow_talent(*_a, **_k):
        state["talent_started"] = True
        await release.wait()
        return None

    async def save_db(db):
        state["saved"] = True
        state["profile"] = dict(db["profiles"]["a@b.c"])

    async def upload(**_kw):
        return {
            "storagePath": "users/u1/resume/a.pdf",
            "resumeUrl": "/api/resume/download",
            "fileId": None,
            "storageProvider": "s3",
        }

    monkeypatch.setattr(resume_replace, "object_storage_configured", lambda: True)
    monkeypatch.setattr(resume_replace, "upload_resume_to_object_storage", upload)
    monkeypatch.setattr(resume_replace, "_purge_prior_artifacts", slow_purge)
    monkeypatch.setattr(resume_replace, "upsert_candidate_talent", slow_talent)
    monkeypatch.setattr(resume_replace, "db_pool", lambda _url: _Pool())
    monkeypatch.setattr(resume_replace, "find_user", lambda _db, email=None: {"id": "u1", "email": email, "name": "A"})

    async def run():
        result = await resume_replace.replace_candidate_resume(
            config=SimpleNamespace(database_url="postgresql://fake/db"),
            email="a@b.c",
            body={
                "filename": "a.pdf",
                "file_base64": base64.b64encode(b"%PDF-1.4").decode(),
                "extract": {"fullName": "Priya Raman", "resumeText": "Priya Raman\nEngineer"},
            },
            db={"profiles": {"a@b.c": {"resumeText": "old resume text"}}},
            save_db=save_db,
        )
        await asyncio.sleep(0)
        assert state["saved"] is True
        assert state["profile"]["fullName"] == "Priya Raman"
        assert state["purge_started"] is True and state["purge_finished"] is False
        assert state["talent_started"] is True
        assert result["profile"]["resumeName"] == "a.pdf"
        assert 'purge;dur=0;desc="background"' in result["_serverTiming"]
        assert "upload;dur=" in result["_serverTiming"] and "save;dur=" in result["_serverTiming"]
        release.set()
        pending = list(resume_replace._background_tasks)
        if pending:
            await asyncio.wait_for(asyncio.gather(*pending), timeout=2)
        assert state["purge_finished"] is True

    asyncio.run(run())


def test_replace_route_sends_server_timing(env, monkeypatch):
    client, _db, _pool = env

    async def fake_replace(**_kw):
        return {
            "profile": {"fullName": "Priya Raman"},
            "storagePath": "users/u1/resume/a.pdf",
            "purged": {"scheduled": True},
            "_serverTiming": resume_replace.server_timing_header(upload_ms=3.0, save_ms=4.0),
        }

    monkeypatch.setattr(api_dispatch, "replace_candidate_resume", fake_replace)
    res = client.post(
        "/api/resume/replace",
        headers=_auth("tok-cand"),
        json={"filename": "a.pdf", "file_base64": base64.b64encode(b"%PDF-1.4").decode()},
    )
    assert res.status_code == 200, res.text
    assert "_serverTiming" not in res.json()
    timing = res.headers["server-timing"]
    assert "upload;dur=3.0" in timing and "save;dur=4.0" in timing
    assert 'purge;dur=0;desc="background"' in timing
