"""A recruiter's job-link interview must start even when Gemini is overloaded (503), rate-limited or times out."""

import asyncio

from app.services import interview_llm_questions as q

JD = (
    "Senior Backend Engineer (Python). Responsibilities: design REST APIs with FastAPI; model data in PostgreSQL; "
    "deploy services on AWS; monitor performance and fix production incidents; review code and mentor juniors. "
    "Requirements: 4+ years Python, FastAPI, PostgreSQL, Docker, AWS, pytest."
)
PROFILE = {
    "fullName": "Kavya Iyer",
    "skills": ["Python", "FastAPI", "PostgreSQL"],
    "resumeText": "Kavya Iyer\nSoftware Engineer at Flipside Tech\nEXPERIENCE\nFlipside Tech: FastAPI services.",
}


def _run(monkeypatch, responder):
    monkeypatch.setattr(q, "_gemini_generate", responder)
    monkeypatch.setattr("app.services.interview_api.llm_configured", lambda: True)
    return asyncio.run(
        q.generate_adaptive_question_batch_llm(
            {
                "profile": PROFILE,
                "level": "3–5 years",
                "role": "Senior Backend Engineer",
                "jobDescription": JD,
                "jdFirst": True,
                "skillFocus": ["Python", "FastAPI", "PostgreSQL"],
                "varietySeed": "t",
            }
        )
    )


def test_total_gemini_outage_still_starts_job_interview(monkeypatch):
    calls = []

    async def down(*_a, **_k):
        calls.append(1)
        return ""  # every key and model failed (503 / 429 / timeout)

    result = _run(monkeypatch, down)
    assert calls, "Gemini should still be tried first"
    assert result["jdFirst"] is True
    assert result["durationMinutes"] == 20
    assert result["questionMix"] == {"jd": 6, "jd-alignment": 2, "behavioural": 1}
    texts = [x["text"] for x in result["questions"]]
    assert len(texts) == 10 and len(set(texts)) == 10
    assert all(t.strip() for t in texts)


def test_unusable_model_output_also_falls_back(monkeypatch):
    async def junk(*_a, **_k):
        return '{"questions": "not a list"}'

    result = _run(monkeypatch, junk)
    assert result["questionMix"] == {"jd": 6, "jd-alignment": 2, "behavioural": 1}
