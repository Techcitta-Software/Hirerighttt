"""Deterministic resume facts: contact details, dates and experience, places, sections, and a rules-only extract.

Nothing here guesses. A value is returned only when the text shows it; otherwise the field stays empty. The same
rules validate the LLM's answer (merge.py), so a model outage degrades to fewer fields, never to wrong ones.
"""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from app.services.resume_parse.skills_alias import normalize_skill_list

# ---------------------------------------------------------------------------------------------- contact details

EMAIL_RE = re.compile(r"(?<![\w.+-])([A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24})\b")
_PHONE_CANDIDATE = re.compile(r"(?<![\w])(\+?\(?\d[\d\s().-]{7,18}\d)(?![\w])")
URL_RE = re.compile(
    r"\b((?:https?://)?(?:www\.)?(?:linkedin\.com/in/[\w%-]+|github\.com/[\w-]+|gitlab\.com/[\w-]+|behance\.net/[\w-]+|"
    r"dribbble\.com/[\w-]+|medium\.com/@?[\w-]+|kaggle\.com/[\w-]+|leetcode\.com/(?:u/)?[\w-]+|"
    r"[\w-]+\.(?:dev|io|me|in|com|net|org|design|portfolio)(?:/[\w./%-]*)?))",
    re.I,
)


def find_emails(text: str) -> list[str]:
    out: list[str] = []
    for m in EMAIL_RE.finditer(text or ""):
        e = m.group(1).strip(".").lower()
        if e not in out:
            out.append(e)
    return out


@dataclass
class Phone:
    e164: str
    display: str


def _phone_from_digits(raw: str) -> Phone | None:
    digits = re.sub(r"\D", "", raw)
    plus = raw.strip().startswith("+")
    if re.search(r"(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}", raw):
        return None  # "2019 - 2023" is a date range, not a phone number
    # India: +91 / 91 / 0 prefix + a 10-digit mobile starting 6-9
    m = re.fullmatch(r"(?:91|0)?([6-9]\d{9})", digits)
    if m and (plus or len(digits) in (10, 11, 12)):
        if plus and not digits.startswith("91"):
            pass
        else:
            n = m.group(1)
            return Phone(e164=f"+91{n}", display=f"+91 {n[:5]} {n[5:]}")
    # North America: +1 NXX NXX XXXX
    m = re.fullmatch(r"1?([2-9]\d{2})([2-9]\d{2})(\d{4})", digits)
    if m and (plus or len(digits) == 10):
        a, b, c = m.groups()
        if plus and not digits.startswith("1"):
            return None
        return Phone(e164=f"+1{a}{b}{c}", display=f"+1 {a} {b} {c}")
    # Other international numbers written with a "+": keep as written (E.164 digits only).
    if plus and 8 <= len(digits) <= 15:
        return Phone(e164=f"+{digits}", display=re.sub(r"\s+", " ", raw.strip()))
    return None


def find_phones(text: str) -> list[Phone]:
    out: list[Phone] = []
    for m in _PHONE_CANDIDATE.finditer(text or ""):
        raw = m.group(1)
        if re.fullmatch(r"[\d\s]*\d{4}\s*[-–]\s*\d{4}[\d\s]*", raw) and not raw.startswith("+"):
            continue
        ph = _phone_from_digits(raw)
        if ph and all(p.e164 != ph.e164 for p in out):
            out.append(ph)
    return out


def find_links(text: str) -> list[str]:
    out: list[str] = []
    emails = " ".join(find_emails(text))
    for m in URL_RE.finditer(text or ""):
        url = m.group(1).rstrip(".,;)")
        low = url.lower()
        if "@" in low or low in emails or re.fullmatch(r"[\w-]+\.(?:com|in|net|org)", low) and low.split(".")[0] in emails:
            continue
        if re.match(r"^\d", low) or re.fullmatch(r"[a-z]\.[a-z]+", low) or "." not in low:
            continue
        if not re.search(r"linkedin|github|gitlab|behance|dribbble|medium|kaggle|leetcode|/|\.(?:dev|io|me|design)$", low):
            continue
        if low not in (u.lower() for u in out):
            out.append(url)
    return out[:8]


# ---------------------------------------------------------------------------------------------- dates

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11,
    "dec": 12,
}
_MON_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
PRESENT_RE = re.compile(r"^(?:present|current(?:ly)?|now|ongoing|today|till\s*(?:date|now)|to\s*date|date)$", re.I)
_MON = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
    r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_POINT = rf"(?:{_MON}\.?[\s,']*(?:19|20)\d{{2}}|(?:0?[1-9]|1[0-2])\s*[/.-]\s*(?:19|20)\d{{2}}|(?:19|20)\d{{2}})"
