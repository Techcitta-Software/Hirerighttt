"""Interviewer voice: neural text-to-speech from Gemini, streamed so the first words play in about a second.

Output is raw 16-bit little-endian PCM, mono, 24 kHz, sent as it is generated. The browser plays it as it arrives
and falls back to the device's own voice if this is unavailable (no key, quota used up, network error).

Configure in the repo-root .env (all optional):

    TTS_MODEL=gemini-3.8-flash-lite-tts      primary speech model
    TTS_FALLBACK_MODELS=gemini-3.8-flash-tts  tried when the primary fails
    TTS_VOICE=Erinome                         one of ALLOWED_VOICES ("Clear")
    TTS_ENABLED=false                         turn the neural voice off entirely

No style instruction is added in front of the text: the speech models read such an instruction aloud.
Keys come from the same list as every other Gemini call (see gemini_client.gemini_keys).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import Any, AsyncIterator

from app.services.gemini_client import API_ROOT, gemini_keys

logger = logging.getLogger("hireright.tts")

SAMPLE_RATE = 24_000
MAX_CHARS = 700
DEFAULT_MODEL = "gemini-3.8-flash-lite-tts"
DEFAULT_FALLBACK_MODELS = ("gemini-3.8-flash-tts",)
DEFAULT_VOICE = "Erinome"

# Gemini prebuilt voices. Erinome is the clear, even one; Sulafat and Achird are warmer alternatives.
ALLOWED_VOICES = frozenset(
    {
        "Erinome", "Sulafat", "Achird", "Kore", "Charon", "Zephyr", "Vindemiatrix", "Achernar", "Algieba",
        "Despina", "Leda", "Aoede", "Callirrhoe", "Puck", "Fenrir", "Orus", "Umbriel", "Gacrux", "Pulcherrima",
    }
)

KEY_COOLDOWN_SECONDS = 60
_key_until: dict[int, float] = {}
_model_until: dict[str, float] = {}


class TtsUnavailable(Exception):
    """Raised when no key/model could start speaking; the caller answers 503 and the browser uses its own voice."""


def tts_enabled() -> bool:
    return os.environ.get("TTS_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"} and bool(gemini_keys())


def clean_text(text: Any) -> str:
    t = " ".join(str(text or "").split())
    return t[:MAX_CHARS].rstrip()


def resolve_voice(requested: Any = None) -> str:
    for candidate in (requested, os.environ.get("TTS_VOICE")):
        v = str(candidate or "").strip()
        if v in ALLOWED_VOICES:
            return v
    return DEFAULT_VOICE


def _models() -> list[str]:
    primary = (os.environ.get("TTS_MODEL") or DEFAULT_MODEL).strip()
    extra = [m.strip() for m in (os.environ.get("TTS_FALLBACK_MODELS") or "").split(",") if m.strip()] or list(DEFAULT_FALLBACK_MODELS)
    out: list[str] = []
    for m in [primary, *extra]:
        if m and m not in out:
            out.append(m)
    return out


def _pcm_from_event(line: str) -> bytes:
    """One SSE `data:` line -> the PCM bytes it carries (empty when it carries none)."""
    if not line.startswith("data:"):
        return b""
    try:
        payload = json.loads(line[5:].strip())
    except ValueError:
        return b""
    out = b""
    for cand in payload.get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            data = (part.get("inlineData") or {}).get("data")
            if data:
                out += base64.b64decode(data)
    return out


async def open_speech(text: str, voice: str | None = None, *, client: Any = None) -> tuple[bytes, AsyncIterator[bytes], Any]:
    """Start speaking `text`. Returns (first_audio, rest_of_audio, closer).

    Tries each (model, key) that is not cooling down until one produces audio. Raises TtsUnavailable otherwise.
    Call `await closer()` when finished (the response stream is held open until then).
    """
    import httpx

    prepared = clean_text(text)
    if not prepared:
        raise TtsUnavailable("empty text")
    keys = gemini_keys()
    if not keys:
        raise TtsUnavailable("no key")
    chosen = resolve_voice(voice)
    body = {
        "contents": [{"parts": [{"text": prepared}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": chosen}}},
        },
    }
    now = time.time()
    combos = [(m, i) for m in _models() for i in range(len(keys))]
    ready = [(m, i) for (m, i) in combos if _key_until.get(i, 0) <= now and _model_until.get(m, 0) <= now]
    order = ready or combos

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
    last_error = "no attempt"
    for model, idx in order:
        response = None
        try:
            request = http.build_request(
                "POST",
                f"{API_ROOT}/{model}:streamGenerateContent",
                params={"alt": "sse"},
                headers={"x-goog-api-key": keys[idx]},
                json=body,
            )
            response = await http.send(request, stream=True)
            if response.status_code != 200:
                if response.status_code == 429:
                    _key_until[idx] = time.time() + KEY_COOLDOWN_SECONDS
                elif response.status_code in (401, 403):
                    _key_until[idx] = time.time() + 15 * 60
                elif response.status_code == 404:
                    _model_until[model] = time.time() + 30 * 60
                last_error = f"{model}: HTTP {response.status_code}"
                await response.aclose()
                continue

            lines = response.aiter_lines()
            first = b""
            async for line in lines:
                first = _pcm_from_event(line)
                if first:
                    break
            if not first:
                last_error = f"{model}: no audio"
                await response.aclose()
                continue

            async def rest(lines=lines) -> AsyncIterator[bytes]:
                async for line in lines:
                    chunk = _pcm_from_event(line)
                    if chunk:
                        yield chunk

            async def closer(response=response) -> None:
                await response.aclose()
                if own_client:
                    await http.aclose()

            return first, rest(), closer
        except Exception as exc:  # network error, timeout, bad JSON: try the next combination
            last_error = f"{model}: {type(exc).__name__}"
            if response is not None:
                try:
                    await response.aclose()
                except Exception:
                    pass
    if own_client:
        await http.aclose()
    logger.warning("Neural voice unavailable (%s)", last_error)
    raise TtsUnavailable(last_error)
