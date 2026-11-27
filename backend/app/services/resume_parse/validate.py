"""Validators: is a value really on the resume, and is a name really a person's name."""

from __future__ import annotations

import re

from app.services.candidate_name import looks_like_person_name, name_from_resume_text, normalize_person_name

_TOKEN = re.compile(r"[a-z0-9]+(?:[+#]+)?")
_NAME_TOKEN = re.compile(r"^[A-Za-z][A-Za-z'’.-]*$|^[A-Z]\.?$")


def tokens(value: str) -> list[str]:
    return _TOKEN.findall(str(value or "").lower().replace("’", "'"))


def page_tokens(text: str) -> set[str]:
    return set(tokens(text))


def overlap(value: str, page: set[str]) -> float:
    """Share of the value's tokens that are written on the page (1.0 = all of them)."""
    t = tokens(value)
    if not t:
        return 0.0
    return sum(1 for x in t if x in page) / len(t)


def on_page(value: str, page: set[str], threshold: float = 0.9) -> bool:
    return bool(str(value or "").strip()) and overlap(value, page) >= threshold


def name_case(value: str) -> str:
    """'PRIYA D'SOUZA' -> "Priya D'Souza", 'MCDONALD' -> 'McDonald', 'K. S. RAMESH' -> 'K. S. Ramesh'."""
    out = []
    for w in normalize_person_name(value).split():
        if re.fullmatch(r"Mc[a-z]{2,}", w):
            w = "Mc" + w[2].upper() + w[3:]
        out.append(w)
    return " ".join(out)


def valid_person_name(name: str, text: str, *, extract: dict | None = None, allow_single: bool = False) -> bool:
    """1-4 (2-4 unless `allow_single`) name words, not a job title / technology / product / heading, not equal to a
    skill, company or job title in the extract, and every word written on the page."""
    n = re.sub(r"\s+", " ", str(name or "")).strip()
    words = n.split()
    if not words or len(words) > 4 or (len(words) == 1 and not allow_single):
        return False
    if not all(_NAME_TOKEN.match(w) for w in words):
        return False
    if not looks_like_person_name(n):
        return False
    if len(words) == 1 and len(re.sub(r"[^A-Za-z]", "", words[0])) < 3:
        return False
    low = n.lower()
    ex = extract or {}
    others = [str(s) for s in ex.get("skills") or []]
    for job in ex.get("workExperiences") or []:
        if isinstance(job, dict):
            others += [str(job.get("company") or ""), str(job.get("jobTitle") or "")]
    others += [str(ex.get("currentRole") or "")]
    if any(low == o.strip().lower() for o in others if o.strip()):
        return False
    page = page_tokens(text)
    return all(t in page for t in tokens(n))


def _email_locals(emails: list[str]) -> list[str]:
    return [re.sub(r"[^a-z]", "", e.split("@", 1)[0].lower()) for e in emails if "@" in e]


def extend_surname(name: str, text: str, emails: list[str]) -> str:
    """'Bharath Krishna' + 'Pachimatla' written on the line next to the name, and in the email local part
    ('bharath.pachimatla@') -> 'Bharath Krishna Pachimatla'. At most one word is added, never one already in the
    name, never a word with dots or digits, never a heading/technology word."""
    words = name.split()
    if not words or len(words) >= 4:
        return name
    locals_ = [loc for loc in _email_locals(emails) if loc]
    if not locals_:
        return name
    lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
    first = words[0].lower()
    for i, ln in enumerate(lines[:40]):
        if first not in ln.lower():
            continue
        if not all(w.lower() in ln.lower() for w in words):
            # the name may itself be split over two lines; the line with its first word anchors the search
            pass
        near = lines[max(0, i - 1): i + 2]
        for nl in near:
            for cand in re.findall(r"\b([A-Z][a-z]{2,}|[A-Z]{3,})\b", nl):
                c = cand.lower()
                if any(c == w.lower() or c in re.sub(r"[^a-z]", "", w.lower()) for w in words):
                    continue
                if not looks_like_person_name(cand) or not any(c in loc for loc in locals_):
                    continue
                # the email must name this person: another name word is in the local part too
                if not any(re.sub(r"[^a-z]", "", w.lower()) in loc for loc in locals_ for w in words if len(w) >= 3):
                    continue
                return name_case(" ".join(words + [cand]))
        break
    return name


def pick_rules_name(text: str, font_candidates: list[str], emails: list[str]) -> tuple[str, str]:
    """(name, source) without a model: the largest text on page 1, else the header rules, else ""."""
    for cand in font_candidates or []:
        n = name_case(cand)
        if valid_person_name(n, text, allow_single=True):
            return extend_surname(n, text, emails), "font"
    from_text = name_from_resume_text(text)
    if from_text:
        # name_from_resume_text may append email words itself; only keep it when it passes the same validator
        n = name_case(from_text)
        if valid_person_name(n, text, allow_single=True):
            return n, "rules"
        base = name_case(" ".join(from_text.split()[:2]))
        if valid_person_name(base, text):
            return base, "rules"
    return "", "none"


def clean_text_field(value, limit: int) -> str:
    v = re.sub(r"\s+", " ", str(value or "")).strip()
    return v[:limit].rstrip()
