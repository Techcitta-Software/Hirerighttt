"""Classify a candidate as technical or non-technical from resume evidence only.

No LLM. Never reads an existing questionModel, and never lets the job they are
applying to (roleTrack, job title, job description) vote.
"""

from __future__ import annotations

import re
from typing import Any

_PUNCT_RE = re.compile(r"[^a-z0-9+#]+")
_WS_RE = re.compile(r"\s+")
_INTERNSHIP_RE = re.compile(r"\bintern(?:ship)?s?\b|\bapprentice(?:ship)?\b", re.I)
_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?%?")

_SENIORITY = frozenset(
    {"senior", "sr", "junior", "jr", "lead", "principal", "staff", "associate", "intern", "trainee", "i", "ii", "iii"}
)

_MIXED_RAW = (
    "sales engineer",
    "solutions engineer",
    "solution engineer",
    "pre-sales",
    "presales",
    "sales consultant",
    "solutions consultant",
    "technical account manager",
    "customer engineer",
    "implementation consultant",
    "implementation specialist",
    "product manager",
    "product owner",
    "technical product manager",
    "project manager",
    "program manager",
    "technical recruiter",
    "technical writer",
    "it support",
    "technical support",
    "support engineer",
    "desktop support",
    "data analyst",
    "business analyst",
    "bi analyst",
    "analytics analyst",
    "business intelligence analyst",
    "product designer",
    "ui designer",
    "ux designer",
    "ui/ux",
)
_ANALYST_MIXED = frozenset(
    {"data analyst", "business analyst", "bi analyst", "analytics analyst", "business intelligence analyst"}
)
_DESIGNER_MIXED = frozenset({"product designer", "ui designer", "ux designer", "ui ux"})

_TECH_TITLES_RAW = (
    "software engineer",
    "software developer",
    "sde",
    "swe",
    "full stack",
    "fullstack",
    "frontend developer",
    "front end developer",
    "backend developer",
    "back end developer",
    "web developer",
    "mobile developer",
    "android developer",
    "ios developer",
    "devops",
    "sre",
    "site reliability",
    "data scientist",
    "machine learning engineer",
    "ml engineer",
    "data engineer",
    "qa engineer",
    "sdet",
    "test engineer",
    "embedded engineer",
    "firmware engineer",
    "security engineer",
    "cloud engineer",
    "platform engineer",
    "systems engineer",
    "network engineer",
    "database administrator",
    "dba",
    "solutions architect",
    "software architect",
    "technical architect",
    "ui developer",
    "game developer",
    "blockchain developer",
    "python developer",
    "java developer",
    "react developer",
    "programmer",
)

_NONTECH_TITLES_RAW = (
    "sales executive",
    "sales manager",
    "sales associate",
    "account executive",
    "account manager",
    "business development",
    "bde",
    "customer support",
    "customer service",
    "customer success",
    "client success",
    "support specialist",
    "helpdesk",
    "help desk",
    "call center",
    "contact center",
    "recruiter",
    "talent acquisition",
    "human resources",
    "hr executive",
    "hr manager",
    "hr generalist",
    "operations executive",
    "operations manager",
    "admin executive",
    "administrator",
    "office manager",
    "receptionist",
    "marketing executive",
    "marketing manager",
    "digital marketing",
    "content writer",
    "social media",
    "finance executive",
    "accountant",
    "accounts payable",
    "accounts receivable",
    "payroll",
    "auditor",
    "relationship manager",
    "inside sales",
    "field sales",
    "retail associate",
    "store manager",
    "campus ambassador",
    "admissions counselor",
)

_TECH_SKILLS_RAW = (
    "python",
    "java",
    "javascript",
    "typescript",
    "c++",
    "c#",
    "golang",
    "rust",
    "kotlin",
    "swift",
    "php",
    "ruby",
    "scala",
    "react",
    "angular",
    "vue",
    "node.js",
    "node",
    "django",
    "flask",
    "spring",
    ".net",
    "sql",
    "postgresql",
    "mysql",
    "mongodb",
    "redis",
    "docker",
    "kubernetes",
    "aws",
    "azure",
    "gcp",
    "kafka",
    "graphql",
    "rest",
    "microservices",
    "git",
    "tensorflow",
    "pytorch",
    "spark",
    "hadoop",
    "linux",
    "html",
    "css",
    "android",
    "ios",
    "flutter",
    "selenium",
    "jenkins",
    "ci/cd",
    "data structures",
    "algorithms",
    "system design",
)