_END = rf"(?:{_POINT}|present|current(?:ly)?|now|ongoing|today|till\s*(?:date|now)|to\s*date)"
DATE_RANGE_RE = re.compile(rf"({_POINT})\s*(?:-|–|—|−|to|until|till)\s*({_END})?", re.I)


def today_index(today: date | None = None) -> int:
    d = today or date.today()
    return d.year * 12 + (d.month - 1)


def month_index(value: str, fallback_month: int = 1, today: date | None = None) -> int | None:
    """'May 2026' -> months since year 0; '2022' -> that year's `fallback_month`; 'Present' -> this month."""
    v = (value or "").strip()
    if not v:
        return None
    if PRESENT_RE.match(v):
        return today_index(today)
    y = re.search(r"(?:19|20)\d{2}", v)
    if not y:
        return None
    year = int(y.group(0))
    num = re.search(r"\b(0?[1-9]|1[0-2])\s*[/.-]\s*(?:19|20)\d{2}\b", v) or re.search(r"\b(?:19|20)\d{2}-(0[1-9]|1[0-2])\b", v)
    if num:
        return year * 12 + int(num.group(1)) - 1
    mon = re.search(r"[A-Za-z]{3}", v)
    m = _MONTHS.get(mon.group(0).lower()) if mon else None
    return year * 12 + (m or fallback_month) - 1


def normalize_date(value: str) -> str:
    """'June 2021' -> 'Jun 2021', '07/2020' -> 'Jul 2020', '2022' -> '2022', 'Till date' -> 'Present'."""
    v = re.sub(r"\s+", " ", str(value or "").strip().strip(",.;"))
    if not v:
        return ""
    if PRESENT_RE.match(v):
        return "Present"
    y = re.search(r"(?:19|20)\d{2}", v)
    if not y:
        return ""
    num = re.search(r"\b(0?[1-9]|1[0-2])\s*[/.-]\s*(?:19|20)\d{2}\b", v) or re.search(r"\b(?:19|20)\d{2}-(0[1-9]|1[0-2])\b", v)
    if num:
        return f"{_MON_NAMES[int(num.group(1)) - 1]} {y.group(0)}"
    mon = re.search(rf"\b{_MON}\b", v, re.I)
    if mon:
        return f"{_MON_NAMES[_MONTHS[mon.group(0)[:3].lower()] - 1]} {y.group(0)}"
    return y.group(0)


def date_range_in(line: str) -> tuple[str, str, bool, tuple[int, int]] | None:
    """(start, end, currentlyWorking, span) of the first date range on a line, normalised; else None.

    "2021 –" (an open range at the end of a line) counts as ongoing."""
    for m in DATE_RANGE_RE.finditer(line or ""):
        start = normalize_date(m.group(1))
        raw_end = (m.group(2) or "").strip()
        if not raw_end:
            rest = line[m.end():].strip()
            if rest and not rest.startswith(")"):
                continue  # "2019 - Built..." is not an open range
            end, current = "Present", True
        else:
            end = normalize_date(raw_end)
            current = end == "Present"
        if start and end:
            return start, end, current, m.span()
    return None


def interval(start: str, end: str, current: bool, today: date | None = None) -> tuple[int, int] | None:
    now = today_index(today)
    s = month_index(start, 1, today)
    if s is None or s > now:
        return None
    e = now if current else month_index(end, 12, today)
    e = min(e if e is not None else s, now)
    if e < s:
        return None
    return (s, e + 1)


def merged_months(intervals: list[tuple[int, int]]) -> int:
    total, cur_s, cur_e = 0, -1, -1
    for s, e in sorted(intervals):
        if cur_e < 0 or s > cur_e:
            if cur_e >= 0:
                total += cur_e - cur_s
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    if cur_e >= 0:
        total += cur_e - cur_s
    return total


INTERNSHIP_RE = re.compile(r"\bintern(?:ship)?s?\b|\bapprentice(?:ship)?\b|\bsummer\s+trainee\b|\bindustrial\s+training\b", re.I)
FRESHER_LABEL = "Fresher / 0 years"


def is_internship(job: dict) -> bool:
    return bool(INTERNSHIP_RE.search(f"{job.get('jobTitle') or ''} {job.get('employmentType') or ''}"))


