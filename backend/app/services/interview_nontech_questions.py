"""Non-technical career interview: turn plan, validation, prompts and the deterministic fallback bank.

The thin wrappers in `interview_llm_questions` (`_turn_plan_non_technical`, `_nontech_text_ok`,
`_stamp_nontech_question`, `_nontech_fallback_meta`, prompts) delegate here. Family data lives in
`interview_role_family.ROLE_FAMILIES`.

Experienced (8 turns): 1 opening, 2 job knowledge (practical), 3 "what would you do" scenario, 4 STAR on competency A,
5 resume metric/result, 6 STAR on competency B, 7 live follow-up on the biggest gap so far, 8 closing.
Fresher (7 turns): the same first five built on internships/college/part-time work, 6 a second scenario on
competency B, 7 closing.
Every turn has a distinct angle; nothing repeats the old "one real case… who else was involved" frame.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.interview_role_family import (
    DEFINITION_RE,
    FOLLOWUP_FRAMES,
    HYPOTHETICAL_RE,
    NON_TECHNICAL_FAMILIES,
    OPENING_ACTIVITY_FRAMES,
    OPENING_BARE_FRAMES,
    OPENING_FRAMES,
    RESULT_BARE_FRAMES,
    RESULT_METRIC_FRAMES,
    RESULT_PLACE_FRAMES,
    STAR_OPENER_RE,
    banned_engineering_terms,
    biggest_gap,
    family_spec,
    pick_competencies,
    pick_item,
    seed_index,
)

MAX_WORDS = 45
GENERIC_RE = re.compile(
    r"tell me about yourself|what are your strengths|\byour strengths\b|\byour weaknesses\b|why should we hire|why should i hire"
    r"|why hire you|where do you see yourself|five[- ]year plan|introduce yourself",
    re.I,
)

KIND_OPENING = "opening"
KIND_KNOWLEDGE = "knowledge"
KIND_SCENARIO = "scenario"
KIND_STAR = "star"
KIND_RESULT = "result"
KIND_FOLLOWUP = "followup"

_PROFILE_BY_KIND = {
    KIND_OPENING: "opening",
    KIND_KNOWLEDGE: "situational",
    KIND_SCENARIO: "situational",
    KIND_STAR: "stakeholder",
    KIND_RESULT: "achievement",
    KIND_FOLLOWUP: "followup",
}
_LOOKFOR_BY_KIND = {
    KIND_OPENING: ["own_action", "result"],
    KIND_KNOWLEDGE: ["situation", "own_action"],
    KIND_SCENARIO: ["situation", "own_action", "stakeholder"],
    KIND_STAR: ["situation", "own_action", "result"],
    KIND_RESULT: ["own_action", "result"],
    KIND_FOLLOWUP: ["own_action", "result"],
}
_CATEGORY_INDEX = {KIND_OPENING: 3, KIND_KNOWLEDGE: 0, KIND_SCENARIO: 1, KIND_STAR: 2, KIND_RESULT: 3, KIND_FOLLOWUP: 2}


def _norm(text: str) -> str:
    from app.services.interview_question_model import normalize_evidence

    return normalize_evidence(text)


def contains_anchor(text: str, anchor: str) -> bool:
    if not anchor:
        return True
    if anchor.lower() in str(text or "").lower():
        return True
    return _norm(anchor) in _norm(text)


def anchor_word(example: str, stem: str) -> str:
    """The natural word in `example` that carries the stem ("priorit" -> "prioritise"), for the prompt."""
    src = example or ""
    low = src.lower()
    i = low.find((stem or "").lower())
    if not stem or i < 0:
        return stem
    k = i
    while k > 0 and low[k - 1].isalpha():
        k -= 1
    j = i + len(stem)
    while j < len(low) and (low[j].isalpha() or low[j] == "-"):
        j += 1
    return src[k:j].strip() or stem


def _family_of(anchors: dict[str, str], family: str | None) -> str:
    fam = family or anchors.get("family") or ""
    return fam if fam in NON_TECHNICAL_FAMILIES else "general_professional"


def _pack(
    *,
    kind: str,
    angle: str,
    family: str,
    purpose: str,
    anchor: str,
    topic: str,
    fallbacks: list[str],
    competency: str = "",
    extra_look: list[str] | None = None,
) -> dict[str, Any]:
    spec = family_spec(family)
    cats = spec["categories"]
    look = list(_LOOKFOR_BY_KIND[kind]) + list(extra_look or [])
    return {
        "purpose": purpose,
        "anchor": anchor,
        "category": cats[_CATEGORY_INDEX[kind]],
        "scoringProfile": _PROFILE_BY_KIND[kind],
        "focus": f"nontech-{angle}",
        "lookFor": look[:4],
        "topic": (topic or kind.title())[:80],
        "kind": kind,
        "angle": angle,
        "competency": competency,
        "family": family,
        "fallbacks": [f for f in fallbacks if f],
    }


def _place_bits(anchors: dict[str, str]) -> tuple[str, str, str]:
    place = (anchors.get("employer") or "").strip()
    title = (anchors.get("title") or "").strip()
    activity = (anchors.get("activity") or "").strip()
    return place, title, activity


def _opening(anchors: dict[str, str], family: str, fresher: bool) -> dict[str, Any]:
    place, title, activity = _place_bits(anchors)
    label = family_spec(family)["label"]
    as_title = f" as {title}" if title else ""
    if place:
        fallbacks = [f.format(place=place, as_title=as_title) for f in OPENING_FRAMES]
        where = f"at {place}{as_title}" + (" (an internship or part-time role)" if fresher else "")
        purpose = (
            f"Opening ({label} role). Ask what they personally owned {where} and what changed because of their work. "
            f'Ava has already greeted them, so do not say hello again. The question must contain "{place}".'
        )
        return _pack(kind=KIND_OPENING, angle="opening", family=family, purpose=purpose, anchor=place, topic=place,
                     fallbacks=fallbacks, extra_look=[f"employer:{place}"])
    if activity:
        fallbacks = [f.format(activity=activity) for f in OPENING_ACTIVITY_FRAMES]
        purpose = (
            f"Opening ({label} role, early career). Ask what they personally took charge of in this college, campus or "
            f"part-time activity from the resume: {activity}. Do not invent a company. Ava has already greeted them. "
            f'The question must contain "{activity}".'
        )
        return _pack(kind=KIND_OPENING, angle="opening", family=family, purpose=purpose, anchor=activity, topic=activity,
                     fallbacks=fallbacks)
    purpose = (
        f"Opening ({label} role). Ask about one piece of work on the resume that was fully their own and how it turned "
        "out. Do not invent a company or employer. Ava has already greeted them."
    )
    return _pack(kind=KIND_OPENING, angle="opening", family=family, purpose=purpose, anchor="", topic="Experience",
                 fallbacks=list(OPENING_BARE_FRAMES))


def _fresher_knowledge(text: str) -> str:
    return re.sub(r"^How do you\b", "How would you", text)


def _knowledge(anchors: dict[str, str], family: str, fresher: bool, seed: str) -> dict[str, Any]:
    spec = family_spec(family)
    items = list(spec["knowledge"])
    i = pick_item(items, seed, "knowledge")
    stem, example = items[i]
    if fresher:
        example = _fresher_knowledge(example)
    ordered = [items[(i + k) % len(items)] for k in range(len(items))]
    fallbacks = [(_fresher_knowledge(t) if fresher else t) for _, t in ordered]
    word = anchor_word(example, stem)
    place, title, _ = _place_bits(anchors)
    context = f" in their work at {place}" if place and not fresher else ""
    who = "They may not have done this job yet: ask how they would do it, or what they learned in internships or college. " if fresher else ""
    purpose = (
        f"Practical job knowledge for a {spec['label']} role{context}: how they actually do this, step by step, and what "
        f"they check. Topic like: \"{example}\" {who}Not a textbook definition, not a story. "
        f'The question must contain the word "{word}".'
    )
    # Every fallback must contain its own anchor; each knowledge item carries its own stem.
    meta = _pack(kind=KIND_KNOWLEDGE, angle="knowledge", family=family, purpose=purpose, anchor=stem,
                 topic=f"{spec['categories'][0]}: {word}", fallbacks=[fallbacks[0]])
    meta["fallbackAnchors"] = [(s, (_fresher_knowledge(t) if fresher else t)) for s, t in ordered]
    return meta


def _scenario(family: str, seed: str, *, salt: str, avoid: str = "", angle: str = "scenario", competency: str = "") -> dict[str, Any]:
    spec = family_spec(family)
    items = [it for it in spec["scenarios"] if it[0] != avoid] or list(spec["scenarios"])
    i = pick_item(items, seed, salt)
    stem, example = items[i]
    ordered = [items[(i + k) % len(items)] for k in range(len(items))]
    word = anchor_word(example, stem)
    purpose = (
        f"A short, realistic \"what would you do\" case from {spec['label']} work, like: \"{example}\" "
        "Describe the situation in one sentence, then ask what they would do (start the ask with \"What would you do\" "
        f"or \"How would you\"). No story question. The question must contain the word \"{word}\"."
    )
    meta = _pack(kind=KIND_SCENARIO, angle=angle, family=family, purpose=purpose, anchor=stem,
                 topic=f"Scenario: {word}", fallbacks=[example], competency=competency)
    meta["fallbackAnchors"] = list(ordered)
    return meta


def _star(family: str, comp: dict[str, str], fresher: bool, others: list[dict[str, str]], angle: str) -> dict[str, Any]:
    spec = family_spec(family)
    text = comp["fresherStar"] if fresher else comp["star"]
    stem = comp["fresherKeyword"] if fresher else comp["keyword"]
    word = anchor_word(text, stem)
    where = (
        "from college, an internship, a part-time job or volunteering (they may have no full-time job yet)"
        if fresher
        else "from their real work"
    )
    purpose = (
        f"Behavioural STAR question on the competency \"{comp['name']}\" for a {spec['label']} role, {where}. "
        "Start with \"Tell me about a time\" or \"Describe a time\". Ask what they did and how it ended. "
        f"Example: \"{text}\" The question must contain the word \"{word}\"."
    )
    pool = [comp] + [c for c in others if c is not comp]
    alts = [((c["fresherKeyword"] if fresher else c["keyword"]), (c["fresherStar"] if fresher else c["star"])) for c in pool]
    meta = _pack(kind=KIND_STAR, angle=angle, family=family, purpose=purpose, anchor=stem,
                 topic=comp["name"].capitalize(), fallbacks=[text], competency=comp["key"])
    meta["fallbackAnchors"] = alts
    return meta


def _result(anchors: dict[str, str], family: str, fresher: bool) -> dict[str, Any]:
    metric = (anchors.get("metric") or "").strip()
    place, _, activity = _place_bits(anchors)
    if metric:
        number = re.search(r"\d[\d,]*(?:\.\d+)?%?", metric)
        anchor = number.group(0) if number else ""
        short = " ".join(metric.split()[:12])
        purpose = (
            f"The result from the resume: {metric}. Ask what THEY personally did to get it and how they knew it worked. "
            + (f'The question must contain "{anchor}". ' if anchor else "")
            + "Do not invent a different number."
        )
        return _pack(kind=KIND_RESULT, angle="result", family=family, purpose=purpose, anchor=anchor, topic=short,
                     fallbacks=[f.format(metric=short) for f in RESULT_METRIC_FRAMES])
    where = place or activity
    if where:
        purpose = (
            f"A measurable result from their own work at {where}"
            + (" (internship, college project or part-time job)" if fresher else "")
            + f". Ask what they did and how they measured it. The question must contain \"{where}\". Do not invent a metric."
        )
        return _pack(kind=KIND_RESULT, angle="result", family=family, purpose=purpose, anchor=where, topic=where,
                     fallbacks=[f.format(place=where) for f in RESULT_PLACE_FRAMES])
    purpose = (
        "A measurable result from work or studies on the resume. Ask what they did and how they knew it worked. "
        "Do not invent a metric or employer."
    )
    return _pack(kind=KIND_RESULT, angle="result", family=family, purpose=purpose, anchor="", topic="Result",
                 fallbacks=list(RESULT_BARE_FRAMES))


def build_plan(
    anchors: dict[str, str],
    *,
    seed: str = "",
    fresher: bool | None = None,
    family: str | None = None,
) -> dict[int, dict[str, Any]]:
    """Six scored turns (1-6). Experienced turn 7 is the live follow-up (`followup_meta`), the last turn is closing."""
    anchors = anchors or {}
    fam = _family_of(anchors, family)
    is_fresher = bool(anchors.get("fresher")) if fresher is None else bool(fresher)
    seed = str(seed or "") or "|".join(str(anchors.get(k) or "") for k in ("employer", "title", "activity"))
    comps = pick_competencies(fam, seed, 2)
    spec = family_spec(fam)
    all_comps = list(spec["competencies"])
    comp_a, comp_b = comps[0], comps[1]
    plan: dict[int, dict[str, Any]] = {
        1: _opening(anchors, fam, is_fresher),
        2: _knowledge(anchors, fam, is_fresher, seed),
        3: _scenario(fam, seed, salt="scenario"),
        4: _star(fam, comp_a, is_fresher, [c for c in all_comps if c is not comp_b], angle=f"star-{comp_a['key']}"),
        5: _result(anchors, fam, is_fresher),
    }
    if is_fresher:
        plan[6] = _scenario(fam, seed, salt="scenario-b", avoid=plan[3]["anchor"], angle=f"scenario-{comp_b['key']}",
                            competency=comp_b["key"])
    else:
        plan[6] = _star(fam, comp_b, False, [c for c in all_comps if c is not comp_a], angle=f"star-{comp_b['key']}")
    return plan


def followup_meta(anchors: dict[str, str], history: list | None = None, *, family: str | None = None) -> dict[str, Any]:
    """Live follow-up turn: one question on the biggest gap in the answers so far (or the last answer if no history)."""
    anchors = anchors or {}
    fam = _family_of(anchors, family)
    stakeholder = anchors.get("stakeholder") or family_spec(fam)["stakeholder"]
    gap = biggest_gap(history) if history else None
    if gap and gap["gap"] != "empty":
        hook = gap["hook"]
        need = {
            "hypothetical": "one REAL case they handled, not what they would do in general",
            "no_own_action": "what THEY personally did, step by step",
            "no_result": "how it ended and how they knew (a result or number)",
            "shallow": "a concrete example with what they did and the result",
            "ok": "one level deeper: what was hardest, or what they would change",
        }.get(gap["gap"], "what they did and the result")
        purpose = (
            f"Live follow-up. The weakest earlier answer was turn {gap['turn']} (question: \"{gap['question'][:160]}\"). "
            f"It was missing: {need}. Ask ONE short question that gets exactly that, referring back to \"{hook}\". "
            f'The question must contain "{hook}". Do not introduce a new topic.'
        )
        frames = FOLLOWUP_FRAMES.get(gap["gap"], FOLLOWUP_FRAMES["shallow"])
        meta = _pack(kind=KIND_FOLLOWUP, angle="followup", family=fam, purpose=purpose, anchor=hook,
                     topic=f"Follow-up: {hook}"[:80], fallbacks=[f.format(hook=hook) for f in frames])
        meta["gap"] = gap["gap"]
        meta["gapTurn"] = gap["turn"]
        return meta
    purpose = (
        "Live follow-up on lastAnswer: find the biggest gap (no personal action, no result, or only what they "
        "\"would\" do) and ask ONE short question that closes it. "
        f'The question must contain "{stakeholder}". Do not introduce a new topic.'
    )
    frames = FOLLOWUP_FRAMES["no_result"]
    hook = f"the {stakeholder}" if not stakeholder.startswith("the ") else stakeholder
    return _pack(kind=KIND_FOLLOWUP, angle="followup", family=fam, purpose=purpose, anchor=stakeholder,
                 topic=stakeholder, fallbacks=[f.format(hook=f"what you told {hook}") for f in frames])


# --------------------------------------------------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------------------------------------------------


def text_problems(text: str, *, family: str = "", kind: str = "", anchor: str = "") -> list[str]:
    """Why a question is not acceptable (empty list = OK)."""
    cleaned = str(text or "").strip()
    problems: list[str] = []
    if len(cleaned) < 24:
        problems.append("too_short")
    if len(cleaned.split()) > MAX_WORDS:
        problems.append("too_long")
    if cleaned.count("?") > 1:
        problems.append("more_than_one_question")
    if GENERIC_RE.search(cleaned):
        problems.append("generic")
    if banned_engineering_terms(cleaned, family or "general_professional"):
        problems.append("engineering_vocabulary")
    if anchor and not contains_anchor(cleaned, anchor):
        problems.append("missing_anchor")
    if kind == KIND_STAR and not STAR_OPENER_RE.search(cleaned):
        problems.append("no_star_opener")
    if kind == KIND_SCENARIO and not HYPOTHETICAL_RE.search(cleaned):
        problems.append("not_hypothetical")
    if kind == KIND_KNOWLEDGE and (DEFINITION_RE.search(cleaned) or STAR_OPENER_RE.search(cleaned)):
        problems.append("definition_or_story")
    return problems


def near_duplicate(text: str, prior: list[str], threshold: float = 0.6) -> bool:
    toks = set(_norm(text).split())
    if not toks:
        return False
    for p in prior or []:
        other = set(_norm(p).split())
        if other and len(toks & other) / len(toks | other) >= threshold:
            return True
    return False


def validate_question(text: str, meta: dict[str, Any], prior: list[str] | None = None) -> bool:
    if text_problems(text, family=str(meta.get("family") or ""), kind=str(meta.get("kind") or ""),
                     anchor=str(meta.get("anchor") or "")):
        return False
    return not near_duplicate(text, prior or [])


def stamp(question: dict[str, Any], meta: dict[str, Any], anchors: dict[str, str]) -> dict[str, Any]:
    keywords = [item for item in (anchors.get("employer"), anchors.get("tool")) if item]
    return {
        **question,
        "questionModel": "non_technical",
        "category": meta["category"],
        "scoringProfile": meta["scoringProfile"],
        "focus": meta["focus"],
        "topic": meta.get("topic") or question.get("topic") or "Experience",
        "keywords": keywords,
        "resumeAnchor": anchors.get("employer") or anchors.get("activity") or "",
        "lookFor": list(meta.get("lookFor") or []),
        "roleFamily": meta.get("family") or anchors.get("family") or "general_professional",
        "questionKind": meta.get("kind") or "",
        "planAngle": meta.get("angle") or "",
        "competency": meta.get("competency") or "",
    }


def fallback_question(
    meta: dict[str, Any], anchors: dict[str, str], prior: list[str] | None = None, seed: str = ""
) -> dict[str, Any]:
    """Deterministic question for a turn (Gemini down / invalid output). Never repeats a prior question."""
    prior = prior or []
    options: list[tuple[str, str]] = []
    for item in meta.get("fallbackAnchors") or []:
        options.append((str(item[0]), str(item[1])))
    for text in meta.get("fallbacks") or []:
        options.append((str(meta.get("anchor") or ""), text))
    if options and seed and not meta.get("fallbackAnchors"):
        start = seed_index("fb", seed, meta.get("angle")) % len(options)
        options = options[start:] + options[:start]
    rotated = options
    chosen_text = ""
    chosen_anchor = str(meta.get("anchor") or "")
    for anchor, text in rotated:
        if not text_problems(text, family=str(meta.get("family") or ""), kind=str(meta.get("kind") or ""), anchor=anchor) and not near_duplicate(text, prior):
            chosen_text, chosen_anchor = text, anchor
            break
    if not chosen_text and rotated:
        chosen_anchor, chosen_text = rotated[0]
    base = {
        "text": chosen_text,
        "keywords": [],
        "hint": "Give one real example: the situation, what you did, and how it ended.",
        "topic": meta.get("topic") or "Experience",
        "focus": meta.get("focus") or "nontech",
        "fallback": True,
    }
    stamped = stamp(base, {**meta, "anchor": chosen_anchor}, anchors)
    stamped["fallback"] = True
    return stamped


# --------------------------------------------------------------------------------------------------------------------
# Prompts
# --------------------------------------------------------------------------------------------------------------------


def rules(level: str, fresher: bool, family: str = "") -> str:
    from app.services.interview_jd_plan import seniority_tier

    tier = seniority_tier(level, fresher)
    pitched = {
        "entry": "entry = what they did and the result; hypotheticals are fine (\"what would you do first?\"); campus, internship and part-time examples count",
        "mid": "mid = the trade-off they faced and who they had to convince; prioritising under constraints",
        "senior": "senior = a missed target, what they changed, who owned the outcome, leading others",
    }[tier]
    fam_line = ""
    if family and family in NON_TECHNICAL_FAMILIES:
        fam_line = f"\n- Job family: {family_spec(family)['label']}. Use the everyday words of that job."
    return f"""Rules:
