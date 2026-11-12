"""Key rotation and model fallback for the shared Gemini client. No network: HTTP is a scripted fake."""

from __future__ import annotations

import asyncio
import json

import pytest

from app.services import gemini_client as g


class FakeResponse:
    def __init__(self, status: int, body: dict | None = None, text: str | None = None, headers: dict | None = None):
        self.status_code = status
        self.is_success = 200 <= status < 300
        self._body = body if body is not None else ({"candidates": [{"content": {"parts": [{"text": text or "hello"}]}}]} if self.is_success else {})
        self.headers = headers or {}

    def json(self):
        return self._body


def err(status: int, message: str = "", reason: str = "") -> FakeResponse:
    return FakeResponse(status, {"error": {"message": message, "status": reason}})


class FakeClient:
    """Answers each request from `script(key_suffix, model)`; records every attempt."""

    def __init__(self, script):
        self.script = script
        self.calls: list[tuple[str, str]] = []

    async def post(self, url, headers=None, json=None):
        model = url.rsplit("/", 1)[1].split(":")[0]
        key = headers["x-goog-api-key"]
        self.calls.append((key, model))
        out = self.script(key, model)
        if isinstance(out, Exception):
            raise out
        return out

    async def aclose(self):
        pass


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for name in list(__import__("os").environ):
        if name.startswith("GEMINI_") or name in ("GOOGLE_API_KEY", "PRIMARY_MODEL", "FAST_MODEL"):
            monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "key-one")
    monkeypatch.setenv("GEMINI_API_KEY_2", "key-two")
    monkeypatch.setenv("PRIMARY_MODEL", "model-a")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "model-b")
    g.reset_health()
    yield
    g.reset_health()


def run(client, **kw):
    return asyncio.run(g.generate_content(system="s", user="u", temperature=0.2, max_tokens=50, client=client, **kw))


def test_uses_first_key_when_it_works():
    c = FakeClient(lambda k, m: FakeResponse(200, text="hi"))
    r = run(c)
    assert (r.text, r.key_index, r.model, r.attempts) == ("hi", 1, "model-a", 1)
    assert c.calls == [("key-one", "model-a")]