def months_to_label(months: int) -> str:
    years = months / 12
    if years <= 1:
        return "0 – 1 Years"
    if years <= 2:
        return "1 – 2 Years"
    if years <= 3:
        return "2 – 3 Years"
    if years <= 5:
        return "3 – 5 Years"
    if years <= 8:
        return "5 – 8 Years"
    if years <= 12:
        return "8 – 12 Years"
    return "12+ Years"


_STATED = [
    (re.compile(r"(\d{1,2}(?:\.\d+)?)\s*(?:\+|-|–|to)\s*(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+|'\s*)?(?:[a-z-]+\s+){0,3}experience", re.I),
     lambda m: (float(m.group(1)) + float(m.group(2))) / 2 * 12),
    (re.compile(r"(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and\s*)?(\d{1,2})\s*months?)?\s*(?:of\s+|'\s*)?(?:[a-z-]+\s+){0,3}experience", re.I),
     lambda m: float(m.group(1)) * 12 + (int(m.group(2)) if m.group(2) else 0)),
    (re.compile(r"experience\s*(?:of|[:–-])?\s*(?:about\s+|around\s+|over\s+)?(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)", re.I),
     lambda m: float(m.group(1)) * 12),
]


def stated_months(text: str) -> int | None:
    """The resume's own total ("5+ years of experience"); mirrors pickStatedMonths in resumeExperience.ts."""
    t = re.sub(r"\s+", " ", text or "")
    for rx, pick in _STATED:
        m = rx.search(t)
        if m:
            months = pick(m)
            if 0 <= months <= 720:
                return round(months)
    return None


def compute_experience(jobs: list[dict], text: str, today: date | None = None) -> dict:
    """Experience from the job dates (overlaps merged, gaps and internships left out). Mirrors computeExperience in
    frontend/src/lib/resumeExperience.ts so the server and the browser agree on the band."""
    real = [j for j in jobs if (str(j.get("company") or "").strip() or str(j.get("jobTitle") or "").strip()) and not is_internship(j)]
    interns = [j for j in jobs if is_internship(j)]
    stated = stated_months(text)

    def ivs(items: list[dict]) -> list[tuple[int, int]]:
        out = []
        for j in items:
            iv = interval(str(j.get("startDate") or ""), str(j.get("endDate") or ""), bool(j.get("currentlyWorking")), today)
            if iv:
                out.append(iv)
        return out

    intern_months = merged_months(ivs(interns))
    if real:
        dated = merged_months(ivs(real))
        if dated > 0 or (stated or 0) > 0:
            months = max(dated, stated or 0)
            return {"label": months_to_label(months), "months": months, "datedMonths": dated, "internshipMonths": intern_months,
                    "isFresher": False, "source": "job-dates" if dated >= (stated or 0) else "stated"}
        return {"label": months_to_label(6), "months": 0, "datedMonths": 0, "internshipMonths": intern_months,
                "isFresher": False, "source": "undated-job"}
    if stated:
        return {"label": months_to_label(stated), "months": stated, "datedMonths": 0, "internshipMonths": intern_months,
                "isFresher": False, "source": "stated"}
    return {"label": FRESHER_LABEL, "months": 0, "datedMonths": 0, "internshipMonths": intern_months, "isFresher": True,
            "source": "none"}


# ---------------------------------------------------------------------------------------------- places

_DATA = Path(__file__).resolve().parents[3] / "data" / "cities_in.txt"


@functools.lru_cache(maxsize=1)
def city_index() -> dict[str, tuple[str, str]]:
    """lower-case name or alias -> (canonical city, state)."""
    out: dict[str, tuple[str, str]] = {}
    try:
        raw = _DATA.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = (line.split("|") + ["", ""])[:3]
        city, state, aliases = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if not city:
            continue
        out[city.lower()] = (city, state)
        for a in aliases.split(";"):
            if a.strip():
                out[a.strip().lower()] = (city, state)
    return out


_STATES = {
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat", "haryana",
    "himachal pradesh", "jharkhand", "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya",
    "mizoram", "nagaland", "odisha", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana", "tripura",
    "uttar pradesh", "uttarakhand", "west bengal", "delhi", "jammu and kashmir", "ladakh", "puducherry", "chandigarh",
    "india",
}
_US_STATE = re.compile(r"^(?:A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY])$")
_PLACE_WORD = r"[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2}"
_CITY_COMMA = re.compile(rf"({_PLACE_WORD}),\s*({_PLACE_WORD}|[A-Z]{{2}})\b")


def known_city(token: str) -> tuple[str, str] | None:
    return city_index().get(re.sub(r"\s+", " ", (token or "").strip()).lower())