- This candidate is NOT a software engineer. Never use engineering words: architecture, technical, debug, scalability,
  deploy, code, API, stack, system design, latency, refactor, database, framework. Never ask them to code or write a query.
- Follow each turn's "purpose" exactly; each turn has a different angle:
  job knowledge = how they actually do the work (steps, checks, rules), never a textbook definition;
  scenario = one realistic situation, then "What would you do?";
  behavioural = start with "Tell me about a time" or "Describe a time", one past situation, what they did and the result;
  result = their own part in a number or outcome from the resume.
- The question must contain the word or name the purpose asks for.
- One question, at most two sentences, under 45 words. Never two questions in one.
- No "tell me about yourself", strengths, "why should we hire you", or five-year plan.
- Never invent an employer, tool, quota, metric, or project that is not in the payload.
- Difficulty for this candidate: {pitched}.{fam_line}"""


def system_prompt(*, turn: int, total: int, role: str, level: str, fresher: bool, purpose: str, family: str = "") -> str:
    return f"""You are Ava, a professional interviewer. Generate exactly ONE interview question as JSON only.
Turn {turn} of {total}. Role: {role}. Experience: {level}.
Purpose for this turn: {purpose}
{rules(level, fresher, family)}
Return ONLY: {{"question":{{"text":"...","keywords":["..."],"hint":"...","topic":"..."}}}}"""


def batch_system_prompt(*, total: int, role: str, level: str, fresher: bool, skip: str, family: str = "") -> str:
    return f"""You are Ava, a professional interviewer. Generate the interview questions for this non-technical candidate in ONE JSON response.
Total turns in session: {total}. Role: {role}. Experience: {level}.
{rules(level, fresher, family)}
- Generate exactly one question per turnNumber in the user payload "turns" list and follow that turn's "purpose" exactly.
- {skip}
- Each question must be distinct: different angle, different wording.
- If the payload has "alreadyAsked", those questions are already in the session: never repeat or rephrase them.
Return ONLY: {{"questions":[{{"turnNumber":1,"question":{{"text":"...","keywords":["..."],"hint":"...","topic":"..."}}}}, ...]}}"""
