"""Latency work on the interview model: keep-alive client, minimal thinking (with safe fallback), partial re-ask."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.services import gemini_client as g


def _ok(text: str) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


@pytest.fixture(autouse=True)
def _one_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_API_KEY_2", raising=False)
    monkeypatch.delenv("GEMINI_API_KEYS", raising=False)
    monkeypatch.setenv("PRIMARY_MODEL", "gemini-3.1-flash-lite")
    g.reset_health()
    g._no_thinking_config.clear()
    yield
    g._no_thinking_config.clear()


def test_thinking_setting_is_sent_and_json_mode_requested():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return _ok('{"ok": true}')

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await g.generate_content(
                system="s", user="u", temperature=0.3, max_tokens=64, json_mode=True, thinking="minimal", client=client
            )

    result = asyncio.run(run())
    assert result and result.text == '{"ok": true}'
    cfg = seen[0]["generationConfig"]
    assert cfg["thinkingConfig"] == {"thinkingLevel": "minimal"}
    assert cfg["responseMimeType"] == "application/json"


def test_model_that_rejects_thinking_is_called_without_it_and_remembered():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        if "thinkingConfig" in body["generationConfig"]:
            return httpx.Response(400, json={"error": {"status": "INVALID_ARGUMENT", "message": "thinking_level is not supported"}})
        return _ok("question")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await g.generate_content(system="s", user="u", temperature=0.3, max_tokens=64, thinking="minimal", client=client)
            second = await g.generate_content(system="s", user="u", temperature=0.3, max_tokens=64, thinking="minimal", client=client)
            return first, second

    first, second = asyncio.run(run())
    assert first and first.text == "question" and first.model == "gemini-3.1-flash-lite"  # same model, no failover
    assert second and second.text == "question"
    assert len(seen) == 3  # rejected once, resent without, then the next call skips the setting straight away
    assert "thinkingConfig" not in seen[2]["generationConfig"]


def test_gemini_2_models_get_a_zero_thinking_budget():
    assert g._thinking_config("gemini-2.5-flash-lite", "minimal") == {"thinkingBudget": 0}
    assert g._thinking_config("gemini-3.1-flash-lite", "minimal") == {"thinkingLevel": "minimal"}
    assert g._thinking_config("gemini-3.1-flash-lite", None) is None


def test_one_keep_alive_client_per_event_loop():
    async def run():
        a = g.shared_http_client()
        b = g.shared_http_client()
        await g.close_shared_http_client()
        c = g.shared_http_client()
        await g.close_shared_http_client()
        return a, b, c

    a, b, c = asyncio.run(run())
    assert a is b  # reused: no new TLS handshake per call
    assert c is not a  # a closed client is replaced


def test_start_batch_re_asks_only_the_missing_questions(monkeypatch):
    from app.services import interview_llm_questions as q

    calls = []

    def question(turn):
        return {"turnNumber": turn, "question": {"text": f"Question number {turn}: explain your approach in detail.", "category": "Technical"}}

    async def fake_generate(**kwargs):
        payload = json.loads(kwargs["user"])
        calls.append(payload)
        turns = [t["turnNumber"] for t in payload["turns"]]
        if len(calls) == 1:
            good = [question(t) for t in turns[:-2]] + [{"turnNumber": turns[-2], "question": {"text": "short"}}]
            return g.GeminiResult(text=json.dumps({"questions": good}), model="m", key_index=1, attempts=1)
        return g.GeminiResult(text=json.dumps({"questions": [question(t) for t in turns]}), model="m", key_index=1, attempts=1)

    monkeypatch.setattr(q, "generate_content", fake_generate)
    out = asyncio.run(
        q.generate_adaptive_question_batch_llm(
            {"role": "Backend Engineer", "level": "3 years", "fresher": False, "profile": {}, "ctx": {"skills": ["Python"]}}
        )
    )
    assert len(calls) == 2
    first_turns = [t["turnNumber"] for t in calls[0]["turns"]]
    second_turns = [t["turnNumber"] for t in calls[1]["turns"]]
    assert second_turns == first_turns[-2:]  # only the two that were missing or unusable
    # The closing line is filled before the re-ask, so alreadyAsked is the good turns plus that line.
    assert len(calls[1]["alreadyAsked"]) == len(first_turns) - 1
    texts = [x["text"] for x in out["questions"] if x.get("text")]
    assert len(texts) == len(set(texts)) == len(first_turns) + 1
    follow_up = out["questions"][out["fallbackTurn"] - 1]
    assert follow_up["focus"] == q.PENDING_FALLBACK_FOCUS
    assert follow_up["text"] == ""
    closing = out["questions"][out["closingTurn"] - 1]
    assert closing["focus"] == "structured-closing"
    assert closing["text"]