_NONTECH_SKILLS_RAW = (
    "salesforce",
    "hubspot",
    "zoho",
    "zendesk",
    "freshdesk",
    "intercom",
    "excel",
    "google sheets",
    "powerpoint",
    "crm",
    "lead generation",
    "cold calling",
    "negotiation",
    "quota",
    "pipeline",
    "ticketing",
    "sla",
    "recruitment",
    "payroll",
    "tally",
    "quickbooks",
    "seo",
    "google ads",
    "facebook ads",
    "content marketing",
    "customer success",
    "onboarding",
    "collections",
    "reconciliation",
    "invoicing",
    "vendor management",
    "sap fico",
)

_ACTIVITY_RE = re.compile(
    r"(?:part[- ]time|on campus|campus|college|university|volunteer)[^\n.]{0,80}",
    re.I,
)


def normalize_evidence(text: str) -> str:
    """Lowercase, punctuation to spaces, collapsed whitespace. + and # stay so c++ / c# survive."""
    lowered = str(text or "").lower()
    return _WS_RE.sub(" ", _PUNCT_RE.sub(" ", lowered)).strip()


def _phrases(raw: tuple[str, ...] | frozenset[str]) -> list[str]:
    seen: list[str] = []
    for item in raw:
        phrase = normalize_evidence(item)
        if phrase and phrase not in seen:
            seen.append(phrase)
    seen.sort(key=len, reverse=True)
    return seen


_MIXED = _phrases(_MIXED_RAW)
_TECH_TITLES = _phrases(_TECH_TITLES_RAW)
_NONTECH_TITLES = _phrases(_NONTECH_TITLES_RAW)
_TECH_SKILLS = _phrases(_TECH_SKILLS_RAW)
_NONTECH_SKILLS = _phrases(_NONTECH_SKILLS_RAW)


def _has_phrase(text: str, phrase: str) -> bool:
    if not text or not phrase:
        return False
    return re.search(rf"(?<![a-z0-9+#]){re.escape(phrase)}(?![a-z0-9+#])", text) is not None


def _has_token(text: str, token: str) -> bool:
    return _has_phrase(text, token)


def _strip_seniority(text: str) -> str:
    return " ".join(tok for tok in text.split() if tok not in _SENIORITY)


def _longest(text: str, phrases: list[str]) -> str:
    for phrase in phrases:
        if _has_phrase(text, phrase):
            return phrase
    return ""


def _find_phrases(text: str, phrases: list[str]) -> list[str]:
    """Greedy longest-phrase match. Each phrase counts once; overlapping spans lose to the longer phrase."""
    if not text:
        return []
    claimed: list[tuple[int, int]] = []
    found: list[str] = []
    for phrase in phrases:
        pattern = re.compile(rf"(?<![a-z0-9+#]){re.escape(phrase)}(?![a-z0-9+#])")
        for match in pattern.finditer(text):
            span = match.span()
            if any(not (span[1] <= start or span[0] >= end) for start, end in claimed):
                continue
            claimed.append(span)
            found.append(phrase)
            break
    return found


def _jobs(profile: dict) -> list[dict]:
    out: list[dict] = []
    for item in profile.get("workExperiences") or []:
        if isinstance(item, dict):
            out.append(item)
    return out


def _job_title(job: dict) -> str:
    return str(job.get("jobTitle") or job.get("title") or "").strip()


def _job_company(job: dict) -> str:
    return str(job.get("company") or "").strip()


def _is_internship(job: dict) -> bool:
    blob = f"{_job_title(job)} {job.get('employmentType') or ''}"
    return bool(_INTERNSHIP_RE.search(blob))


def _real_job(job: dict) -> bool:
    return bool(_job_company(job) or _job_title(job)) and not _is_internship(job)