def place_tail(value: str) -> tuple[str, str]:
    """Split a trailing ', City' (or ', City, State') off a company: ('KMC Hospital', 'Mangaluru')."""
    v = re.sub(r"\s+", " ", str(value or "")).strip().strip(",")
    parts = [p.strip() for p in v.split(",")]
    if len(parts) < 2:
        m = re.match(r"^(.*?)\s+[-–—|]\s+(.+)$", v)
        if m and (known_city(m.group(2)) or _is_state_or_country(m.group(2))):
            return m.group(1).strip(), m.group(2).strip()
        return v, ""
    tail: list[str] = []
    while len(parts) > 1 and (known_city(parts[-1]) or _is_state_or_country(parts[-1]) or _US_STATE.match(parts[-1])
                              or (tail and re.fullmatch(_PLACE_WORD, parts[-1]) and len(parts) > 2 and _looks_us_city(parts[-1], tail))):
        tail.insert(0, parts.pop())
    if tail and not any(known_city(t) for t in tail) and not (len(tail) == 2 and _US_STATE.match(tail[-1])):
        # Only a state/country with no city (", India"): still split it off but keep it as the location.
        pass
    return ", ".join(parts).strip(), ", ".join(tail).strip()


def _looks_us_city(word: str, tail: list[str]) -> bool:
    return bool(tail and _US_STATE.match(tail[0]))


def _is_state_or_country(token: str) -> bool:
    t = (token or "").strip().lower()
    return t in _STATES or t in ("usa", "us", "united states", "uk", "united kingdom", "singapore", "uae", "dubai", "remote")


def find_location(header_lines: list[str]) -> str:
    """The candidate's city from the header / contact block: 'Pune, Maharashtra', 'San Francisco, CA', or ''."""
    for line in header_lines:
        for seg in re.split(r"\s*[|•·]\s*|\s{3,}", line):
            seg = seg.strip().strip(",")
            if not seg or "@" in seg or re.search(r"\d{5,}|https?:|\.com|\.in\b|linkedin|github", seg, re.I):
                continue
            seg = re.sub(r"^(?:location|address|city|based in)\s*[:-]\s*", "", seg, flags=re.I)
            m = _CITY_COMMA.search(seg)
            if m:
                city, region = m.group(1).strip(), m.group(2).strip()
                if known_city(city) or region.lower() in _STATES or _US_STATE.match(region) or _is_state_or_country(region):
                    return f"{city}, {region}"
            if known_city(seg) and len(seg.split()) <= 3:
                return seg
    return ""


# ---------------------------------------------------------------------------------------------- sections

SECTION_ALIASES = {
    "summary": r"(?:professional\s+|career\s+|profile\s+)?summary|profile|about(?:\s+me)?|career\s+objective|objective|professional\s+profile",
    "experience": r"(?:work|professional|employment|relevant|industry)\s+(?:experience|history)|experience|employment(?:\s+history)?|work\s+history|career\s+history",
    "internships": r"internships?(?:\s+experience)?",
    "education": r"education(?:al)?(?:\s+(?:qualifications?|background|details))?|academic(?:\s+(?:qualifications?|background|details))?|qualifications?",
    "skills": r"(?:technical\s+|key\s+|core\s+|professional\s+)?skills(?:\s*(?:&|and)\s*(?:tools|technologies|competencies))?|core\s+competencies|competencies|technologies|tech\s+stack|tools(?:\s*(?:&|and)\s*technologies)?|areas\s+of\s+expertise|expertise",
    "certifications": r"certifications?(?:\s*(?:&|and)\s*(?:licen[cs]es|trainings?|courses))?|licen[cs]es(?:\s*(?:&|and)\s*certifications?)?|courses|trainings?",
    "projects": r"(?:academic\s+|personal\s+|key\s+)?projects",
    "achievements": r"achievements|awards(?:\s*(?:&|and)\s*(?:achievements|honou?rs))?|honou?rs|accomplishments",
    "contact": r"contact(?:\s+(?:details|info(?:rmation)?))?|personal\s+details",
    "languages": r"languages(?:\s+known)?",
    "other": r"interests|hobbies|references|declaration|volunteer(?:ing)?|extra[\s-]?curricular(?:\s+activities)?|publications|positions\s+of\s+responsibility",
}
_HEADING = {k: re.compile(rf"^\s*(?:{v})\s*:?\s*$", re.I) for k, v in SECTION_ALIASES.items()}


def heading_of(line: str) -> str | None:
    s = re.sub(r"\s+", " ", line or "").strip()
    if not s or len(s) > 48:
        return None
    for key, rx in _HEADING.items():
        if rx.match(s):
            return key
    return None


