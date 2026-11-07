"""Answer-quality gate: stops keyword stuffing, empty and off-topic answers from earning high scores.

Applied to every answer, whether it was scored by the LLM or by the heuristic fallback.
"""

from __future__ import annotations

import re
from typing import Any

_WORD_RE = re.compile(r"[A-Za-z0-9+#.\-]+")

_STOP = {
    "the", "and", "for", "that", "this", "with", "you", "your", "are", "was", "were", "have", "has",
    "how", "what", "why", "when", "where", "which", "does", "did", "can", "will", "would", "could",
    "about", "tell", "explain", "describe", "give", "walk", "through", "between", "difference",
    "your", "resume", "mention", "please", "from", "into", "than", "then", "them", "they", "their",
}

# Attempts to talk the evaluator (an LLM) into a higher score. Answers are untrusted input.
_INJECTION_RE = re.compile(
    r"(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|messages?|directions?|rubric|scoring)\b"
    r"|\b(system|developer)\s+(note|prompt|message|instruction)s?\b"
    r"|\b(note|message)\s+to\s+(the\s+)?(evaluator|grader|scorer|assistant|ai)\b"
    r"|\bcalibration\s+(mode|instruction)\b"
    r"|\b(set|give|output|return|assign)\s+(the\s+)?(correctness|depth|communication|scores?)\b[^.]{0,60}\b(100|full|maximum|max|perfect)\b"
    r"|\bpre-?approved\b|\bscoring\s+rubric\b|\bjson\s+format\b",
    re.I,
)

# Heuristic-only scores are provisional, so they can never reach the top band.
HEURISTIC_CEILING = 75


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _WORD_RE.findall(text or "")]


def _content_tokens(text: str) -> set[str]:
    return {t for t in _tokens(text) if len(t) > 3 and t not in _STOP}


def assess_answer_quality(question: dict[str, Any], answer: str, ctx: dict[str, Any]) -> dict[str, Any]:
    """Return {"flags": [...], "multiplier": 0..1, "cap": int | None, "empty": bool}."""
    text = str(answer or "").strip()
    words = _tokens(text)
    n = len(words)
    flags: list[str] = []

    if n == 0:
        return {"flags": ["empty"], "multiplier": 0.0, "cap": 0, "empty": True}

    multiplier = 1.0
    cap: int | None = None

    # 0. Prompt injection: instructions aimed at the scorer instead of an answer to the question.
    if _INJECTION_RE.search(text):
        return {"flags": ["prompt_injection"], "multiplier": 0.05, "cap": 5, "empty": False}

    # 1. Repetition / keyword stuffing: very low lexical variety in a longer answer.
    if n >= 20:
        unique_ratio = len(set(words)) / n
        if unique_ratio < 0.5:
            flags.append("repetitive")
            multiplier = min(multiplier, 0.25)
            cap = 25 if cap is None else min(cap, 25)

    # 2. Word salad: tech/keyword terms with almost no sentence structure.
    if n >= 25:
        vocab = {str(k).lower() for k in (question.get("keywords") or [])}
        vocab |= {str(s).lower() for s in (ctx.get("skills") or [])}
        vocab = {v for v in vocab if v}
        hits = sum(1 for w in words if w in vocab)
        glue = sum(1 for w in words if w in {"the", "a", "an", "is", "was", "we", "i", "to", "of", "in", "it", "and", "that", "so", "my"})
        if hits / n > 0.35 and glue / n < 0.12:
            flags.append("keyword_stuffing")
            multiplier = min(multiplier, 0.25)
            cap = 25 if cap is None else min(cap, 25)

    # 3. Relevance: the answer shares nothing with the question or the expected topic.
    q_tokens = _content_tokens(str(question.get("text") or ""))
    q_tokens |= {str(k).lower() for k in (question.get("keywords") or []) if len(str(k)) > 3}
    a_tokens = set(words)
    overlap = len(q_tokens & a_tokens)
    skill_overlap = sum(1 for s in (ctx.get("skills") or []) if str(s).lower() in text.lower())
    if n >= 15 and q_tokens and overlap == 0 and skill_overlap == 0:
        flags.append("off_topic")
        multiplier = min(multiplier, 0.4)
        cap = 40 if cap is None else min(cap, 40)

    # 4. Resume recital: the answer is mostly resume sentences read back, not an explanation.
    resume_words = _tokens(str(ctx.get("resumeSnippet") or ""))
    if n >= 25 and len(resume_words) >= 40:
        def grams(ws: list[str], k: int = 4) -> set[tuple[str, ...]]:
            return {tuple(ws[i : i + k]) for i in range(len(ws) - k + 1)}

        answer_grams = grams(words)
        if answer_grams and len(answer_grams & grams(resume_words)) / len(answer_grams) > 0.6:
            flags.append("resume_recital")
            multiplier = min(multiplier, 0.6)
            cap = 55 if cap is None else min(cap, 55)

    return {"flags": flags, "multiplier": multiplier, "cap": cap, "empty": False}


def apply_quality_gate(scores: dict[str, Any], quality: dict[str, Any]) -> dict[str, Any]:
    """Scale/cap each numeric rubric score according to the quality assessment."""
    out = dict(scores)
    for key in ("correctness", "depth", "communication", "roleSkillsFit"):
        val = out.get(key)
        if not isinstance(val, (int, float)):
            continue
        scaled = round(val * quality["multiplier"])
        if quality["cap"] is not None:
            scaled = min(scaled, quality["cap"])
        out[key] = max(0, min(100, scaled))
    return out
