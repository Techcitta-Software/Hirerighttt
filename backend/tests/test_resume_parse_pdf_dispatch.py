"""POST /api/resume/parse reads PDF bytes with pdf_layout_text and does not spawn Paddle by default."""

import base64
import io

from tests.test_resume_extract_pdf import _pdf


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _block_paddle(monkeypatch):
    from app.dispatch import api_dispatch

    monkeypatch.delenv("PADDLE_OCR_ENABLED", raising=False)
    api_dispatch.paddle_ocr_available.cache_clear()
    calls = []

    def spy(*args, **kwargs):
        calls.append(args)
        raise AssertionError("subprocess.run")

    monkeypatch.setattr(api_dispatch.subprocess, "run", spy)
    return api_dispatch, calls


def test_unreadable_scan_is_422_and_does_not_spawn_paddle(client, monkeypatch):
    api_dispatch, calls = _block_paddle(monkeypatch)
    try:
        raw = _pdf([], compress=True)
        from app.services.resume_parse.extract_pdf import pdf_layout_text

        assert pdf_layout_text(raw).scanned is True
        res = client.post(
            "/api/resume/parse",
            json={
                "fileName": "scan.pdf",
                "fileData": _b64(raw),
                "text": "This client string is long enough to have been trusted before. CLIENTSIDEONLY.",
            },
        )
        assert res.status_code == 422, res.text
        assert res.json() == {"ok": False, "error": "scanned_pdf_unreadable"}
        assert calls == []
    finally:
        api_dispatch.paddle_ocr_available.cache_clear()


def test_pdf_bytes_override_a_long_client_string(client, monkeypatch):
    api_dispatch, calls = _block_paddle(monkeypatch)
    try:
        raw = _pdf(
            [
                "Priya Raman",
                "Senior Backend Engineer at ShopNova",
                "Built the order service in Python FastAPI and PostgreSQL handling thousands of requests.",
                "Skills include Python, FastAPI, PostgreSQL, Redis, Kafka, and Docker.",
                "Led a small team and shipped the billing API used by every storefront.",
            ],
            compress=True,
        )
        client_text = "CLIENTSIDEONLY " * 8
        assert "FastAPI" not in client_text and len(client_text) >= 40
        res = client.post(
            "/api/resume/parse",
            json={"fileName": "priya.pdf", "fileData": _b64(raw), "text": client_text},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True and body["source"] == "rules"
        assert "warnings" not in body
        assert "FastAPI" in body["extract"]["resumeText"]
        assert "CLIENTSIDEONLY" not in body["extract"]["resumeText"]
        assert calls == []
    finally:
        api_dispatch.paddle_ocr_available.cache_clear()


def test_scanned_pdf_with_some_text_warns(client, monkeypatch):
    _block_paddle(monkeypatch)
    sentence = "Ada Lovelace writes Python services for banks today."
    raw = _pdf([sentence], compress=True)
    from app.services.resume_parse.extract_pdf import pdf_layout_text

    layout = pdf_layout_text(raw)
    assert layout.scanned is True
    assert "Python" in layout.text
    assert len(layout.text) >= 40
    res = client.post(
        "/api/resume/parse",
        json={
            "fileName": "short.pdf",
            "fileData": _b64(raw),
            "text": "CLIENTSIDEONLY " * 8,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True and body["source"] == "rules"
    assert body["warnings"] == ["scanned_pdf"]
    assert "Python" in body["extract"]["resumeText"]
    assert "CLIENTSIDEONLY" not in body["extract"]["resumeText"]


def test_multipart_pdf_uses_layout_text(client, monkeypatch):
    api_dispatch, calls = _block_paddle(monkeypatch)
    try:
        raw = _pdf(["Priya Raman ships FastAPI services with PostgreSQL and Redis."], compress=True)
        res = client.post(
            "/api/resume/parse",
            files={"file": ("resume.pdf", io.BytesIO(raw), "application/pdf")},
            data={"text": "CLIENTSIDEONLY " * 8},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["source"] == "rules"
        assert "FastAPI" in body["extract"]["resumeText"]
        assert "CLIENTSIDEONLY" not in body["extract"]["resumeText"]
        assert calls == []
    finally:
        api_dispatch.paddle_ocr_available.cache_clear()


def test_text_only_parse_still_uses_the_client_string(client):
    text = "Priya Raman\nSenior Backend Engineer\nPython FastAPI PostgreSQL Kafka Docker Redis."
    res = client.post("/api/resume/parse", json={"text": text})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True and body["source"] == "rules"
    assert "warnings" not in body
    assert "FastAPI" in body["extract"]["resumeText"]