def test_invalid_first_key_falls_over_to_second_key():
    def script(k, m):
        return err(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT") if k == "key-one" else FakeResponse(200, text="from two")

    c = FakeClient(script)
    r = run(c)
    assert r.text == "from two" and r.key_index == 2 and r.model == "model-a"


def test_dead_key_is_skipped_on_later_requests():
    def script(k, m):
        return err(403, "API key leaked", "PERMISSION_DENIED") if k == "key-one" else FakeResponse(200, text="ok")

    c = FakeClient(script)
    run(c)
    c2 = FakeClient(script)
    r = run(c2)
    assert r.attempts == 1 and c2.calls == [("key-two", "model-a")]  # key one is cooling down, not retried


def test_rate_limited_key_rotates_to_the_other_key():
    def script(k, m):
        return err(429, "quota", "RESOURCE_EXHAUSTED") if k == "key-one" else FakeResponse(200, text="ok")

    r = run(FakeClient(script))
    assert r.key_index == 2 and r.model == "model-a"


def test_rate_limit_is_per_model_so_the_fallback_model_can_still_use_the_same_key():
    def script(k, m):
        return err(429, "quota", "RESOURCE_EXHAUSTED") if m == "model-a" else FakeResponse(200, text="fallback")

    c = FakeClient(script)
    r = run(c)
    assert r.model == "model-b" and r.text == "fallback"
    assert ("key-one", "model-b") in c.calls or ("key-two", "model-b") in c.calls


def test_missing_primary_model_falls_back_to_next_model():
    def script(k, m):
        return err(404, "models/model-a is no longer available", "NOT_FOUND") if m == "model-a" else FakeResponse(200, text="b")

    c = FakeClient(script)
    r = run(c)
    assert r.model == "model-b"
    # model-a is remembered as gone: the next request does not try it again
    c2 = FakeClient(script)
    run(c2)
    assert all(model != "model-a" for _k, model in c2.calls)


def test_network_error_and_server_error_try_the_next_combination():
    def script(k, m):
        if k == "key-one":
            return TimeoutError("boom")
        return FakeResponse(200, text="ok")

    assert run(FakeClient(script)).key_index == 2

    def script2(k, m):
        return err(503, "unavailable", "UNAVAILABLE") if m == "model-a" else FakeResponse(200, text="ok")

    assert run(FakeClient(script2)).model == "model-b"


def test_empty_model_answer_counts_as_a_failure():
    def script(k, m):
        return FakeResponse(200, text="   ") if k == "key-one" else FakeResponse(200, text="real")

    assert run(FakeClient(script)).text == "real"


def test_returns_none_only_when_everything_fails():
    c = FakeClient(lambda k, m: err(500, "down", "INTERNAL"))
    assert run(c) is None
    assert len(c.calls) == 8  # 2 keys x (2 configured + 2 built-in safe) models were all tried
    assert g.status_snapshot()["lastError"]


def test_still_tries_when_every_combination_is_cooling_down():
    dead = FakeClient(lambda k, m: err(403, "bad", "PERMISSION_DENIED"))
    assert run(dead) is None  # both keys now marked dead
    healed = FakeClient(lambda k, m: FakeResponse(200, text="recovered"))
    r = run(healed)
    assert r is not None and r.text == "recovered"  # a recovered key is used even though it was marked dead


def test_json_mode_and_system_prompt_reach_the_request():
    seen = {}

    class Spy(FakeClient):
        async def post(self, url, headers=None, json=None):
            seen.update(json)
            return FakeResponse(200, text="{}")

    run(Spy(lambda k, m: None), json_mode=True)
    assert seen["generationConfig"]["responseMimeType"] == "application/json"
    assert seen["systemInstruction"]["parts"][0]["text"] == "s"


def test_no_key_means_no_call():
    for name in ("GEMINI_API_KEY", "GEMINI_API_KEY_2"):
        __import__("os").environ.pop(name, None)
    c = FakeClient(lambda k, m: FakeResponse(200))
    assert run(c) is None and c.calls == []
    assert g.gemini_configured() is False


def test_key_discovery(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY_3", "key-three")
    monkeypatch.setenv("GEMINI_API_KEYS", "key-four, key-one")  # duplicate of key one is ignored
    monkeypatch.setenv("GOOGLE_API_KEY", "key-google")
    assert g.gemini_keys() == ["key-one", "key-google", "key-two", "key-three", "key-four"]


def test_model_chain_order_and_safe_defaults(monkeypatch):
    assert g.model_chain()[:2] == ["model-a", "model-b"]
    assert "gemini-flash-lite-latest" in g.model_chain()  # built-in alias that cannot be retired
    monkeypatch.delenv("PRIMARY_MODEL")
    monkeypatch.delenv("GEMINI_FALLBACK_MODELS")
    assert g.model_chain()[0] == "gemini-3.1-flash-lite"
    assert g.model_chain("custom-x")[0] == "custom-x"


def test_status_never_exposes_keys():
    run(FakeClient(lambda k, m: err(403, "bad", "PERMISSION_DENIED") if k == "key-one" else FakeResponse(200)))
    dump = json.dumps(g.status_snapshot())
    assert "key-one" not in dump and "key-two" not in dump
    snap = g.status_snapshot()
    assert snap["keyCount"] == 2 and snap["keys"][0]["available"] is False and snap["keys"][1]["available"] is True


def test_total_time_budget_stops_endless_retries():
    c = FakeClient(lambda k, m: err(500, "down", "INTERNAL"))
    assert run(c, total_budget=0) is None
    assert len(c.calls) == 1
    assert "time budget" in g.status_snapshot()["lastError"]


def test_overloaded_model_steps_aside_briefly_so_later_requests_go_straight_to_the_fallback():
    def script(k, m):
        return err(503, "This model is currently experiencing high demand.", "UNAVAILABLE") if m == "model-a" else FakeResponse(200, text="b")

    first = FakeClient(script)
    assert run(first).model == "model-b"
    second = FakeClient(script)
    r = run(second)
    assert r.model == "model-b" and r.attempts == 1  # no wasted attempt on the overloaded model
