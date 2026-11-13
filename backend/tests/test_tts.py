"""Interviewer voice streaming: key/model failover and PCM extraction. No network: HTTP is a scripted fake."""

from __future__ import annotations

import asyncio
import base64
import json

import pytest

from app.services import tts


def sse(*chunks: bytes) -> list[str]:
    return [
        "data: " + json.dumps({"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/l16", "data": base64.b64encode(c).decode()}}]}}]})
        for c in chunks
    ]


class FakeResponse:
    def __init__(self, status: int, lines: list[str] | None = None):
        self.status_code = status
        self._lines = lines or []
        self.closed = False

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aclose(self):
        self.closed = True


class FakeClient:
    def __init__(self, script):
        self.script = script
        self.attempts: list[tuple[str, str]] = []

    def build_request(self, method, url, params=None, headers=None, json=None):
        return {"url": url, "key": (headers or {}).get("x-goog-api-key", ""), "body": json}

    async def send(self, request, stream=False):
        model = request["url"].rsplit("/", 1)[1].split(":")[0]
        self.attempts.append((request["key"], model))
        return self.script(request["key"], model)

    async def aclose(self):
        pass


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    tts._key_until.clear()
    tts._model_until.clear()
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEYS", "TTS_MODEL", "TTS_FALLBACK_MODELS", "TTS_VOICE", "TTS_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "key-one")
    monkeypatch.setenv("GEMINI_API_KEY_2", "key-two")


def run(client, text="Tell me about a project.", voice=None):
    async def go():
        first, rest, close = await tts.open_speech(text, voice, client=client)
        out = first
        async for chunk in rest:
            out += chunk
        await close()
        return first, out

    return asyncio.run(go())


def test_streams_every_chunk_in_order():
    client = FakeClient(lambda k, m: FakeResponse(200, sse(b"\x01\x00", b"\x02\x00", b"\x03\x00")))
    first, everything = run(client)
    assert first == b"\x01\x00"
    assert everything == b"\x01\x00\x02\x00\x03\x00"


def test_skips_lines_that_carry_no_audio():
    client = FakeClient(lambda k, m: FakeResponse(200, [": keepalive", "data: {}", *sse(b"\x07\x00")]))
    assert run(client)[1] == b"\x07\x00"


def test_rate_limited_key_fails_over_to_the_next_key():
    def script(key, model):
        return FakeResponse(429) if key == "key-one" else FakeResponse(200, sse(b"\x05\x00"))

    client = FakeClient(script)
    assert run(client)[1] == b"\x05\x00"
    assert [k for k, _ in client.attempts][:2] == ["key-one", "key-two"]


def test_a_cooling_down_key_is_not_tried_on_the_next_request():
    def script(key, model):
        return FakeResponse(429) if key == "key-one" else FakeResponse(200, sse(b"\x05\x00"))

    run(FakeClient(script))
    second = FakeClient(script)
    run(second)
    assert [k for k, _ in second.attempts] == ["key-two"]


def test_falls_back_to_the_second_model_when_the_first_returns_no_audio():
    def script(key, model):
        return FakeResponse(200, ["data: {}"]) if model == tts.DEFAULT_MODEL else FakeResponse(200, sse(b"\x09\x00"))

    client = FakeClient(script)
    assert run(client)[1] == b"\x09\x00"
    assert client.attempts[-1][1] == tts.DEFAULT_FALLBACK_MODELS[0]


def test_unavailable_when_everything_fails():
    client = FakeClient(lambda k, m: FakeResponse(429))
    with pytest.raises(tts.TtsUnavailable):
        run(client)


def test_unavailable_with_no_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY_2", raising=False)
    with pytest.raises(tts.TtsUnavailable):
        run(FakeClient(lambda k, m: FakeResponse(200, sse(b"\x00\x00"))))
    assert tts.tts_enabled() is False


def test_sends_the_text_unchanged_with_no_style_prefix():
    seen = {}

    def script(key, model):
        return FakeResponse(200, sse(b"\x00\x00"))

    client = FakeClient(script)
    orig = client.build_request

    def spy(*a, **kw):
        req = orig(*a, **kw)
        seen["text"] = req["body"]["contents"][0]["parts"][0]["text"]
        seen["voice"] = req["body"]["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"]
        return req

    client.build_request = spy
    run(client, "  Tell   me about  yourself.  ")
    assert seen["text"] == "Tell me about yourself."
    assert seen["voice"] == "Erinome"


def test_voice_choice_is_limited_to_the_allowed_list(monkeypatch):
    assert tts.resolve_voice("Sulafat") == "Sulafat"
    assert tts.resolve_voice("../etc/passwd") == "Erinome"
    monkeypatch.setenv("TTS_VOICE", "Achird")
    assert tts.resolve_voice() == "Achird"


def test_long_text_is_capped():
    assert len(tts.clean_text("a " * 2000)) <= tts.MAX_CHARS


def test_disabled_by_env(monkeypatch):
    monkeypatch.setenv("TTS_ENABLED", "false")
    assert tts.tts_enabled() is False
