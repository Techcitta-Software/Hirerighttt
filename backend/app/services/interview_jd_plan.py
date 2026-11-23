"""JD-first question plan for interviews that come from a recruiter's job link or invite.

Management rule (feedback item 5): when the candidate is interviewing FOR a job with a job description,
  * ~80% of the questions are directly about the JD (required skills, tools, responsibilities),
  * ~20% ask how the candidate's own past work / duties (from the resume) relate to the JD,
  * there is ALWAYS at least one behavioural question,
  * the whole interview is budgeted at 20 minutes.

The mix is decided here, in code, as a list of slots. The LLM only words the questions; `validate_slot_question`
checks every generated question fits its slot, and `fallback_question_for_slot` fills any slot the model could not.
Interviews without a job link keep the original resume-based plan (interview_llm_questions._turn_plan).
"""

from __future__ import annotations

import re
from typing import Any

JD_INTERVIEW_DURATION_MINUTES = 20
# 9 scored questions (~2 minutes each including Ava speaking) + the spoken sign-off = about 20 minutes.
JD_INTERVIEW_SCORED_QUESTIONS = 9
JD_INTERVIEW_TURN_COUNT = JD_INTERVIEW_SCORED_QUESTIONS + 1  # + closing
JD_ALIGNMENT_SHARE = 0.2
MIN_BEHAVIOURAL_QUESTIONS = 1
MIN_JD_CHARS = 40

SLOT_JD = "jd"
SLOT_ALIGNMENT = "jd-alignment"
SLOT_BEHAVIOURAL = "behavioural"
JD_FIRST_FOCUS = "jd-first"

_WORD_RE = re.compile(r"[A-Za-z0-9+#.]+")
_STOP = {
    "the", "and", "for", "that", "this", "with", "you", "your", "are", "was", "were", "have", "has", "how", "what",
    "why", "when", "where", "which", "does", "did", "can", "will", "would", "could", "about", "tell", "explain",
    "describe", "give", "walk", "through", "from", "into", "than", "then", "them", "they", "their", "role", "work",
    "team", "using", "use", "used", "able", "strong", "good", "experience", "knowledge", "skills", "years", "year",
    "including", "such", "like", "other", "well", "also", "within", "across", "must", "should", "ensure", "candidate",
    "job", "we", "our", "us", "a", "an", "of", "to", "in", "on", "or", "as", "is", "be", "it", "at", "by",
}

_RESP_HEADING_RE = re.compile(
    r"(responsibilit|what you.?ll do|what you will do|duties|day[- ]to[- ]day|key result|the role|you will|your role)",
    re.I,
)
_REQ_HEADING_RE = re.compile(r"(requirement|qualification|must have|nice to have|skills|about you|who you are|benefit|perks|about us|salary)", re.I)
_ACTION_START_RE = re.compile(
    r"^(design|build|develop|own|lead|manage|maintain|implement|create|write|deliver|collaborate|work|drive|support|"
    r"improve|optimi[sz]e|monitor|analy[sz]e|review|mentor|coordinate|plan|test|deploy|integrate|ensure|troubleshoot|"
    r"prepare|handle|conduct|define|automate|architect|partner|run|operate|scale|investigate|resolve|document|"
    r"translate|communicate|present|negotiate|sell|recruit|train|track|report)\w*\b",
    re.I,
)

BEHAVIOURAL_RE = re.compile(
    r"\b(tell me about a time|describe a (time|situation)|give (me )?an example|share an example|walk me through a (time|situation)"
    r"|a time (when|you)|a situation (where|when|in which)|have you ever|recall a time|think of a time|when you had to"
    r"|how did you (handle|deal|manage|resolve|respond)|conflict|disagree|pushback|pressure|tight deadline|setback|mistake)\b",
    re.I,
)
_ALIGNMENT_RE = re.compile(
    r"\b(your (resume|cv|experience|work|role|time|project|current|previous|last|recent)|you (have|'ve|worked|built|led|used|handled|did)"
    r"|you.?ve|in your (role|time|work|project)|at your|previous|past|prior|recent role|current role|on your resume)\b",
    re.I,
)


def _tokens(text: str) -> list[str]:
    return [t.lower().strip(".") for t in _WORD_RE.findall(text or "")]


def content_tokens(text: str) -> set[str]:
    return {t for t in _tokens(text) if len(t) > 2 and t not in _STOP}