def deciding_job(profile: dict | None) -> dict | None:
    """First real job. Internships do not decide the title."""
    for job in _jobs(profile or {}):
        if _real_job(job):
            return job
    return None


def deciding_title(profile: dict | None) -> str:
    job = deciding_job(profile)
    if job is not None:
        return _job_title(job)
    return str((profile or {}).get("currentRole") or "").strip()


def career_role_label(profile: dict | None) -> str:
    """Spoken role for a non-technical career interview: current role, else the deciding job, else a neutral label."""
    current = str((profile or {}).get("currentRole") or "").strip()
    if current:
        return current
    job = deciding_job(profile)
    if job is not None and _job_title(job):
        return _job_title(job)
    return "your role"


def _title_strings(profile: dict) -> list[str]:
    titles: list[str] = []
    current = str(profile.get("currentRole") or "").strip()
    if current:
        titles.append(current)
    for job in _jobs(profile):
        title = _job_title(job)
        if title:
            titles.append(title)
    return titles


def _match_title(raw: str) -> tuple[str, str] | None:
    """('tech'|'nontech'|'mixed', phrase) or None. Mixed is checked before strong lists."""
    norm = normalize_evidence(raw)
    if not norm:
        return None
    stripped = _strip_seniority(norm)
    for token in ("developer", "programmer", "sde"):
        if _has_token(norm, token) or _has_token(stripped, token):
            phrase = _longest(norm, _TECH_TITLES) or _longest(stripped, _TECH_TITLES) or token
            return ("tech", phrase)
    mixed = _longest(norm, _MIXED) or _longest(stripped, _MIXED)
    if mixed:
        return ("mixed", mixed)
    tech = _longest(norm, _TECH_TITLES) or _longest(stripped, _TECH_TITLES)
    non = _longest(norm, _NONTECH_TITLES) or _longest(stripped, _NONTECH_TITLES)
    if tech and non:
        return ("tech", tech) if len(tech) >= len(non) else ("nontech", non)
    if tech:
        return ("tech", tech)
    if non:
        return ("nontech", non)
    tokens = set(stripped.split())
    if "engineer" in tokens or "developer" in tokens:
        return ("tech", "engineer" if "engineer" in tokens else "developer")
    return None