def split_sections(lines: list[str]) -> dict[str, list[str]]:
    """{'header': [...lines before the first heading], 'experience': [...], ...} (repeated headings are appended)."""
    out: dict[str, list[str]] = {"header": []}
    cur = "header"
    for ln in lines:
        key = heading_of(ln)
        if key:
            cur = key
            out.setdefault(cur, [])
            continue
        out.setdefault(cur, []).append(ln)
    return out


# ---------------------------------------------------------------------------------------------- jobs

_ROLE_WORDS = re.compile(
    r"\b(engineer|developer|manager|designer|scientist|analyst|consultant|architect|intern|trainee|nurse|teacher|"
    r"lecturer|professor|executive|representative|associate|specialist|administrator|officer|lead|head|director|"
    r"chef|cook|accountant|assistant|coordinator|supervisor|technician|programmer|tester|qa|sde|founder|co-founder|"
    r"president|vp|strategist|marketer|writer|editor|recruiter|advisor|agent|pharmacist|doctor|physician|"
    r"therapist|counsellor|counselor|tutor|instructor|operator|clerk|cashier|steward|captain|sous|commis|"
    r"partner|owner|member|researcher|fellow|apprentice|staff|principal|senior|junior)\b",
    re.I,
)
_BULLET = re.compile(r"^\s*(?:[-•*▪●◦‣–·]|•||\d+[.)])\s*")
_PAST_VERB = re.compile(
    r"^(?:built|led|designed|developed|created|managed|implemented|improved|reduced|increased|delivered|owned|"
    r"wrote|ran|cut|raised|trained|triaged|cared|care|handled|launched|migrated|optimi[sz]ed|automated|introduced|"
    r"redesigned|rebuilt|fixed|worked|achieved|drove|grew|closed|negotiated|mentored|supported|maintained|"
    r"collaborated|conducted|prepared|taught|planned|coordinated|served|administered|performed|assisted|moved)\b",
    re.I,
)
_EMPLOYMENT_TYPE = re.compile(r"\b(full[\s-]?time|part[\s-]?time|contract|freelance|internship|temporary|remote|hybrid)\b", re.I)


def _is_bullet_sentence(line: str) -> bool:
    plain = _BULLET.sub("", line).strip()
    return bool(_PAST_VERB.match(plain)) and len(plain.split()) >= 6


def _split_title_company(head: str) -> tuple[str, str, str]:
    """('Staff Nurse – ICU', 'Father Muller Medical College Hospital', 'Mangaluru') from a job header line."""
    h = re.sub(r"\s+", " ", head).strip(" ,|-–—")
    h = re.sub(r"\((?:[^()]*?)\)\s*$", "", h).strip(" ,|-–—")  # "(Virtual)" / an emptied date bracket
    loc = ""
    # "Title | Company | City"
    if "|" in h:
        parts = [p.strip() for p in h.split("|") if p.strip()]
        if len(parts) >= 3 and (known_city(parts[-1]) or _is_state_or_country(parts[-1]) or re.fullmatch(_PLACE_WORD, parts[-1])):
            loc = parts.pop()
        if len(parts) >= 2:
            title, company = parts[0], " | ".join(parts[1:])
            if not _ROLE_WORDS.search(title) and _ROLE_WORDS.search(company):
                title, company = company, title
            company, tail = place_tail(company)
            return title, company, loc or tail
        h = parts[0] if parts else ""
    # "Title at Company, City"
    m = re.match(r"^(.+?)\s+(?:at|@)\s+(.+)$", h)
    if m and _ROLE_WORDS.search(m.group(1)):
        company, tail = place_tail(m.group(2))
        return m.group(1).strip(), company, tail
    # "Title — Company, City" (em dash / spaced en dash / spaced hyphen separates title and company)
    m = re.match(r"^(.+?)\s+[—–-]\s+(.+)$", h)
    if m:
        left, right = m.group(1).strip(), m.group(2).strip()
        # "Staff Nurse – ICU, Father Muller ..., Mangaluru": the dash is inside the title (department), the comma
        # ends it.
        if "," in right and not _ROLE_WORDS.search(right.split(",")[0]) and len(right.split(",")[0].split()) <= 3 and len(right.split(",")) >= 3:
            dept, rest = right.split(",", 1)
            company, tail = place_tail(rest)
            return f"{left} – {dept.strip()}", company.strip(), tail
        if _ROLE_WORDS.search(left) or not _ROLE_WORDS.search(right):
            company, tail = place_tail(right)
            return left, company, tail
        company, tail = place_tail(left)
        return right, company, tail
    # "Title, Company, City"
    parts = [p.strip() for p in h.split(",") if p.strip()]
    if len(parts) >= 2:
        # A title can contain a comma ("Analyst, Machine Learning"): join while the next part is not a company-ish
        # token and the title has no role word yet.
        company_part, tail = place_tail(", ".join(parts[1:]))
        title = parts[0]
        cparts = [p.strip() for p in company_part.split(",") if p.strip()]
        if len(cparts) >= 2 and not _ROLE_WORDS.search(cparts[0]) and _ROLE_WORDS.search(title) and len(cparts[0].split()) <= 3 and re.match(r"^[A-Z][a-z]", cparts[0]) and not re.search(r"\b(?:ltd|limited|inc|llc|pvt|corp|technologies|solutions|services|labs|systems|software|bank|hospital)\b", cparts[0], re.I):
            title = f"{title}, {cparts[0]}"
            cparts = cparts[1:]
        return title, ", ".join(cparts), tail
    return h, "", ""


