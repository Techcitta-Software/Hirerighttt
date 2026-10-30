"""LLM batch evaluation for interview answers (correctness, depth, communication)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from app.services.interview_rubric_scoring import classify_question_scoring_profile, _clean


def _gemini_key() -> str:
    return (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("LLM_API_KEY")
        or ""
    ).strip()


def llm_eval_configured() -> bool:
    return bool(_gemini_key())


def _fast_model() -> str:
    return (
        os.environ.get("FAST_MODEL")
        or os.environ.get("ASSESSMENT_EVALUATION_MODEL")
        or os.environ.get("PRIMARY_MODEL")
        or "gemini-2.0-flash"
    )


EVAL_SYSTEM = """You are Ava, HireRight's interview evaluator. Score EACH candidate answer on three dimensions (integers 0–100):

1. correctness — Does the answer address the question accurately and on-topic? For technical questions, is the reasoning sound for the candidate's experience level? Judge meaning, NOT keyword matching. Do not penalize clear paraphrases. Penalize only wrong facts, answers that ignore the question, or claims that contradict the supplied resume snippet. Empty or off-topic answers score below 25.

2. depth — Specificity: tools, steps, trade-offs, metrics, ownership, and completeness. Generic buzzwords without substance score below 40. For freshers, college/personal projects count as valid depth.

3. communication — Clarity and structure for a spoken interview (STAR-style is fine). Do NOT penalize accent or minor grammar. Reward clear, organized answers. Do not conflate low communication with low correctness — if the answer is technically right but brief, correctness can still be high.

Use scoringProfile on each item to calibrate expectations:
- behavioral / opening: communication matters most; correctness is about relevance to the question, not technical precision.
- technical: correctness and depth matter most.
- project / experience: balance all three; reward honest project or work stories.

Return ONLY valid JSON:
{"answers":[{"index":1,"correctness":0-100,"depth":0-100,"communication":0-100,"feedback":"one concise sentence"}]}"""


async def evaluate_answers_with_llm(
    *,
    questions: list[dict[str, Any]],
    answers: list[str],
    ctx: dict[str, Any],
    role: str,
    level: str,
) -> dict[int, dict[str, Any]] | None:
    key = _gemini_key()
    if not key or not questions:
        return None

    items = []
    for i, q in enumerate(questions):
        profile = _clean(q.get("scoringProfile")) or classify_question_scoring_profile(q)
        items.append(
            {
                "index": i + 1,
                "scoringProfile": profile,
                "question": _clean(q.get("text")),
                "category": q.get("category"),
                "topic": q.get("topic"),
                "keywords": (q.get("keywords") or [])[:8],
                "resumeAnchor": q.get("resumeAnchor"),
                "answer": _clean(answers[i] if i < len(answers) else ""),
            }
        )

    user = json.dumps(
        {
            "role": role,
            "level": level,
            "candidate": {
                "skills": (ctx.get("skills") or [])[:16],
                "jobs": (ctx.get("jobs") or [])[:4],
                "resumeSnippet": _clean(ctx.get("resumeSnippet"))[:3200],
            },
            "items": items,
        }
    )

    model = _fast_model()
    is_gemini = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))

    for temperature in (0.12, 0.08):
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                if is_gemini:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                    body = {
                        "systemInstruction": {"parts": [{"text": EVAL_SYSTEM}]},
                        "contents": [{"role": "user", "parts": [{"text": user}]}],
                        "generationConfig": {
                            "temperature": temperature,
                            "responseMimeType": "application/json",
                            "maxOutputTokens": 4096,
                        },
                    }
                    headers = {"Content-Type": "application/json", "x-goog-api-key": key}
                else:
                    base = (os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
                    url = f"{base}/chat/completions"
                    body = {
                        "model": model,
                        "temperature": temperature,
                        "response_format": {"type": "json_object"},
                        "max_tokens": 4096,
                        "messages": [
                            {"role": "system", "content": EVAL_SYSTEM},
                            {"role": "user", "content": user},
                        ],
                    }
                    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}

                res = await client.post(url, headers=headers, json=body)
                if not res.is_success:
                    continue
                data = res.json()
                if is_gemini:
                    parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                    raw = "".join(p.get("text") or "" for p in parts if not p.get("thought"))
                else:
                    raw = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""

                match = re.search(r"\{[\s\S]*\}", raw)
                if not match:
                    continue
                parsed = json.loads(match.group(0))
                rows = parsed.get("answers")
                if not isinstance(rows, list):
                    continue
                by_index: dict[int, dict[str, Any]] = {}
                for row in rows:
                    idx = int(row.get("index") or 0)
                    if not idx:
                        continue
                    by_index[idx] = {
                        "correctness": row.get("correctness"),
                        "depth": row.get("depth"),
                        "communication": row.get("communication"),
                        "feedback": row.get("feedback"),
                    }
                if by_index:
                    return by_index
        except Exception:
            continue
    return None
