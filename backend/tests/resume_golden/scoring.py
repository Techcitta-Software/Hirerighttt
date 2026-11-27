"""Per-field scoring of a parsed resume against a golden expected.json (plan 3.7 "Metrics").

Pure Python, no app imports, so the same code serves pytest, scripts/resume_eval.py and scripts/resume_fixtures/build.py.
The TS mirror is frontend/src/lib/resumeGolden.test.ts (keep the two in step).

Fields and how they are compared
  name        case-insensitive exact match after whitespace/apostrophe normalisation ("name_case" also checks case)
  nonperson   a wrong, non-empty name that shares no token with the person's name, or contains a skill/company/title
              token of the same resume ("Adobe Xd", "Gemini API", "Senior Product Designer") — must be 0
  email       lower-case exact; phone: same national number (last 10 digits) and country code when given
  location    same city (first comma part; Bengaluru == Bangalore etc.)
  role        normalised exact match against currentRole or one of currentRole_alt
  band        totalExperience band (recomputed from the expected job dates "as of today")
  months      experienceMonths within +-2 of the merged-interval months
  jobs        F1 over (title, company) pairs, fuzzy ratio >= 0.9 on both (company with a city tail does NOT match)
  dates       exact (normalised) start and end on matched jobs
  edu         F1 over (degree, institution), fuzzy >= 0.85 on alnum-only text
  skills      F1: recall against the expected list, precision = predicted skills that match it or occur on the page
              (<= 4 words, so sentences never count)
  certs       F1 on certification names, fuzzy >= 0.85
"""

from __future__ import annotations

import datetime as _dt
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

# ── gates (plan 3.7 "CI gates") ───────────────────────────────────────────────────────────────────────────────

GATES: dict[str, dict[str, float]] = {
    "full": {
        "name": 1.0, "nonperson_max": 0, "email": 1.0, "phone": 1.0, "location": 0.96, "role": 0.92,
        "jobs_f1": 0.95, "dates": 0.95, "edu_f1": 0.92, "skills_f1": 0.85, "band": 0.92,
    },
    "rules": {
        "name": 0.96, "nonperson_max": 0, "email": 1.0, "phone": 1.0, "location": 0.85, "role": 0.80,
        "jobs_f1": 0.80, "dates": 0.85, "edu_f1": 0.80, "skills_f1": 0.75, "band": 0.80,
    },
}

PRESENT_RE = re.compile(r"^(present|current(ly)?|till\s*date|to\s*date|now|ongoing|today|date)$", re.I)
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

CITY_ALIASES = {
    "bangalore": "bengaluru", "gurgaon": "gurugram", "bombay": "mumbai", "trivandrum": "thiruvananthapuram",
    "cochin": "kochi", "ernakulam": "kochi", "mangalore": "mangaluru", "panjim": "panaji", "calcutta": "kolkata",
    "madras": "chennai", "poona": "pune", "sf": "san francisco",
}

SKILL_ALIASES = {
    "reactjs": "react", "react js": "react", "react.js": "react", "nodejs": "node.js", "node": "node.js", "node js": "node.js",
    "ms excel": "excel", "microsoft excel": "excel", "advanced excel": "excel", "k8s": "kubernetes", "postgres": "postgresql",
    "js": "javascript", "ts": "typescript", "golang": "go", "nextjs": "next.js", "next js": "next.js",
    "sklearn": "scikit-learn", "spark": "apache spark", "tally": "tally erp", "tally erp 9": "tally erp",
    "salesforce": "salesforce crm", "aws sagemaker": "sagemaker", "amazon web services": "aws",
    "tailwind": "tailwind css", "adobe xd": "adobe xd", "power bi": "power bi", "powerbi": "power bi",
}


# ── normalisation ─────────────────────────────────────────────────────────────────────────────────────────────


def _s(value: Any) -> str:
    return "" if value is None else str(value)


def fold(value: Any) -> str:
    """Lower-case, NFKC, unify dashes/quotes, collapse whitespace."""
    v = unicodedata.normalize("NFKC", _s(value))
    v = v.replace("’", "'").replace("‘", "'").replace("`", "'")
    v = re.sub(r"[‐-―−]", "-", v)
    return re.sub(r"\s+", " ", v).strip().lower()