def _job_header_score(line: str) -> int:
    if _BULLET.match(line) or _is_bullet_sentence(line):
        return 0
    words = line.split()
    if len(words) > 16:
        return 0
    score = 0
    if _ROLE_WORDS.search(line):
        score += 2
    if re.search(r"\s[|—–]\s|,|\sat\s", line):
        score += 1
    return score


def extract_jobs(lines: list[str], *, internships: bool = False, today: date | None = None) -> list[dict]:
    """Jobs from an experience (or internships) section. A job is a header line with a date range on it or on the
    next line. Lines that are bullets or sentences are responsibilities, never jobs."""
    jobs: list[dict] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        found = date_range_in(line)
        head = None
        dates = None
        if found and _job_header_score(DATE_RANGE_RE.sub("", line).strip(" ()|,–-")) >= 1:
            head, dates = line[: found[3][0]] + line[found[3][1]:], found
        elif found and jobs is not None and i > 0 and not _BULLET.match(line) and len(DATE_RANGE_RE.sub("", line).strip(" ()|,–-")) <= 2:
            prev = lines[i - 1].strip()
            if _job_header_score(prev) >= 1 and not (jobs and jobs[-1].get("_header_index") == i - 1):
                head, dates = prev, found
                # the previous line was counted as a responsibility of the last job: take it back
                if jobs and jobs[-1]["responsibilities"] and jobs[-1]["responsibilities"][-1] == prev:
                    jobs[-1]["responsibilities"].pop()
        elif not found and i + 1 < n and _job_header_score(line) >= 2:
            nxt = date_range_in(lines[i + 1])
            if nxt and len(DATE_RANGE_RE.sub("", lines[i + 1]).strip(" ()|,–-")) <= 24:
                head, dates = line, nxt
                i += 1
        if head is not None and dates is not None:
            head = re.sub(r"\(\s*\)", "", head).strip(" ,|-–—(")
            title, company, loc = _split_title_company(head)
            start, end, current, _ = dates
            if title and len(title.split()) <= 10:
                etype = "Internship" if internships or INTERNSHIP_RE.search(title) else "Full-time"
                m = _EMPLOYMENT_TYPE.search(head)
                if m and not internships:
                    etype = m.group(1).replace("time", "-time").replace("--", "-").title().replace("Full-Time", "Full-time").replace("Part-Time", "Part-time")
                jobs.append({
                    "jobTitle": title.strip(), "company": company.strip(), "employmentType": etype,
                    "startDate": start, "endDate": end, "currentlyWorking": current, "location": loc.strip(),
                    "responsibilities": [], "_header_index": i,
                })
                i += 1
                continue
        if jobs:
            plain = _BULLET.sub("", line).strip()
            if plain:
                jobs[-1]["responsibilities"].append(plain)
        i += 1
    out = []
    for j in jobs:
        j.pop("_header_index", None)
        j["responsibilities"] = "\n".join(j["responsibilities"])[:1500]
        out.append(j)
    return out


def sort_jobs(jobs: list[dict], today: date | None = None) -> list[dict]:
    """Most recent first (a current job first), ties keep the page order."""
    now = today_index(today)

    def key(item: tuple[int, dict]) -> tuple[int, int]:
        idx, j = item
        end = now + 1 if j.get("currentlyWorking") else (month_index(str(j.get("endDate") or ""), 12, today) or month_index(str(j.get("startDate") or ""), 1, today) or -1)
        return (-end, idx)

    return [j for _, j in sorted(enumerate(jobs), key=key)]


