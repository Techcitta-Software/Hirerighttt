"""The candidate's display name. One rule for the whole product (mirrored in frontend/src/lib/candidateName.ts):

1. The name written on the candidate's resume wins, always (even over the signup name or a name typed elsewhere):
   the parsed resume name (``resumeFullName`` / the AI extract), checked against the resume text, else the name read
   from the top of the resume text.
2. Only without a resume name: the signup (account) name, then a saved profile name, then a name guessed from the
   resume file name, then "Candidate".

All-caps / all-lower resume names are Title-Cased ("KAVYA IYER" -> "Kavya Iyer"); names that already mix cases
("McDonald", "K. Rao") are kept exactly as written. Employer / admin accounts are never renamed.
"""

from __future__ import annotations

import re
from typing import Any

DEMO_ACCOUNT_NAME = "Arjun Sharma"
CANDIDATE_FALLBACK = "Candidate"
NON_CANDIDATE_ROLES = frozenset({"employer", "admin", "vendor", "recruiter"})

# A job title or a technology is not a name ("AI Engineer", "Python Developer").
_NOT_NAME_WORDS = re.compile(
    r"^(?:engineers?|developers?|managers?|analysts?|designers?|architects?|consultants?|scientists?|interns?|"
    r"specialists?|administrators?|executives?|programmers?|testers?|recruiters?|associates?|senior|junior|lead|"
    r"principal|software|frontend|backend|full|stack|fullstack|devops|cloud|web|mobile|data|python|java|javascript|"
    r"typescript|react|node|aws|sql|ai|ml|llms?|rag|resume|curriculum|vitae|profile|summary|objective|skills|"
    r"education|experience|"
    # Products, APIs and tools: a two-column resume read out of order can put "Google Gemini API" where the name is.
    r"apis?|sdks?|gemini|google|bedrock|amazon|openai|gpt|chatgpt|claude|anthropic|nlp|crewai|langchain|fastapi|"
    r"django|flask|spring|postgres(?:ql)?|mysql|mongodb|redis|docker|kubernetes|azure|gcp|linux|git|github|gitlab|"
    r"html|css|streamlit|opencv|tensorflow|pytorch|keras|pandas|numpy|microsoft|excel|tableau|powerbi|generative|"
    r"agentic|machine|learning|vision|computer|lambda|serverless|kafka|graphql|rest|json|jwt|oauth|figma|jira|"
    r"salesforce|oracle|"
    # Degrees, institutions, places and other headings.
    r"bachelor|master|technology|university|institute|college|school|india|hyderabad|bengaluru|bangalore|chennai|"
    r"mumbai|pune|delhi|kolkata|noida|gurgaon|gurugram|certifications?|projects?|languages?|strengths?|core|"
    r"contact|location|present|looking)$",
    re.I,
)
_EMAIL = re.compile(r"([A-Za-z0-9._%+-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_CAP_WORD = re.compile(r"\b([A-Z][a-z]{2,}|[A-Z]{3,})\b")
_SECTION_WORDS = re.compile(
    r"summary|objective|profile|experience|education|skills|projects|contact|declaration|email|phone", re.I
)
_ROLE_LINE = re.compile(
    r"\b(engineer|developer|manager|designer|scientist|analyst|consultant|architect)\b", re.I
)
_NAME_PREFIX = re.compile(
    r"(?:^|\b)(?:full\s*name|name)\s*[:-]\s*([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){1,3})", re.I
)
_HEADER_LABEL = re.compile(r"^(?:curriculum\s+vitae|resume|cv|biodata|profile)\b[:\s-]*", re.I)
_SEGMENT_SPLIT = re.compile(r"[@|•·,;–—()\[\]\d+]")
_FILE_NOISE = re.compile(
    r"\b(resume|cv|biodata|profile|fullstack|frontend|backend|engineer|developer)\b", re.I
)


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def is_demo_name(value: Any) -> bool:
    return _clean(value).lower() == DEMO_ACCOUNT_NAME.lower()


def _fix_word_case(word: str) -> str:
    letters = re.sub(r"[^A-Za-z]", "", word)
    if len(letters) <= 1:
        return word.upper() if len(word) == 1 else word
    if letters != letters.upper() and letters != letters.lower():
        return word  # already mixed case: exactly what the person wrote
    return re.sub(r"(^|['\-.])([a-z])", lambda m: m.group(1) + m.group(2).upper(), word.lower())


def normalize_person_name(value: Any) -> str:
    """'KAVYA  IYER' -> 'Kavya Iyer', "d'souza" -> "D'Souza", 'K. Rao' stays 'K. Rao'."""
    return " ".join(_fix_word_case(w) for w in _clean(value).split())


def name_words(value: Any) -> list[str]:
    return [w for w in re.sub(r"[^a-z\s]", " ", str(value or "").lower()).split() if len(w) >= 2]


def same_name_person(a: Any, b: Any) -> bool:
    """Same person if every word of the shorter name appears in the longer one ("Bharath" vs "Bharath Krishna P")."""
    x, y = name_words(a), name_words(b)
    if not x or not y:
        return False
    short, long_ = (x, y) if len(x) <= len(y) else (y, x)
    return all(w in long_ for w in short)


def looks_like_person_name(value: Any) -> bool:
    words = _clean(value).split()
    if not 1 <= len(words) <= 5:
        return False
    if not all(re.fullmatch(r"[A-Za-z.'-]+", w) for w in words):
        return False
    if any(_NOT_NAME_WORDS.match(w.strip(".")) for w in words):
        return False
    if _SECTION_WORDS.search(" ".join(words)):
        return False
    return any(len(re.sub(r"[^A-Za-z]", "", w)) >= 2 for w in words)


def _email_name_words(text: str, scope: str | None = None) -> list[str]:
    """Capitalised words of the resume that are also part of an email address's local part, in text order.

    People's email addresses almost always contain their name ("pachimatlabharath28@..."), so these words confirm a
    surname that sits on its own line, or locate the name when a two-column PDF is read out of order."""
    locals_ = [re.sub(r"[^a-z]", "", m.lower()) for m in _EMAIL.findall(text)]
    locals_ = [loc for loc in locals_ if loc]
    if not locals_:
        return []
    found: list[str] = []
    for m in _CAP_WORD.finditer((text if scope is None else scope)[:6000]):
        word = m.group(1)
        low = word.lower()
        if _NOT_NAME_WORDS.match(low) or any(low == f.lower() for f in found):
            continue
        if any(low in loc for loc in locals_):
            found.append(word)
    return found


def _already_in_name(words: list[str], extra: str) -> bool:
    """'Souza' is already part of "D'Souza": a word inside an existing name word is not a new name part."""
    e = extra.lower()
    return any(e in re.sub(r"[^a-z]", "", w.lower()) for w in words)


def _name_from_email_hint(text: str) -> str:
    """Resume text in reading-order chaos: the capitalised run around the first email-name word, plus the others."""
    hints = _email_name_words(text)
    if not hints:
        return ""
    tokens = re.findall(r"[A-Za-z][A-Za-z.'-]*|\S", text[:6000])
    for i, tok in enumerate(tokens):
        if tok.lower() != hints[0].lower():
            continue
        run = [tok]
        j = i + 1
        while j < len(tokens) and len(run) < 4:
            nxt = tokens[j]
            follower = tokens[j + 1] if j + 1 < len(tokens) else ""
            if not re.fullmatch(r"[A-Z][a-z]{1,}|[A-Z]{2,}", nxt) or _NOT_NAME_WORDS.match(nxt):
                break
            if re.fullmatch(r"[a-z]+", follower):  # "Looking to build": a sentence starts here, not a name
                break
            run.append(nxt)
            j += 1
        for extra in hints[1:]:
            if len(run) >= 4:
                break
            if not _already_in_name(run, extra):
                run.append(extra)
        candidate = " ".join(run)
        if len(run) >= 2 and looks_like_person_name(candidate):
            return normalize_person_name(candidate)
        return ""
    return ""


def _extend_with_email_hint(name: str, text: str) -> str:
    """'Bharath Krishna' + a surname line 'Pachimatla' that the email also contains -> 'Bharath Krishna Pachimatla'."""
    words = name.split()
    head = "\n".join(text.splitlines()[:15])
    for extra in _email_name_words(text, head):
        if len(words) >= 4:
            break
        if not _already_in_name(words, extra):
            words.append(extra)
    return normalize_person_name(" ".join(words))


def name_from_resume_text(text: Any) -> str:
    """The name at the top of a resume, or "" when none can be read (job titles / tech lists are rejected).

    A surname on its own line, or a two-column resume read out of order, is recovered with the email address."""
    raw = str(text or "")
    name = _name_from_top_lines(raw)
    if name:
        return _extend_with_email_hint(name, raw)
    return _name_from_email_hint(raw)


def _name_from_top_lines(text: str) -> str:
    lines = [ln.strip() for ln in str(text or "").replace("\r", "\n").split("\n") if ln.strip()]
    for i, raw in enumerate(lines[:10]):
        prefixed = _NAME_PREFIX.search(raw)
        if prefixed and looks_like_person_name(prefixed.group(1)):
            return normalize_person_name(prefixed.group(1))
        line = _HEADER_LABEL.sub("", raw).strip()
        segment = _SEGMENT_SPLIT.split(line)[0].strip()
        if not segment or _SECTION_WORDS.search(segment):
            continue
        words = segment.split()
        if any(_NOT_NAME_WORDS.match(w) for w in words):
            continue
        if (
            2 <= len(words) <= 5
            and all(re.fullmatch(r"[A-Za-z.'-]+", w) and (len(w) >= 2 or w.isupper()) for w in words)
            and any(len(w) >= 2 for w in words)
        ):
            return normalize_person_name(segment)
        if (
            len(words) == 1
            and re.fullmatch(r"[A-Za-z]{3,}", words[0])
            and i + 1 < len(lines)
            and _ROLE_LINE.search(lines[i + 1])
        ):
            return normalize_person_name(words[0])
    return ""


def name_in_resume(name: Any, text: Any) -> bool:
    """True when every word of ``name`` is written near the top of the resume (so it really is the resume's name)."""
    words = name_words(name)
    if not words:
        return False
    head = set(name_words("\n".join(str(text or "").splitlines()[:15])))
    return all(w in head for w in words)


def _has_resume_file(p: dict) -> bool:
    return any(_clean(p.get(k)) for k in ("resumeName", "resumeUrl", "resumeStoragePath", "resumeFileId"))


def resume_name(profile: dict[str, Any] | None) -> str:
    """The name on the candidate's current resume, or "" when there is no resume or no readable name on it."""
    p = profile or {}
    text = str(p.get("resumeText") or "")
    parsed = _clean(p.get("resumeFullName"))
    if text.strip():
        if parsed and looks_like_person_name(parsed) and name_in_resume(parsed, text):
            return normalize_person_name(parsed)
        from_text = name_from_resume_text(text)
        if from_text:
            return from_text
        for saved in (p.get("fullName"), p.get("name")):
            s = _clean(saved)
            if s and not is_demo_name(s) and looks_like_person_name(s) and name_in_resume(s, text):
                return normalize_person_name(s)
        return ""
    if parsed and looks_like_person_name(parsed) and _has_resume_file(p):
        return normalize_person_name(parsed)
    return ""


def _name_from_file(resume_file: Any) -> str:
    stem = re.sub(r"\.[^/.]+$", "", _clean(resume_file)).replace("_", " ").replace("-", " ")
    words = [w for w in _FILE_NOISE.sub("", stem).split() if len(w) >= 2 and w.isalpha()]
    if 2 <= len(words) <= 4:
        return " ".join(w.capitalize() for w in words)
    return ""


def resolve_candidate_name(profile: dict[str, Any] | None, account_name: Any = "") -> str:
    """The candidate's name everywhere: the resume name, else the signup name, else a saved name, else 'Candidate'."""
    p = profile or {}
    from_resume = resume_name(p)
    if from_resume:
        return from_resume
    acct = _clean(account_name)
    if acct and not is_demo_name(acct) and acct != CANDIDATE_FALLBACK:
        return acct
    saved = _clean(p.get("fullName")) or _clean(p.get("name"))
    if saved and not is_demo_name(saved) and saved != CANDIDATE_FALLBACK:
        return saved
    return _name_from_file(p.get("resumeName")) or CANDIDATE_FALLBACK


def is_candidate_account(user: dict | None) -> bool:
    return not user or str(user.get("role") or "").lower() not in NON_CANDIDATE_ROLES


def apply_resume_name(profile: dict[str, Any] | None, account_name: Any = "") -> dict[str, Any]:
    """Profile with ``resumeFullName`` / ``fullName`` / ``name`` set from the resume (a contradicting name is dropped)."""
    p = dict(profile or {})
    from_resume = resume_name(p)
    if from_resume:
        p["resumeFullName"] = from_resume
    else:
        p.pop("resumeFullName", None)
    resolved = resolve_candidate_name(p, account_name)
    if resolved != CANDIDATE_FALLBACK:
        p["fullName"] = resolved
        p["name"] = resolved
    return p


def candidate_display_name(
    db: Any, email: Any, *, resume_text: Any = "", given: Any = "", account_name: Any = None
) -> str:
    """Name for a candidate row (applicant lists, reports, emails): the current profile resume's name, else the
    name on the resume attached to the row, else the name the row was created with / the account name / the email."""
    key = str(email or "").strip().lower()
    profile: dict = {}
    if key and db is not None:
        try:
            profile = (db.get("profiles") or {}).get(key) or {}
        except Exception:
            profile = {}
    from_profile = resume_name(profile)
    if from_profile:
        return from_profile
    from_row = resume_name({"resumeText": resume_text, "fullName": given}) if _clean(resume_text) else ""
    if from_row:
        return from_row
    for fallback in (given, account_name, profile.get("fullName"), profile.get("name")):
        f = _clean(fallback)
        if f and f != CANDIDATE_FALLBACK and f.lower() != key:
            return f
    return key or CANDIDATE_FALLBACK