def alnum(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", fold(value))


def norm_name(value: Any) -> str:
    v = unicodedata.normalize("NFKC", _s(value)).replace("’", "'")
    v = re.sub(r"\s*\.\s*", ". ", v)
    return re.sub(r"\s+", " ", v).strip().rstrip()


def phone_digits(value: Any) -> str:
    return re.sub(r"\D+", "", _s(value))


def city_of(value: Any) -> str:
    v = fold(value)
    v = re.split(r"[,|/(]", v)[0].strip()
    v = re.sub(r"\b(india|usa|us)\b", "", v).strip(" -")
    return CITY_ALIASES.get(v, v)


def norm_role(value: Any) -> str:
    v = fold(value)
    v = re.sub(r"\s*[-|,]\s*$", "", v)
    return re.sub(r"[^a-z0-9/&+#]+", " ", v).strip()


def norm_band(value: Any) -> str:
    return re.sub(r"\s+", " ", fold(value).replace("-", " - ")).strip()


def norm_date(value: Any) -> str:
    """'June 2021' -> 'Jun 2021'; '06/2021' -> 'Jun 2021'; '2021' -> '2021'; 'Till date' -> 'Present'; '' -> ''."""
    v = fold(value).strip(" .,()")
    if not v:
        return ""
    if PRESENT_RE.match(v):
        return "Present"
    year = re.search(r"(19|20)\d{2}", v)
    if not year:
        return v
    iso = re.search(r"((?:19|20)\d{2})-(0[1-9]|1[0-2])", v)
    if iso:
        return f"{MONTH_NAMES[int(iso.group(2)) - 1]} {iso.group(1)}"
    num = re.search(r"\b(0?[1-9]|1[0-2])\s*[/.-]\s*(?:19|20)\d{2}", v)
    if num:
        return f"{MONTH_NAMES[int(num.group(1)) - 1]} {year.group(0)}"
    mon = re.search(r"[a-z]{3}", v)
    if mon and mon.group(0) in MONTHS:
        return f"{MONTH_NAMES[MONTHS[mon.group(0)]]} {year.group(0)}"
    return year.group(0)


def ratio(a: Any, b: Any) -> float:
    a, b = fold(a), fold(b)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def alnum_ratio(a: Any, b: Any) -> float:
    a, b = alnum(a), alnum(b)
    if not a or not b:
        return 1.0 if a == b else 0.0
    return SequenceMatcher(None, a, b).ratio()


def skill_key(value: Any) -> str:
    v = fold(value)
    v = re.sub(r"\s*\(.*?\)\s*", " ", v).strip()
    return SKILL_ALIASES.get(v, v)


# ── experience (port of frontend/src/lib/resumeExperience.ts) ─────────────────────────────────────────────────

INTERN_RE = re.compile(r"\bintern(ship)?s?\b|\bapprentice(ship)?\b|\bsummer\s+trainee\b|\bindustrial\s+training\b", re.I)
BANDS = ["Fresher / 0 years", "0 – 1 Years", "1 – 2 Years", "2 – 3 Years", "3 – 5 Years", "5 – 8 Years", "8 – 12 Years", "12+ Years"]


def month_index(value: Any, fallback_month: int, now: _dt.date) -> int | None:
    v = norm_date(value)
    if not v:
        return None
    if v == "Present":
        return now.year * 12 + now.month - 1
    m = re.match(r"([A-Z][a-z]{2}) (\d{4})$", v)
    if m:
        return int(m.group(2)) * 12 + MONTH_NAMES.index(m.group(1))
    if re.fullmatch(r"\d{4}", v):
        return int(v) * 12 + fallback_month
    return None


def job_interval(job: dict[str, Any], now: _dt.date) -> tuple[int, int] | None:
    now_idx = now.year * 12 + now.month - 1
    start = month_index(job.get("startDate"), 0, now)
    if start is None or start > now_idx:
        return None
    if job.get("currentlyWorking") or norm_date(job.get("endDate")) == "Present":
        raw_end: int | None = now_idx
    else:
        raw_end = month_index(job.get("endDate"), 11, now)
    end = min(raw_end if raw_end is not None else start, now_idx)
    if end < start:
        return None
    return (start, end + 1)


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


def months_to_band(months: int) -> str:
    years = months / 12
    for limit, label in ((1, BANDS[1]), (2, BANDS[2]), (3, BANDS[3]), (5, BANDS[4]), (8, BANDS[5]), (12, BANDS[6])):
        if years <= limit:
            return label
    return BANDS[7]


def is_internship(job: dict[str, Any]) -> bool:
    return bool(job.get("internship")) or bool(INTERN_RE.search(_s(job.get("jobTitle")))) or bool(
        INTERN_RE.search(_s(job.get("employmentType")))
    )


def expected_experience(jobs: list[dict[str, Any]], now: _dt.date) -> tuple[int, str]:
    """(months, band) from the expected jobs, internships excluded, overlaps merged, gaps left out."""
    real = [j for j in jobs if not is_internship(j)]
    if not real:
        return 0, BANDS[0]
    months = merged_months([iv for iv in (job_interval(j, now) for j in real) if iv])
    return months, months_to_band(months)


# ── per-fixture scoring ───────────────────────────────────────────────────────────────────────────────────────


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def is_nonperson_name(pred: str, expected: dict[str, Any]) -> bool:
    """A wrong name that is not the person at all (product, tool, title, company, section heading...)."""
    p = norm_name(pred)
    if not p or fold(p) == fold(norm_name(expected.get("fullName"))):
        return False
    ptoks = {t for t in re.split(r"[\s.]+", fold(p)) if t}
    etoks = {t for t in re.split(r"[\s.]+", fold(expected.get("fullName"))) if t}
    if not ptoks & etoks:
        return True
    bad = {fold(t) for t in _list(expected.get("nonNameTokens"))}
    return bool(ptoks & bad)


def _match_jobs(exp: list[dict], pred: list[dict]) -> list[tuple[dict, dict]]:
    used: set[int] = set()
    pairs = []
    for e in exp:
        titles = [e.get("jobTitle"), *_list(e.get("title_alt"))]
        companies = [e.get("company"), *_list(e.get("company_alt"))]
        best, best_score = None, 0.0
        for i, p in enumerate(pred):
            if i in used:
                continue
            t = max(ratio(p.get("jobTitle"), x) for x in titles)
            c = max(ratio(p.get("company"), x) for x in companies)
            if t >= 0.9 and c >= 0.9 and t + c > best_score:
                best, best_score = i, t + c
        if best is not None:
            used.add(best)
            pairs.append((e, pred[best]))
    return pairs


def _f1_counts(n_exp: int, n_pred: int, tp: int) -> dict[str, int]:
    return {"tp": tp, "fp": max(0, n_pred - tp), "fn": max(0, n_exp - tp)}


def _match_count(exp: list, pred: list, same) -> int:
    used: set[int] = set()
    tp = 0
    for e in exp:
        for i, p in enumerate(pred):
            if i not in used and same(e, p):
                used.add(i)
                tp += 1
                break
    return tp


def score_fixture(expected: dict[str, Any], extract: dict[str, Any] | None, mode: str, now: _dt.date | None = None,
                  page_text: str = "") -> dict[str, Any]:
    """One fixture -> {field: True/False/None (n/a)} plus F1 counts. `mode` is "full" or "rules"."""
    now = now or _dt.date.today()
    x = extract or {}
    r: dict[str, Any] = {"id": expected["id"], "mode": mode}
    unreadable = mode == "rules" and expected.get("unreadableWithoutLlm")
    pred_name = norm_name(x.get("fullName"))
    r["pred_name"] = pred_name
    r["nonperson"] = is_nonperson_name(pred_name, expected)
    if unreadable:
        # nothing is readable without the LLM: the only correct output is "no guesses"
        r["unreadable"] = True
        r["unreadable_ok"] = not pred_name or fold(pred_name) == fold(expected["fullName"])
        return r

    r["name"] = fold(pred_name) == fold(norm_name(expected["fullName"]))
    r["name_case"] = pred_name == norm_name(expected["fullName"])
    r["email"] = None if "email" not in x and x.get("_no_contact") else fold(x.get("email")) == fold(expected.get("email"))
    if x.get("_no_contact"):
        r["email"] = r["phone"] = None
    else:
        pd, ed = phone_digits(x.get("phone")), phone_digits(expected.get("phone"))
        ok = bool(pd) and pd[-10:] == ed[-10:]
        if ok and expected.get("phoneCountry") and len(pd) > 10:
            ok = pd[:-10].lstrip("0") == expected["phoneCountry"]
        r["phone"] = ok
    r["location"] = bool(city_of(x.get("currentLocation"))) and city_of(x.get("currentLocation")) == city_of(expected.get("currentLocation"))
    if not expected.get("currentLocation"):
        r["location"] = not city_of(x.get("currentLocation"))
    roles = [expected.get("currentRole", ""), *_list(expected.get("currentRole_alt"))]
    r["role"] = norm_role(x.get("currentRole")) in {norm_role(v) for v in roles}

    exp_jobs = _list(expected.get("workExperiences"))
    months, band = expected_experience(exp_jobs, now)
    r["expected_months"], r["expected_band"] = months, band
    r["band"] = norm_band(x.get("totalExperience")) == norm_band(band)
    pm = x.get("experienceMonths")
    r["months"] = isinstance(pm, (int, float)) and abs(pm - months) <= 2 if months or pm else True

    pred_jobs = [j for j in _list(x.get("workExperiences")) if isinstance(j, dict) and (j.get("jobTitle") or j.get("company"))]
    pairs = _match_jobs(exp_jobs, pred_jobs)
    r["jobs"] = _f1_counts(len(exp_jobs), len(pred_jobs), len(pairs))
    d_ok = d_all = 0
    for e, p in pairs:
        for key in ("startDate", "endDate"):
            d_all += 1
            pe = norm_date(p.get(key)) or ("Present" if key == "endDate" and p.get("currentlyWorking") else "")
            ee = norm_date(e.get(key)) or ("Present" if key == "endDate" and e.get("currentlyWorking") else "")
            d_ok += pe == ee
    r["dates"] = {"ok": d_ok, "all": d_all}

    exp_edu = _list(expected.get("education"))
    pred_edu = [e for e in _list(x.get("education")) if isinstance(e, dict) and (e.get("degree") or e.get("institution"))]
    tp = _match_count(
        exp_edu, pred_edu,
        lambda e, p: alnum_ratio(e.get("degree"), p.get("degree")) >= 0.85 and alnum_ratio(e.get("institution"), p.get("institution")) >= 0.85,
    )
    r["edu"] = _f1_counts(len(exp_edu), len(pred_edu), tp)

    exp_sk = [skill_key(s) for s in _list(expected.get("skills")) if _s(s).strip()]
    pred_sk_raw = [s for s in _list(x.get("skills")) if _s(s).strip()]
    pred_sk = list(dict.fromkeys(skill_key(s) for s in pred_sk_raw))
    page = alnum(page_text)

    def sk_same(a: str, b: str) -> bool:
        return a == b or alnum(a) == alnum(b) or ratio(a, b) >= 0.9

    matched = _match_count(exp_sk, pred_sk, sk_same)
    correct_pred = sum(
        1 for p in pred_sk
        if any(sk_same(e, p) for e in exp_sk) or (len(p.split()) <= 4 and alnum(p) and alnum(p) in page)
    )
    r["skills"] = {"tp": matched, "fn": len(exp_sk) - matched, "pred_ok": correct_pred, "pred": len(pred_sk)}

    exp_c = [c.get("name") if isinstance(c, dict) else c for c in _list(expected.get("certifications"))]
    pred_c = [c.get("name") if isinstance(c, dict) else c for c in _list(x.get("certifications"))]
    pred_c = [c for c in pred_c if _s(c).strip()]
    r["certs"] = _f1_counts(len(exp_c), len(pred_c), _match_count(exp_c, pred_c, lambda e, p: alnum_ratio(e, p) >= 0.85))

    keep = _list(expected.get("metricsKeep"))
    if keep:
        blob = fold(" ".join(str(v) for v in _flatten(x.get("metrics")) + _flatten(x.get("achievements"))))
        joined = fold(" ".join(str(v) for v in _flatten(x.get("workExperiences"))))
        r["metrics"] = all(fold(k) in blob or fold(k) in joined for k in keep) and not re.search(r"(?<![\d.])1s\b", blob)
    return r


def _flatten(value: Any) -> list:
    if isinstance(value, dict):
        out: list = []
        for v in value.values():
            out += _flatten(v)
        return out
    if isinstance(value, list):
        out = []
        for v in value:
            out += _flatten(v)
        return out
    return [] if value is None else [value]


# ── aggregation ───────────────────────────────────────────────────────────────────────────────────────────────


def _f1(tp: int, fp: int, fn: int) -> float:
    if tp == 0 and fp == 0 and fn == 0:
        return 1.0
    p = tp / (tp + fp) if tp + fp else 0.0
    rc = tp / (tp + fn) if tp + fn else 0.0
    return 2 * p * rc / (p + rc) if p + rc else 0.0


def aggregate(results: list[dict[str, Any]]) -> dict[str, Any]:
    def rate(field: str) -> float | None:
        vals = [r[field] for r in results if r.get(field) is not None and not r.get("unreadable")]
        return (sum(1 for v in vals if v) / len(vals)) if vals else None

    def f1(field: str) -> float:
        tp = sum(r[field]["tp"] for r in results if field in r)
        fp = sum(r[field]["fp"] for r in results if field in r)
        fn = sum(r[field]["fn"] for r in results if field in r)
        return _f1(tp, fp, fn)

    sk = [r["skills"] for r in results if "skills" in r]
    tp = sum(s["tp"] for s in sk)
    fn = sum(s["fn"] for s in sk)
    pred = sum(s["pred"] for s in sk)
    pred_ok = sum(s["pred_ok"] for s in sk)
    prec = pred_ok / pred if pred else (1.0 if not tp + fn else 0.0)
    rec = tp / (tp + fn) if tp + fn else 1.0
    d_ok = sum(r["dates"]["ok"] for r in results if "dates" in r)
    d_all = sum(r["dates"]["all"] for r in results if "dates" in r)
    return {
        "fixtures": len(results),
        "name": rate("name"),
        "name_case": rate("name_case"),
        "nonperson": sum(1 for r in results if r.get("nonperson")),
        "email": rate("email"),
        "phone": rate("phone"),
        "location": rate("location"),
        "role": rate("role"),
        "band": rate("band"),
        "months": rate("months"),
        "jobs_f1": f1("jobs"),
        "dates": (d_ok / d_all) if d_all else 1.0,
        "edu_f1": f1("edu"),
        "skills_f1": (2 * prec * rec / (prec + rec)) if prec + rec else 0.0,
        "certs_f1": f1("certs"),
        "metrics": rate("metrics"),
        "unreadable_ok": all(r.get("unreadable_ok", True) for r in results),
    }


def gate_failures(summary: dict[str, Any], mode: str) -> list[str]:
    gates = GATES[mode]
    out = []
    for key, limit in gates.items():
        if key == "nonperson_max":
            if summary["nonperson"] > limit:
                out.append(f"nonperson={summary['nonperson']} > {limit}")
            continue
        value = summary.get(key)
        if value is None:  # not produced by this path (e.g. the browser parser has no email/phone)
            continue
        if value + 1e-9 < limit:
            out.append(f"{key}={value:.3f} < {limit}")
    if not summary.get("unreadable_ok", True):
        out.append("a scanned/unreadable fixture produced a guessed name")
    return out


def format_report(summary: dict[str, Any], results: list[dict[str, Any]], title: str, mode: str) -> str:
    def pct(v):
        return "  n/a" if v is None else f"{v * 100:5.1f}%"

    lines = [f"== {title} ({summary['fixtures']} fixtures, gates: {mode}) =="]
    keys = ["name", "name_case", "email", "phone", "location", "role", "band", "months", "jobs_f1", "dates", "edu_f1", "skills_f1", "certs_f1", "metrics"]
    gates = GATES[mode]
    for k in keys:
        g = gates.get(k)
        lines.append(f"  {k:<10} {pct(summary.get(k))}" + (f"   (gate {g * 100:.0f}%)" if g is not None else ""))
    lines.append(f"  nonperson  {summary['nonperson']:>5}    (gate 0)")
    misses = []
    for r in results:
        bad = [k for k in ("name", "email", "phone", "location", "role", "band", "months") if r.get(k) is False]
        for k in ("jobs", "edu"):
            if k in r and (r[k]["fp"] or r[k]["fn"]):
                bad.append(f"{k}(tp{r[k]['tp']}/fp{r[k]['fp']}/fn{r[k]['fn']})")
        if "dates" in r and r["dates"]["ok"] != r["dates"]["all"]:
            bad.append(f"dates({r['dates']['ok']}/{r['dates']['all']})")
        if r.get("nonperson"):
            bad.append(f"NONPERSON[{r['pred_name']}]")
        if r.get("unreadable") and not r.get("unreadable_ok"):
            bad.append(f"GUESSED[{r['pred_name']}]")
        if bad:
            misses.append(f"  - {r['id']}: {', '.join(bad)}" + (f"  name={r['pred_name']!r}" if r.get("name") is False else ""))
    if misses:
        lines.append("  misses:")
        lines += misses
    fails = gate_failures(summary, mode)
    lines.append("  GATES: " + ("PASS" if not fails else "FAIL -> " + "; ".join(fails)))
    return "\n".join(lines)