# ---------------------------------------------------------------------------------------------- education

_DEGREE = re.compile(
    r"\b(?:b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b\.?|m\.?\s?e\b\.?|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|b\.?\s?a\b\.?|m\.?\s?a\b\.?|"
    r"b\.?\s?des|m\.?\s?des|b\.?\s?ed|m\.?\s?ed|bba|mba|pgdm|pgdba|bca|mca|ph\.?\s?d|m\.?\s?phil|b\.?\s?pharm|m\.?\s?pharm|"
    r"mbbs|md\b|bds|llb|ll\.?m|b\.?\s?arch|diploma|bachelor(?:'s)?|master(?:'s)?|associate\s+degree|doctorate|"
    r"hsc|ssc|class\s+(?:x|xii|10|12)(?:th)?|(?:10|12)th|higher\s+secondary|secondary|intermediate|hotel\s+management|"
    r"b\.?\s?s\b\.?|m\.?\s?s\b\.?|gnm|anm|ca\s+inter|chartered\s+accountant)",
    re.I,
)
_INSTITUTION = re.compile(r"\b(university|institute|college|school|academy|iit|nit|iiit|iim|bits|polytechnic|vidyalaya|campus)\b", re.I)
_YEAR = re.compile(r"\b((?:19|20)\d{2})\b")