def seniority_tier(level: str, fresher: bool = False) -> str:
    """entry | mid | senior, from the experience label ("3-5 years", "Senior", "Fresher")."""
    if fresher:
        return "entry"
    text = str(level or "").lower()
    if re.search(r"\b(senior|lead|principal|staff|architect|head|manager|director)\b", text):
        return "senior"
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)]
    years = max(nums) if nums else 2.0
    if years >= 6:
        return "senior"
    if years >= 2.5:
        return "mid"
    return "entry"


DIFFICULTY_BY_TIER = {
    "entry": "Entry level: fundamentals and how the tool/skill is applied in practice; no architecture-at-scale questions.",
    "mid": "Mid level: practical design choices, debugging, trade-offs and why one approach over another.",
    "senior": "Senior level: architecture, scaling, failure modes, trade-offs, ownership and leading others.",
}


def extract_jd_responsibilities(jd: str, limit: int = 4) -> list[str]:
    """Short duty statements from the JD ("Design and maintain REST APIs for ..."), most explicit first.

    Lines under a responsibilities heading win; otherwise any bullet/sentence that starts with an action verb."""
    text = str(jd or "")
    if not text.strip():
        return []
    lines = [ln.strip() for ln in re.split(r"[\r\n]+", text) if ln.strip()]
    under_heading: list[str] = []
    action_lines: list[str] = []
    section = ""
    for raw in lines:
        stripped = re.sub(r"^[\s\-*•●▪\d.)]+", "", raw).strip()
        if not stripped:
            continue
        words = stripped.split()
        is_heading = len(words) <= 6 and (stripped.endswith(":") or not re.search(r"[.;]", stripped)) and (
            _RESP_HEADING_RE.search(stripped) or _REQ_HEADING_RE.search(stripped)
        )
        if is_heading:
            section = "resp" if _RESP_HEADING_RE.search(stripped) and not _REQ_HEADING_RE.search(stripped) else "other"
            continue
        for sentence in re.split(r"(?<=[.;])\s+", stripped):
            sentence = sentence.strip(" .;:")
            n = len(sentence.split())
            if n < 4 or n > 32:
                continue
            if section == "resp":
                under_heading.append(sentence)
            elif _ACTION_START_RE.match(sentence):
                action_lines.append(sentence)
    out: list[str] = []
    for s in under_heading + action_lines:
        if all(s.lower() != o.lower() for o in out):
            out.append(s)
        if len(out) >= limit:
            break
    return out


def jd_question_mix(scored: int = JD_INTERVIEW_SCORED_QUESTIONS) -> dict[str, int]:
    """How many questions of each kind: ~20% alignment, >=1 behavioural, the rest straight from the JD."""
    scored = max(3, int(scored))
    alignment = max(1, round(scored * JD_ALIGNMENT_SHARE))
    behavioural = MIN_BEHAVIOURAL_QUESTIONS
    jd = scored - alignment - behavioural
    return {SLOT_JD: jd, SLOT_ALIGNMENT: alignment, SLOT_BEHAVIOURAL: behavioural}


