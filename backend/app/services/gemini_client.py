"""Single entry point for every Gemini call: several API keys, fallback models, automatic failover.

Configure in the repo-root .env (all optional except the first key):

    GEMINI_API_KEY=...            primary key
    GEMINI_API_KEY_2=...          backup key (also GEMINI_API_KEY_3, ... or GEMINI_API_KEYS=a,b,c)
    PRIMARY_MODEL=gemini-3.1-flash-lite
    GEMINI_FALLBACK_MODELS=gemini-flash-lite-latest,gemini-3.5-flash-lite

How a request is tried: for each model (primary first, then the fallbacks) it tries each key that is not currently
cooling down. A key that is invalid / disabled is skipped for 15 minutes, a rate-limited key for about a minute, and a
model that no longer exists is skipped for 30 minutes, so later requests do not waste time on them. If every
combination is cooling down it still tries them once instead of failing outright.
Keys are never logged or returned; they are only referred to as "key 1", "key 2", ...
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("hireright.gemini")

# Cap on simultaneous Gemini requests from this process. Without it a burst of interviews (hundreds of candidates
# answering within the same seconds) fires hundreds of calls at once, trips Google's per-key rate limit and puts
# every key into cooldown, so everyone gets the offline fallback. With it the excess simply waits its turn.
# Tune with GEMINI_MAX_CONCURRENCY (raise it when you add keys or a higher quota).
_gates: dict[int, asyncio.Semaphore] = {}


def _llm_gate() -> asyncio.Semaphore:
    loop_id = id(asyncio.get_running_loop())
    gate = _gates.get(loop_id)
    if gate is None:
        try:
            limit = max(1, int(os.environ.get("GEMINI_MAX_CONCURRENCY", "24") or 24))
        except ValueError:
            limit = 24
        gate = _gates[loop_id] = asyncio.Semaphore(limit)
    return gate

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
# Aliases that always point at a live model, so a retired model name can never break the fallback.
DEFAULT_FALLBACK_MODELS = ("gemini-flash-lite-latest", "gemini-3.5-flash-lite")
DEFAULT_PRIMARY_MODEL = "gemini-3.1-flash-lite"

KEY_DEAD_SECONDS = 15 * 60
KEY_RATE_LIMIT_SECONDS = 60
MODEL_DEAD_SECONDS = 30 * 60
MODEL_OVERLOADED_SECONDS = 45  # Google answered 503 "high demand": prefer the fallback for a short while


def gemini_keys() -> list[str]:
    """All configured keys, de-duplicated, in priority order."""
    found: list[str] = []

    def add(value: str | None) -> None:
        v = (value or "").strip().strip("'\"")
        if v and v not in found:
            found.append(v)

    add(os.environ.get("GEMINI_API_KEY"))
    add(os.environ.get("GOOGLE_API_KEY"))
    numbered = sorted(
        (k for k in os.environ if re.fullmatch(r"GEMINI_API_KEY_\d+", k)),
        key=lambda k: int(k.rsplit("_", 1)[1]),
    )
    for name in numbered:
        add(os.environ.get(name))
    for part in (os.environ.get("GEMINI_API_KEYS") or "").split(","):
        add(part)
    return found


def gemini_configured() -> bool:
    return bool(gemini_keys())


def model_chain(primary: str | None = None) -> list[str]:
    """Primary model first, then configured fallbacks, then the built-in safe aliases."""
    chain: list[str] = []

    def add(value: str | None) -> None:
        v = (value or "").strip()
        if v and v not in chain:
            chain.append(v)

    add(primary)
    add(os.environ.get("PRIMARY_MODEL"))
    add(os.environ.get("FAST_MODEL"))
    for part in re.split(r"[,\s]+", os.environ.get("GEMINI_FALLBACK_MODELS") or os.environ.get("GEMINI_FALLBACK_MODEL") or ""):
        add(part)
    if not chain:
        add(DEFAULT_PRIMARY_MODEL)
    for fallback in DEFAULT_FALLBACK_MODELS:
        add(fallback)
    return chain


@dataclass
class _Health:
    key_until: dict[int, float] = field(default_factory=dict)  # invalid / disabled keys (all models)
    key_reason: dict[int, str] = field(default_factory=dict)
    rate_until: dict[tuple[int, str], float] = field(default_factory=dict)  # quota is per key AND per model
    model_until: dict[str, float] = field(default_factory=dict)
    last_error: str = ""
    last_ok_model: str = ""
    last_ok_key: int = 0


_health = _Health()


def reset_health() -> None:
    """Clear cooldowns (tests, or after changing keys)."""
    global _health
    _health = _Health()


def _classify(status: int, body: dict[str, Any] | None) -> str:
    """key_dead | key_limited | model_dead | bad_request | transient"""
    err = (body or {}).get("error") or {}
    message = str(err.get("message") or "").lower()
    reason = str(err.get("status") or "").upper()
    if status in (401, 403) or "api key not valid" in message or "api_key_invalid" in message or "leaked" in message:
        return "key_dead"
    if status == 400 and ("api key" in message and ("invalid" in message or "expired" in message)):
        return "key_dead"
    if status == 429 or reason == "RESOURCE_EXHAUSTED":
        return "key_limited"
    if status == 404 or reason == "NOT_FOUND":
        return "model_dead"
    if status == 400:
        return "bad_request"
    return "transient"


@dataclass
class GeminiResult:
    text: str
    model: str
    key_index: int  # 1-based, never the key itself
    attempts: int


async def generate_content(
    *,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
    json_mode: bool = False,
    primary_model: str | None = None,
    timeout: float = 60.0,
    total_budget: float | None = None,
    client: Any = None,
) -> GeminiResult | None:
    """Call Gemini with failover. Returns None only if every key and model failed (or the time budget ran out).

    `total_budget` caps the whole call (default 2x the per-request timeout) so a full outage cannot keep a
    candidate waiting through every key and model one timeout at a time.
    """
    import httpx  # imported lazily so modules that only need the key helpers do not require httpx

    keys = gemini_keys()
    if not keys:
        _health.last_error = "No Gemini API key configured."
        return None
    models = model_chain(primary_model)
    now = time.time()

    combos: list[tuple[str, int]] = []
    for model in models:
        for idx in range(len(keys)):
            combos.append((model, idx))
    ready = [
        (m, i)
        for (m, i) in combos
        if _health.key_until.get(i, 0) <= now
        and _health.rate_until.get((i, m), 0) <= now
        and _health.model_until.get(m, 0) <= now
    ]
    # If every combination is cooling down, try them all anyway rather than failing without a single attempt.
    order = ready or combos

    generation: dict[str, Any] = {"temperature": temperature, "maxOutputTokens": max_tokens}
    if json_mode:
        generation["responseMimeType"] = "application/json"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": generation,
    }

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout)
    started = time.time()
    budget = total_budget if total_budget is not None else timeout * 2
    attempts = 0
    skip_keys_this_call: set[int] = set()
    skip_models_this_call: set[str] = set()
    skip_pairs_this_call: set[tuple[int, str]] = set()
    try:
        for model, idx in order:
            if idx in skip_keys_this_call or model in skip_models_this_call or (idx, model) in skip_pairs_this_call:
                continue
            if attempts and time.time() - started >= budget:
                _health.last_error = (_health.last_error or "") + " (time budget reached)"
                break
            attempts += 1
            try:
                async with _llm_gate():
                    res = await http.post(
                        f"{API_ROOT}/{model}:generateContent",
                        headers={"Content-Type": "application/json", "x-goog-api-key": keys[idx]},
                        json=body,
                    )
            except Exception as err:  # network error / timeout: try the next combination
                _health.last_error = f"key {idx + 1} / {model}: {type(err).__name__}"
                logger.warning("Gemini request failed (%s): key %d, model %s", type(err).__name__, idx + 1, model)
                continue

            if res.is_success:
                try:
                    data = res.json()
                    parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                    text = "".join(p.get("text") or "" for p in parts if not p.get("thought"))
                except Exception:
                    text = ""
                if text.strip():
                    _health.last_ok_model, _health.last_ok_key, _health.last_error = model, idx + 1, ""
                    if attempts > 1:
                        logger.info("Gemini recovered on key %d / %s after %d attempts", idx + 1, model, attempts)
                    return GeminiResult(text=text, model=model, key_index=idx + 1, attempts=attempts)
                _health.last_error = f"key {idx + 1} / {model}: empty response"
                continue

            try:
                payload = res.json()
            except Exception:
                payload = None
            kind = _classify(res.status_code, payload)
            detail = str(((payload or {}).get("error") or {}).get("message") or "")[:140]
            _health.last_error = f"key {idx + 1} / {model}: HTTP {res.status_code} {kind}"
            logger.warning("Gemini HTTP %s (%s) on key %d, model %s: %s", res.status_code, kind, idx + 1, model, detail)
            stamp = time.time()
            if kind == "key_dead":
                _health.key_until[idx] = stamp + KEY_DEAD_SECONDS
                _health.key_reason[idx] = "invalid or disabled"
                skip_keys_this_call.add(idx)
            elif kind == "key_limited":
                retry_after = res.headers.get("retry-after") if hasattr(res, "headers") else None
                wait = int(retry_after) if retry_after and str(retry_after).isdigit() else KEY_RATE_LIMIT_SECONDS
                _health.rate_until[(idx, model)] = stamp + min(max(wait, 5), 300)
                _health.key_reason[idx] = "rate limited"
                skip_pairs_this_call.add((idx, model))
            elif kind == "model_dead":
                _health.model_until[model] = stamp + MODEL_DEAD_SECONDS
                skip_models_this_call.add(model)
            elif kind == "bad_request":
                skip_models_this_call.add(model)  # this model rejected the request; another model may accept it
            elif res.status_code == 503:
                _health.model_until[model] = stamp + MODEL_OVERLOADED_SECONDS
            # other transient errors (5xx etc.): simply move on to the next combination
        return None
    finally:
        if own_client:
            await http.aclose()


def _key_status(i: int, now: float) -> dict[str, Any]:
    dead = _health.key_until.get(i, 0) > now
    limited_models = [m for (k, m), until in _health.rate_until.items() if k == i and until > now]
    all_models = model_chain()
    available = (not dead) and len(limited_models) < len(all_models)
    wait = max(
        [int(_health.key_until.get(i, 0) - now)]
        + [int(until - now) for (k, _m), until in _health.rate_until.items() if k == i and until > now]
        + [0]
    )
    reason = "invalid or disabled" if dead else ("rate limited on " + ", ".join(limited_models) if limited_models else None)
    return {"key": i + 1, "available": available, "coolingDownSeconds": max(0, wait), "reason": reason}


def status_snapshot() -> dict[str, Any]:
    """Safe-to-expose state: counts and cooldowns only, never keys."""
    now = time.time()
    keys = gemini_keys()
    return {
        "keyCount": len(keys),
        "keys": [_key_status(i, now) for i in range(len(keys))],
        "models": model_chain(),
        "unavailableModels": [m for m, t in _health.model_until.items() if t > now],
        "lastError": _health.last_error or None,
        "lastSuccess": {"model": _health.last_ok_model, "key": _health.last_ok_key} if _health.last_ok_model else None,
    }


async def verify_keys(primary_model: str | None = None) -> list[dict[str, Any]]:
    """One tiny call per key and model (stops at the first model that works), so you can see what is really wrong.

    keyWorks: the key authenticated and answered on at least one model.
    A key that fails on the primary model with 503 but works on a fallback is fine: Google is overloaded, not your key.
    """
    import httpx

    results: list[dict[str, Any]] = []
    models = model_chain(primary_model)
    async with httpx.AsyncClient(timeout=20.0) as http:
        for i, key in enumerate(gemini_keys()):
            tried: list[dict[str, Any]] = []
            working: str | None = None
            for model in models:
                try:
                    res = await http.post(
                        f"{API_ROOT}/{model}:generateContent",
                        headers={"Content-Type": "application/json", "x-goog-api-key": key},
                        json={"contents": [{"role": "user", "parts": [{"text": "Reply with: ok"}]}], "generationConfig": {"maxOutputTokens": 8}},
                    )
                    if res.is_success:
                        tried.append({"model": model, "status": res.status_code})
                        working = model
                        break
                    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else None
                    tried.append({"model": model, "status": res.status_code, "problem": _classify(res.status_code, body)})
                    if _classify(res.status_code, body) == "key_dead":
                        break  # no point trying other models with a bad key
                except Exception as err:
                    tried.append({"model": model, "error": type(err).__name__})
            problems = {t_.get("problem") for t_ in tried}
            results.append(
                {
                    "key": i + 1,
                    "keyWorks": working is not None,
                    "workingModel": working,
                    "diagnosis": (
                        "ok" if working and tried[0].get("status") == 200
                        else "primary model overloaded or unavailable; a fallback model works" if working
                        else "key is invalid or disabled" if "key_dead" in problems
                        else "rate limit or quota exhausted" if "key_limited" in problems
                        else "Google is returning errors for every model right now (retry shortly)"
                    ),
                    "tried": tried,
                }
            )
    return results