def extract_education(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    i = 0
    while i < len(lines):
        line = _BULLET.sub("", lines[i]).strip()
        if not _DEGREE.search(line) and not _INSTITUTION.search(line):
            i += 1
            continue
        block = line
        # a degree line followed by its institution (and/or years) on the next line(s)
        j = i + 1
        while j < len(lines) and j <= i + 2 and not _DEGREE.search(lines[j]) and (
            _INSTITUTION.search(lines[j]) or re.fullmatch(r"[\s\d()–\-/.,|%:A-Za-z]*\b(?:19|20)\d{2}\b[\s\d()–\-/.,|%:A-Za-z]*", lines[j]) and len(lines[j]) <= 40
        ):
            if _DEGREE.search(block) or _INSTITUTION.search(lines[j]) or _YEAR.search(lines[j]):
                block += " , " + lines[j].strip()
                j += 1
            else:
                break
        years = _YEAR.findall(block)
        text = re.sub(r"\((?:cgpa|gpa|percentage|score)?[^()]*\)", "", block, flags=re.I)
        text = re.sub(r"\b(?:19|20)\d{2}\b\s*(?:[-–—]|to)?\s*(?:(?:19|20)\d{2}|present)?", "", text, flags=re.I)
        text = re.sub(r"\b(?:cgpa|gpa)\s*[:\-]?\s*[\d.]+(?:\s*/\s*\d+)?|\b\d{2,3}(?:\.\d+)?\s*%", "", text, flags=re.I)
        parts = [p.strip(" ,|-–—:;") for p in re.split(r"\s+[|–—-]\s+|\s*,\s*|\s+\|\s*", text) if p.strip(" ,|-–—:;")]
        degree_parts: list[str] = []
        inst = ""
        for p in parts:
            if not inst and _INSTITUTION.search(p) and not _DEGREE.match(p):
                inst = p
            elif not inst:
                degree_parts.append(p)
            elif inst and known_city(p) is None and not _is_state_or_country(p) and len(degree_parts) == 0:
                degree_parts.append(p)
        degree = ", ".join(degree_parts[:2]).strip()
        if not inst and len(degree_parts) >= 2 and _DEGREE.search(degree_parts[0]):
            degree, inst = degree_parts[0], degree_parts[1]
        if degree and _DEGREE.search(degree):
            out.append({
                "degree": degree,
                "institution": inst,
                "startYear": years[0] if len(years) >= 2 else "",
                "endYear": years[-1] if years else "",
            })
        i = j
    return out[:8]


# ---------------------------------------------------------------------------------------------- skills, certs

def extract_skills(lines: list[str]) -> list[str]:
    items: list[str] = []
    for ln in lines:
        plain = _BULLET.sub("", ln).strip()
        if not plain:
            continue
        # "Languages: Python, Java" -> the part after the label
        m = re.match(r"^([A-Za-z &/]{2,30}):\s*(.+)$", plain)
        if m:
            plain = m.group(2)
        for part in re.split(r"\s*[,;|•·]\s*|\s{2,}|\s+/\s+", _protect_parens(plain)):
            part = part.replace("\u0001", ",").strip(" .-–")
            if part:
                items.append(part)
    return normalize_skill_list(items)


def _protect_parens(text: str) -> str:
    """Commas inside "SQL (PostgreSQL, SQL Server)" do not split the item."""
    out, depth = [], 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        out.append("\u0001" if ch == "," and depth else ch)
    return "".join(out)


def extract_certifications(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    for ln in lines:
        plain = _BULLET.sub("", ln).strip()
        if not plain or len(plain) > 160:
            continue
        # Several certifications on one line: "AWS SAA (2023); CKA (2022)" / "A | B | C" / "A, B, C" (short items)
        pieces = re.split(r"\s*[;|•]\s*", plain)
        commas = [p.strip() for p in plain.split(",")]
        if len(pieces) == 1 and len(commas) >= 4 and all(1 <= len(p.split()) <= 6 for p in commas) and not any(
            re.fullmatch(r"(?:19|20)\d{2}", p) for p in commas
        ):
            pieces = commas
        for piece in pieces:
            piece = piece.strip(" ,.")
            if not piece:
                continue
            year = _YEAR.search(piece)
            name_org = re.sub(r"[,(]?\s*\b(?:19|20)\d{2}\b\s*\)?", "", piece).strip(" ,–-")
            m = re.match(r"^(.+?)\s+[–—-]\s+(.+)$", name_org) or re.match(r"^(.+?)\s*,\s*(.+)$", name_org)
            name, org = (m.group(1).strip(), m.group(2).strip()) if m else (name_org, "")
            if name:
                out.append({"name": name, "organization": org, "dateEarned": year.group(1) if year else "", "credentialId": ""})
    return out[:20]


# ---------------------------------------------------------------------------------------------- rules extract

def header_block(lines: list[str], sections: dict[str, list[str]]) -> list[str]:
    head = list(sections.get("header") or [])[:10]
    contact = list(sections.get("contact") or [])[:8]
    return head + contact


def rules_extract(text: str, *, name_candidates: list[str] | None = None, today: date | None = None) -> dict:
    """Everything the text shows, without a model. Each field is empty when the text does not show it."""
    from app.services.resume_parse.validate import pick_rules_name

    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    sections = split_sections(lines)
    header = header_block(lines, sections)
    emails = find_emails(text)
    phones = find_phones(text)
    jobs = extract_jobs(sections.get("experience") or [], today=today)
    jobs += extract_jobs(sections.get("internships") or [], internships=True, today=today)
    jobs = sort_jobs(jobs, today)
    education = extract_education(sections.get("education") or [])
    skills = extract_skills(sections.get("skills") or [])
    certs = extract_certifications(sections.get("certifications") or [])
    name, name_source = pick_rules_name(text, name_candidates or [], emails)
    location = find_location(header) or find_location(lines[:14])
    summary = " ".join(sections.get("summary") or [])[:500]
    headline = _headline(lines, name)
    current_role = ""
    real = [j for j in jobs if not is_internship(j)]
    if real:
        current_role = real[0]["jobTitle"]
    elif headline:
        current_role = headline
    achievements = [_BULLET.sub("", a).strip() for a in (sections.get("achievements") or []) if _BULLET.sub("", a).strip()][:12]
    return {
        "fullName": name,
        "_nameSource": name_source,
        "email": emails[0] if emails else "",
        "phone": phones[0].display if phones else "",
        "phoneE164": phones[0].e164 if phones else "",
        "links": find_links("\n".join(header) + "\n" + text[:3000]),
        "currentRole": current_role,
        "headline": headline,
        "currentLocation": location,
        "skills": skills,
        "workExperiences": jobs,
        "education": education,
        "certifications": certs,
        "achievements": achievements,
        "experienceSummary": summary,
        "whoAreYou": summary[:300],
        "_sections": {k: len(v) for k, v in sections.items()},
    }


def _headline(lines: list[str], name: str) -> str:
    """The title line right under the name ("Senior Product Designer", "REGISTERED NURSE (RN) | ICU ...")."""
    if not name:
        return ""
    first = name.split()[0].lower()
    for i, ln in enumerate(lines[:30]):
        if first in ln.lower() and len(ln.split()) <= 5:
            for nxt in lines[i + 1:i + 3]:
                if "@" in nxt or re.search(r"\d{5}", nxt) or heading_of(nxt):
                    continue
                cand = re.split(r"\s+\|\s+", nxt)[0].strip()
                if _ROLE_WORDS.search(cand) and len(cand.split()) <= 6:
                    return cand if not cand.isupper() else cand.title()
            break
    return ""