def _slot_order(mix: dict[str, int]) -> list[str]:
    """Alignment opens (it doubles as the 'tell me about your recent work' opener, tied to the JD), behavioural
    sits mid-interview, the second alignment question comes late; JD questions fill everything else."""
    scored = sum(mix.values())
    order: list[str | None] = [None] * scored
    order[0] = SLOT_ALIGNMENT
    remaining_alignment = mix[SLOT_ALIGNMENT] - 1
    behavioural_positions = [max(1, scored // 2 + i) for i in range(mix[SLOT_BEHAVIOURAL])]
    for pos in behavioural_positions:
        order[min(pos, scored - 1)] = SLOT_BEHAVIOURAL
    pos = scored - 2
    while remaining_alignment > 0 and pos > 0:
        if order[pos] is None:
            order[pos] = SLOT_ALIGNMENT
            remaining_alignment -= 1
        pos -= 1
    return [slot or SLOT_JD for slot in order]


def build_jd_first_plan(
    *,
    job_description: str,
    jd_skills: list[str] | None,
    level: str = "",
    fresher: bool = False,
    resume_jobs: list[str] | None = None,
    scored: int = JD_INTERVIEW_SCORED_QUESTIONS,
) -> list[dict[str, Any]]:
    """One entry per scored turn: {turnNumber, slot, target, purpose}. The closing turn is added by the caller."""
    mix = jd_question_mix(scored)
    order = _slot_order(mix)
    skills = [str(s).strip() for s in (jd_skills or []) if str(s).strip()]
    duties = extract_jd_responsibilities(job_description, limit=4)
    # JD targets alternate skill / duty so the questions cover both what the job uses and what it asks you to do.
    jd_targets: list[dict[str, str]] = []
    si = di = 0
    while len(jd_targets) < mix[SLOT_JD] and (si < len(skills) or di < len(duties)):
        if si < len(skills) and (len(jd_targets) % 3 != 2 or di >= len(duties)):
            jd_targets.append({"kind": "skill", "text": skills[si]})
            si += 1
        elif di < len(duties):
            jd_targets.append({"kind": "responsibility", "text": duties[di]})
            di += 1
    k = 0
    while len(jd_targets) < mix[SLOT_JD]:
        # Short JD: go deeper on the same requirements (a different angle each time) rather than leave the JD.
        base = (skills or duties or ["the core responsibilities described in the job description"])[k % max(1, len(skills or duties or [1]))]
        jd_targets.append({"kind": "skill-deeper" if skills else "responsibility", "text": base})
        k += 1
    align_targets = (skills[:2] + duties[:2]) or ["the main requirements of this job"]
    behaviour_target = duties[0] if duties else (skills[0] if skills else "the responsibilities of this job")
    recent = (resume_jobs or [""])[0] if resume_jobs else ""
    tier = seniority_tier(level, fresher)
    difficulty = DIFFICULTY_BY_TIER[tier]

    plan: list[dict[str, Any]] = []
    ji = ai = 0
    for i, slot in enumerate(order):
        turn = i + 1
        if slot == SLOT_JD:
            target = jd_targets[ji]
            ji += 1
            if target["kind"] == "responsibility":
                purpose = (
                    f'JD responsibility: "{target["text"]}". Ask how the candidate would actually carry out this duty in '
                    "this job: concrete steps, tools, checks and trade-offs. Not a story, not a definition."
                )
            elif target["kind"] == "skill-deeper":
                purpose = (
                    f"JD requirement (second angle): {target['text']}. Ask a harder, different question than any earlier "
                    "one: debugging, failure modes, performance, or choosing between alternatives."
                )
            else:
                purpose = (
                    f"JD required skill/tool: {target['text']}. Ask a specific technical question about how "
                    f"{target['text']} is used for the work in this job description (mechanics, design choices, pitfalls). "
                    "Name the skill in the question."
                )
            purpose += f" {difficulty}"
        elif slot == SLOT_ALIGNMENT:
            target = {"kind": "alignment", "text": align_targets[ai % len(align_targets)]}
            ai += 1
            if turn == 1:
                anchor = f" (most recent: {recent})" if recent else ""
                purpose = (
                    "Opening, tied to the job: ask the candidate to connect their most recent role or project from the "
                    f"resume{anchor} to this job's need for {target['text']}: what they did there that maps to it. "
                    "Ava has already greeted them, so do not say hello."
                )
            else:
                purpose = (
                    "Resume-to-JD alignment: pick a specific project, employer or duty from the resume and ask how it "
                    f"prepared them for this job's requirement '{target['text']}' — what transfers and what would be new. "
                    "Use only facts present in the resume."
                )
        else:
            target = {"kind": "behavioural", "text": behaviour_target}
            purpose = (
                "Behavioural (STAR): ask for ONE specific past situation that shows how the candidate behaves when "
                f"doing work like '{target['text']}' (ownership, conflict, deadline pressure, a mistake, or stakeholder "
                "disagreement). Start with 'Tell me about a time' or 'Describe a situation'."
            )
        plan.append({"turnNumber": turn, "slot": slot, "target": target["text"], "targetKind": target["kind"], "purpose": purpose})
    return plan


def _near_duplicate(a: str, b: str) -> bool:
    ta, tb = content_tokens(a), content_tokens(b)
    if not ta or not tb:
        return a.strip().lower() == b.strip().lower()
    return len(ta & tb) / len(ta | tb) >= 0.6


def validate_slot_question(question: dict[str, Any], slot: dict[str, Any], prior_texts: list[str], jd_text: str = "") -> bool:
    """Does a generated question fit its plan slot? Used to reject and regenerate off-plan output."""
    text = str((question or {}).get("text") or "").strip()
    if len(text) < 24 or len(text.split()) > 70:
        return False
    if any(_near_duplicate(text, p) for p in prior_texts if p):
        return False
    kind = slot.get("slot")
    q_tokens = content_tokens(text)
    if kind == SLOT_BEHAVIOURAL:
        return bool(BEHAVIOURAL_RE.search(text))
    if kind == SLOT_ALIGNMENT:
        return bool(_ALIGNMENT_RE.search(text))
    # JD slot: must be about the target (skill named, or shares the duty's words) and must not be a story question.
    if BEHAVIOURAL_RE.search(text) and re.search(r"\b(tell me about a time|describe a time|a time when)\b", text, re.I):
        return False
    target = str(slot.get("target") or "")
    if target and target.lower() in text.lower():
        return True
    target_tokens = content_tokens(target)
    if target_tokens and (q_tokens & target_tokens):
        return True
    # Generic target ("the core responsibilities ..."): accept any question that clearly uses JD vocabulary.
    jd_tokens = content_tokens(jd_text)
    return not target_tokens and len(q_tokens & jd_tokens) >= 2


def slot_scoring_profile(slot: str) -> str:
    return {SLOT_JD: "technical", SLOT_ALIGNMENT: "project", SLOT_BEHAVIOURAL: "behavioral"}.get(slot, "balanced")


def slot_category(slot: dict[str, Any]) -> str:
    if slot.get("slot") == SLOT_BEHAVIOURAL:
        return "Communication"
    if slot.get("slot") == SLOT_ALIGNMENT:
        return "Experience"
    return "Problem Solving" if slot.get("targetKind") == "responsibility" else "Technical"


def annotate_slot_question(question: dict[str, Any], slot: dict[str, Any]) -> dict[str, Any]:
    """Stamp the plan slot on the question so scoring/reports know what it was for."""
    return {
        **question,
        "category": slot_category(slot),
        "planSlot": slot["slot"],
        "jdTarget": slot.get("target"),
        "scoringProfile": slot_scoring_profile(slot["slot"]),
        "focus": f"{JD_FIRST_FOCUS}-{slot['slot']}",
        "topic": question.get("topic") or slot.get("target") or "Job description",
    }


def fallback_question_for_slot(slot: dict[str, Any], role: str = "") -> dict[str, Any]:
    """Deterministic, still job-specific question for a slot the model failed to fill (never a generic question)."""
    target = str(slot.get("target") or "this role's main requirements")
    kind = slot.get("slot")
    if kind == SLOT_BEHAVIOURAL:
        text = (
            f"Tell me about a time you were responsible for work like {target.rstrip('.')}, and something went wrong "
            "or a deadline was at risk. What did you do, and what was the result?"
        )
    elif kind == SLOT_ALIGNMENT:
        text = (
            f"This job needs {target}. Which part of your past work on your resume is closest to that, what exactly "
            "was your part in it, and what would be new for you here?"
        )
    elif slot.get("targetKind") == "responsibility":
        text = (
            f'The job description says you would "{target.rstrip(".")}". How would you approach that in your first '
            "weeks here — the steps, tools and checks you would use?"
        )
    elif slot.get("targetKind") == "skill-deeper":
        text = f"Thinking about {target} in this job, what is a common failure or performance problem, and how would you diagnose and fix it?"
    else:
        text = f"This job uses {target}. How would you use {target} for the work described here, and what pitfalls would you watch for?"
    q = {
        "text": text,
        "keywords": [target] if len(target) <= 40 else [],
        "hint": "Be specific: name the tools, steps and results.",
        "topic": target if len(target) <= 60 else (role or "Job description"),
        "fallback": True,
    }
    return annotate_slot_question(q, slot)


def plan_mix_counts(questions: list[dict[str, Any]]) -> dict[str, int]:
    counts = {SLOT_JD: 0, SLOT_ALIGNMENT: 0, SLOT_BEHAVIOURAL: 0}
    for q in questions:
        slot = (q or {}).get("planSlot")
        if slot in counts:
            counts[slot] += 1
    return counts


def questions_fit_jd_mix(questions: list[dict[str, Any]]) -> bool:
    """The scored questions follow the JD-first rule: >=1 behavioural, ~20% alignment, the rest on the JD."""
    counts = plan_mix_counts(questions)
    scored = sum(counts.values())
    if scored == 0 or counts[SLOT_BEHAVIOURAL] < MIN_BEHAVIOURAL_QUESTIONS:
        return False
    jd_share = (counts[SLOT_JD] + counts[SLOT_BEHAVIOURAL]) / scored  # the behavioural question is JD-anchored
    return counts[SLOT_ALIGNMENT] >= 1 and jd_share >= 0.7


JOB_LINK_QUESTION_MODES = ("vendor_jd", "employer")


def is_jd_first_interview(*, question_mode: str, job_description: str, invite_token: str | None = None) -> bool:
    """JD-first applies to interviews for a recruiter's job (job link, application or emailed invite) that has a JD.
    A candidate practising against a JD they pasted themselves ("individual_jd") keeps the normal resume plan."""
    has_jd = len(str(job_description or "").strip()) >= MIN_JD_CHARS
    return has_jd and (question_mode in JOB_LINK_QUESTION_MODES or bool(invite_token))
