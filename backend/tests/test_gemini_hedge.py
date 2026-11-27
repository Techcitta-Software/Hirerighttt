"""Hedged Gemini: the next model starts if the first has not returned, and the first valid result wins."""

from __future__ import annotations

import asyncio
import time

from app.services import gemini_client as g


class FakeResponse:
    def __init__(self, status: int, text: str = "hello"):
        self.status_code = status
        self.is_success = 200 <= status < 300
        self._text = text
        self.headers = {}
        self.text = text

    def json(self):
        if not self.is_success:
            return {"error": {"message": self._text, "status": ""}}
        return {"candidates": [{"content": {"parts": [{"text": self._text}]}}]}


class FakeClient:
    def __init__(self, behavior):
        self.behavior = behavior
        self.calls: list[str] = []

    async def post(self, url, headers=None, json=None):
        model = url.rsplit("/", 1)[1].split(":")[0]
        self.calls.append(model)
        return await self.behavior(model)


def _run(coro):
    return asyncio.run(coro)


def _pin_models(monkeypatch, primary: str, fallback: str) -> None:
    """Pin the chain. The developer machine may already export FAST_MODEL, which sits ahead of fallbacks."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("PRIMARY_MODEL", primary)
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", fallback)
    monkeypatch.delenv("FAST_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_FALLBACK_MODEL", raising=False)
    g.reset_health()


def test_first_valid_result_returns_without_starting_the_next_model(monkeypatch):
    _pin_models(monkeypatch, "model-a", "model-b")

    async def behavior(_model):
        return FakeResponse(200, text="from-a")

    client = FakeClient(behavior)
    result = _run(
        g.generate_content_hedged(
            system="s", user="u", temperature=0.1, max_tokens=32, client=client, hedge_after=2.5, cap=6.5
        )
    )
    assert result is not None and result.text == "from-a" and result.model == "model-a"
    assert client.calls == ["model-a"]


def test_slow_primary_is_hedged_by_the_next_model(monkeypatch):
    _pin_models(monkeypatch, "model-slow", "model-fast")

    async def behavior(model):
        if model == "model-slow":
            await asyncio.sleep(0.6)
            return FakeResponse(200, text="from-slow")
        return FakeResponse(200, text="from-fast")

    client = FakeClient(behavior)
    started = time.monotonic()
    result = _run(
        g.generate_content_hedged(
            system="s", user="u", temperature=0.1, max_tokens=32, client=client, hedge_after=0.05, cap=1.0
        )
    )
    elapsed = time.monotonic() - started
    assert result is not None and result.text == "from-fast" and result.model == "model-fast"
    assert "model-slow" in client.calls and "model-fast" in client.calls
    assert elapsed < 0.45


def test_cap_returns_none_when_nothing_answers(monkeypatch):
    _pin_models(monkeypatch, "model-slow", "model-slower")

    async def behavior(_model):
        await asyncio.sleep(2)
        return FakeResponse(200, text="too-late")

    client = FakeClient(behavior)
    started = time.monotonic()
    result = _run(
        g.generate_content_hedged(
            system="s", user="u", temperature=0.1, max_tokens=32, client=client, hedge_after=0.05, cap=0.2
        )
    )
    assert result is None
    assert time.monotonic() - started < 0.6
    assert len(client.calls) >= 2


def test_failed_primary_starts_the_next_model(monkeypatch):
    _pin_models(monkeypatch, "model-down", "model-up")

    async def behavior(model):
        if model == "model-down":
            return FakeResponse(503, text="overloaded")
        return FakeResponse(200, text="recovered")

    client = FakeClient(behavior)
    result = _run(
        g.generate_content_hedged(
            system="s", user="u", temperature=0.1, max_tokens=32, client=client, hedge_after=2.5, cap=1.0
        )
    )
    assert result is not None and result.text == "recovered"
    assert client.calls[0] == "model-down" and "model-up" in client.calls
