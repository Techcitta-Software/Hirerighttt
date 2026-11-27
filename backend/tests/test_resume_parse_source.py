"""POST /api/resume/parse labels llm, rules, and cache. A rules fallback is not an AI extract."""

from __future__ import annotations

import json

from app.services.gemini_client import GeminiResult


_TEXT = "Priya Raman\nSenior Backend Engineer\nPython FastAPI PostgreSQL Kafka Docker Redis built services."


def _clear():
    from app.services import interview_api as ia

    ia._resume_parse_cache.clear()


def test_llm_rules_and_cache_sources(client, monkeypatch):
    from app.services import gemini_client
    from app.services import interview_api as ia

    calls = []

    async def fake(**kw):
        calls.append(kw)
        return GeminiResult(
            text=json.dumps(
                {
                    "fullName": "Priya Raman",
                    "skills": ["Python"],
                    "currentRole": "Engineer",
                    "workExperiences": [
                        {"jobTitle": "Nurse", "company": "KMC Hospital, Mangaluru", "location": ""}
                    ],
                }
            ),
            model="m",
            key_index=1,
            attempts=1,
        )

    monkeypatch.setattr(gemini_client, "gemini_configured", lambda: True)
    monkeypatch.setattr(gemini_client, "generate_content_hedged", fake)
    _clear()
    try:
        first = client.post("/api/resume/parse", json={"text": _TEXT})
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["source"] == "llm"
        assert body["extract"]["source"] == "gemini"
        assert "_responseSource" not in body["extract"]
        job = body["extract"]["workExperiences"][0]
        assert job["company"] == "KMC Hospital"
        assert job["location"] == "Mangaluru"
        assert calls and calls[0]["cap"] == 6.5 and calls[0]["hedge_after"] == 2.5

        second = client.post("/api/resume/parse", json={"text": _TEXT})
        assert second.status_code == 200
        assert second.json()["source"] == "cache"
        assert len(calls) == 1

        async def down(**_kw):
            calls.append("down")
            return None

        monkeypatch.setattr(gemini_client, "generate_content_hedged", down)
        other = "Asha Iyer\nStaff Nurse at a city hospital with bedside care and patient rounds daily."
        rules = client.post("/api/resume/parse", json={"text": other})
        assert rules.status_code == 200, rules.text
        rules_body = rules.json()
        assert rules_body["source"] == "rules"
        assert rules_body["extract"].get("source") != "gemini"
        assert "_responseSource" not in rules_body["extract"]
        assert calls[-1] == "down"
    finally:
        _clear()


def test_company_place_does_not_invent_an_employer():
    from app.services.resume_parse.merge import apply_company_places

    out = apply_company_places(
        {
            "workExperiences": [
                {"jobTitle": "Engineer", "company": "Acme Widgets, Notacity", "location": ""},
                "not-a-job",
            ]
        }
    )
    assert len(out["workExperiences"]) == 2
    assert out["workExperiences"][0]["company"] == "Acme Widgets, Notacity"
    assert out["workExperiences"][0]["location"] == ""
    assert out["workExperiences"][1] == "not-a-job"


def test_rules_extract_helper_strips_an_ai_source():
    from app.services.interview_api import _rules_parse_response

    out = _rules_parse_response({"fullName": "Priya Raman", "source": "gemini", "skills": []})
    assert out["_responseSource"] == "rules"
    assert "source" not in out