def _flatten(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return " ".join(_flatten(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(_flatten(v) for v in value)
    return str(value)


def _skill_blobs(profile: dict) -> list[str]:
    blobs: list[str] = []
    for skill in profile.get("skills") or []:
        text = _flatten(skill).strip()
        if text:
            blobs.append(text)
    for job in _jobs(profile):
        duty = _flatten(job.get("responsibilities") or job.get("description")).strip()
        if duty:
            blobs.append(duty)
    achievements = _flatten(profile.get("achievements")).strip()
    if achievements:
        blobs.append(achievements)
    metrics = _flatten(profile.get("metrics")).strip()
    if metrics:
        blobs.append(metrics)
    resume = str(profile.get("resumeText") or "")[:8000]
    if resume.strip():
        blobs.append(resume)
    return blobs


def _education_blob(profile: dict) -> str:
    return _flatten(profile.get("education"))


def _degree_flags(profile: dict) -> tuple[bool, bool]:
    """(commerce, engineering). Bare 'be'/'ba' only count inside education or an explicit degree abbreviation."""
    edu = normalize_evidence(_education_blob(profile))
    resume_raw = str(profile.get("resumeText") or "")[:8000]
    resume = normalize_evidence(resume_raw)
    blob = f"{edu} {resume}".strip()
    commerce = any(_has_token(blob, token) for token in ("bba", "bcom", "mba", "mcom")) or _has_phrase(blob, "b com") or _has_phrase(blob, "m com")
    engineering = any(_has_token(blob, token) for token in ("btech", "mtech", "mca", "bca")) or _has_phrase(blob, "b tech") or _has_phrase(blob, "m tech")
    if _has_token(edu, "ba") or _has_phrase(edu, "b a"):
        commerce = True
    if _has_token(edu, "be") or _has_phrase(edu, "b e"):
        engineering = True
    if re.search(r"\bB\.?\s*A\.?\b", resume_raw):
        commerce = True
    if re.search(r"\bB\.?\s*E\.?\b", resume_raw) or re.search(r"bachelor of engineering", resume_raw, re.I):
        engineering = True
    if re.search(r"bachelor of arts", resume_raw, re.I):
        commerce = True
    return commerce, engineering


def _result(model: str, confidence: str, reason: str) -> dict[str, str]:
    return {
        "questionModel": model,
        "questionModelConfidence": confidence,
        "questionModelReason": reason[:80],
    }


def _skill_comparison(skill_tech: int, skill_non: int) -> dict[str, str]:
    if skill_tech >= skill_non + 2:
        return _result("technical", "medium", "skill_tech_margin")
    if skill_non >= skill_tech + 2:
        return _result("non_technical", "medium", "skill_nontech_margin")
    return _result("technical", "low", "near_tie_default_technical")


def _thin(profile: dict) -> dict[str, str]:
    commerce, engineering = _degree_flags(profile)
    if commerce and not engineering:
        return _result("non_technical", "low", "thin_commerce_degree")
    return _result("technical", "low", "thin_default_technical")


def classify_question_model(profile: dict | None) -> dict[str, str]:
    """Return questionModel, questionModelConfidence, and a short reason. Ignores any stored questionModel."""
    profile = profile if isinstance(profile, dict) else {}
    # Drop keys that must not vote, even if a caller stuffed the applied job onto the profile.
    profile = {
        k: v
        for k, v in profile.items()
        if k not in {"questionModel", "questionModelConfidence", "questionModelReason", "roleTrack", "jobDescription", "jobTitle"}
    }

    title_hits: list[tuple[str, str]] = []
    for raw in _title_strings(profile):
        hit = _match_title(raw)
        if hit:
            title_hits.append(hit)

    deciding_raw = deciding_title(profile)
    deciding_hit = _match_title(deciding_raw) if deciding_raw else None
    deciding_norm = _strip_seniority(normalize_evidence(deciding_raw))

    tech_titles = list(dict.fromkeys(phrase for kind, phrase in title_hits if kind == "tech"))
    non_titles = list(dict.fromkeys(phrase for kind, phrase in title_hits if kind == "nontech"))

    developer_title = _has_token(deciding_norm, "developer")
    skill_tech: list[str] = []
    skill_non: list[str] = []
    for blob in _skill_blobs(profile):
        norm = normalize_evidence(blob)
        for phrase in _find_phrases(norm, _TECH_SKILLS):
            if phrase not in skill_tech:
                skill_tech.append(phrase)
        for phrase in _find_phrases(norm, _NONTECH_SKILLS):
            if phrase == "salesforce" and developer_title:
                continue
            if phrase not in skill_non:
                skill_non.append(phrase)

    n_tech = len(skill_tech)
    n_non = len(skill_non)
    tech_score = 3 * len(tech_titles) + n_tech
    non_score = 3 * len(non_titles) + n_non
    has_tech_title = bool(tech_titles)
    has_non_title = bool(non_titles)
    no_title = not has_tech_title and not has_non_title

    if deciding_hit and deciding_hit[0] == "mixed":
        phrase = deciding_hit[1]
        if phrase in _ANALYST_MIXED and n_tech >= 3 and n_tech > n_non:
            return _result("technical", "medium", "mixed_analyst_tech_skills")
        if phrase in _DESIGNER_MIXED and n_tech >= 2:
            return _result("technical", "medium", "mixed_designer_tech_skills")
        if phrase in _ANALYST_MIXED:
            return _result("non_technical", "medium", "mixed_analyst")
        if phrase in _DESIGNER_MIXED:
            return _result("non_technical", "medium", "mixed_designer")
        return _result("non_technical", "medium", "mixed_title")

    if has_tech_title and not has_non_title:
        if non_score >= 3 and tech_score == 3:
            return _skill_comparison(n_tech, n_non)
        return _result("technical", "high", "strong_tech_title")

    if has_non_title and not has_tech_title:
        if tech_score >= 3 and non_score == 3:
            return _skill_comparison(n_tech, n_non)
        return _result("non_technical", "high", "strong_nontech_title")

    if (tech_score == 0 and non_score == 0) or (no_title and (n_tech + n_non) < 2):
        return _thin(profile)

    if no_title:
        return _skill_comparison(n_tech, n_non)

    return _skill_comparison(n_tech, n_non)


def apply_question_model(profile: dict) -> dict:
    """Write the three classification keys onto profile and return it."""
    profile.update(classify_question_model(profile))
    return profile


def _first_sentence(text: str, limit: int = 12) -> str:
    cleaned = _WS_RE.sub(" ", str(text or "")).strip()
    if not cleaned:
        return ""
    sentence = re.split(r"(?<=[.!?])\s+|\n", cleaned)[0]
    return " ".join(sentence.split()[:limit]).strip(" .;")


def _anchor_job(profile: dict, *, fresher: bool) -> dict | None:
    if fresher:
        for job in _jobs(profile):
            if _job_company(job) or _job_title(job):
                return job
        return None
    return deciding_job(profile)


def _activity_phrase(profile: dict) -> str:
    edu = profile.get("education") or []
    if isinstance(edu, list):
        for item in edu:
            if isinstance(item, dict):
                institution = str(item.get("institution") or "").strip()
                if institution:
                    return " ".join(institution.split()[:12])
            elif isinstance(item, str) and item.strip():
                return " ".join(item.split()[:12])
    resume = str(profile.get("resumeText") or "")[:8000]
    match = _ACTIVITY_RE.search(resume)
    if match:
        return " ".join(match.group(0).split()[:12])
    return ""


def _stakeholder(*parts: str) -> str:
    blob = normalize_evidence(" ".join(parts))
    if re.search(r"\b(support|success)\b", blob):
        return "customer"
    if re.search(r"\b(sales|account)\b", blob):
        return "buyer"
    if re.search(r"\b(hr|recruiter)\b", blob) or "human resources" in blob:
        return "hiring manager"
    if re.search(r"\b(finance|admin|operations)\b", blob):
        return "vendor"
    if re.search(r"\bmarketing\b", blob):
        return "campaign owner"
    return "the person you were helping"


def _first_metric(profile: dict, job: dict | None) -> str:
    chunks = [_flatten(profile.get("metrics")), _flatten(profile.get("achievements"))]
    if job:
        chunks.append(_flatten(job.get("responsibilities") or job.get("description")))
    for chunk in chunks:
        if re.search(r"\d", chunk or ""):
            return _first_sentence(chunk, 12)
    return ""


def _tool_name(profile: dict, deciding: str) -> str:
    skills = [str(s).strip() for s in (profile.get("skills") or []) if str(s).strip()]
    developer = _has_token(_strip_seniority(normalize_evidence(deciding)), "developer")
    nontech = [p for p in _NONTECH_SKILLS if not (p == "salesforce" and developer)]
    for skill in skills:
        if _find_phrases(normalize_evidence(skill), nontech):
            return skill
    for skill in skills:
        if not _find_phrases(normalize_evidence(skill), _TECH_SKILLS):
            return skill
    return ""


def resume_question_anchors(profile: dict | None, *, fresher: bool) -> dict[str, str]:
    """Employer, tool, duty, and stakeholder used to ground non-technical questions. Nothing is invented."""
    profile = profile if isinstance(profile, dict) else {}
    job = _anchor_job(profile, fresher=fresher)
    employer = _job_company(job) if job else ""
    title = _job_title(job) if job else ""
    activity = ""
    if not employer and not title:
        activity = _activity_phrase(profile)
        employer = ""
    duty = ""
    if job:
        duty = _first_sentence(_flatten(job.get("responsibilities") or job.get("description")))
    metric = _first_metric(profile, job)
    stakeholder = _stakeholder(title, str(profile.get("currentRole") or ""), duty)
    return {
        "employer": employer,
        "title": title,
        "tool": _tool_name(profile, title or deciding_title(profile)),
        "duty": duty,
        "stakeholder": stakeholder,
        "metric": metric,
        "activity": activity,
    }
