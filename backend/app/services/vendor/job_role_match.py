from __future__ import annotations

import re
from typing import Any

ROLE_FAMILIES = [
    {
        "id": "ml",
        "pattern": re.compile(
            r"machine learning|\bml\b|mlops|deep learning|\bnlp\b|computer vision|generative ai|\bllm\b|"
            r"data scientist|ai engineer|research scientist",
            re.I,
        ),
    },
    {
        "id": "frontend",
        "pattern": re.compile(r"frontend|front-end|react|\bui developer\b|web developer", re.I),
    },
    {
        "id": "backend",
        "pattern": re.compile(r"backend|back-end|api engineer|java developer|golang|\bgo developer\b", re.I),
    },
    {"id": "fullstack", "pattern": re.compile(r"full stack|fullstack", re.I)},
]

GENERIC_ROLE_TOKENS = frozenset(
    {"engineer", "developer", "dev", "senior", "staff", "lead", "manager", "software", "specialist"}
)


def _tokenize(text: str) -> list[str]:
    return [t for t in re.sub(r"[^a-z0-9+#./\s-]", " ", str(text or "").lower()).split() if len(t) >= 2]


def resolve_candidate_role_hints(profile: dict | None) -> list[str]:
    profile = profile or {}
    hints: list[str] = []
    current = profile.get("currentRole") or profile.get("current_role")
    if isinstance(current, str) and current.strip():
        hints.append(current.strip())
    preferred = profile.get("preferredRoles") or profile.get("preferred_roles")
    if isinstance(preferred, list):
        hints.extend(str(r).strip() for r in preferred if isinstance(r, str) and r.strip())
    skills = profile.get("skills")
    if isinstance(skills, list):
        hints.extend(str(s).strip() for s in skills[:8] if isinstance(s, str) and len(s.strip()) >= 4)
    seen: set[str] = set()
    out: list[str] = []
    for h in hints:
        k = h.lower()
        if k not in seen:
            seen.add(k)
            out.append(h)
    return out


def _family_for_text(text: str):
    for family in ROLE_FAMILIES:
        if family["pattern"].search(str(text or "")):
            return family
    return None


def score_job_role_alignment(job: dict, hints: list[str]) -> int:
    blob = f"{job.get('roleTrack') or ''} {job.get('title') or ''}".strip()
    if not blob or not hints:
        return 0
    best = 0
    job_lower = blob.lower()
    job_tokens = set(_tokenize(blob))
    for hint in hints:
        h = hint.lower()
        if not h:
            continue
        if h in job_lower or job_lower.startswith(h[: min(24, len(job_lower))]):
            best = max(best, 100)
        hf, jf = _family_for_text(h), _family_for_text(blob)
        if hf and jf and hf["id"] == jf["id"]:
            best = max(best, 92)
        hint_tokens = _tokenize(h)
        overlap = 0
        for t in hint_tokens:
            if len(t) < 3 or t in GENERIC_ROLE_TOKENS:
                continue
            for jt in job_tokens:
                if jt in GENERIC_ROLE_TOKENS:
                    continue
                if jt in t or t in jt:
                    overlap += 1
                    break
        if overlap >= 2:
            best = max(best, 78)
        elif overlap >= 1:
            best = max(best, 55)
    return best


def filter_open_jobs_for_candidate(jobs: list[dict], profile: dict | None, options: dict | None = None) -> dict:
    options = options or {}
    min_score = options.get("minScore", 50)
    hints = resolve_candidate_role_hints(profile)
    total_open = len(jobs)
    if not hints:
        return {"jobs": jobs, "hints": [], "totalOpen": total_open, "personalized": False, "minScore": min_score}
    scored = [
        {"job": j, "score": score_job_role_alignment(j, hints)}
        for j in jobs
        if score_job_role_alignment(j, hints) >= min_score
    ]
    scored.sort(key=lambda r: (-r["score"], str(r["job"].get("createdAt") or "")))
    return {
        "jobs": [r["job"] for r in scored],
        "hints": hints,
        "totalOpen": total_open,
        "personalized": True,
        "minScore": min_score,
    }


def apply_candidate_job_scope(db: dict, email: str, jobs: list[dict], scope: str) -> dict[str, Any]:
    normalized = "all" if scope == "all" else "matched"
    total_open = len(jobs)
    if normalized == "all":
        return {"jobs": jobs, "meta": {"scope": "all", "totalOpen": total_open, "matchedCount": total_open, "candidateRoleHints": []}}
    user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    if user and user.get("role") == "employer":
        return {"jobs": jobs, "meta": {"scope": "all", "totalOpen": total_open, "matchedCount": total_open, "candidateRoleHints": []}}
    profile = (db.get("profiles") or {}).get(email) or {}
    filtered = filter_open_jobs_for_candidate(jobs, profile)
    if not filtered.get("personalized"):
        return {
            "jobs": jobs,
            "meta": {
                "scope": "matched",
                "totalOpen": total_open,
                "matchedCount": total_open,
                "candidateRoleHints": [],
                "personalized": False,
                "message": "Add your current role on your profile to see tailored job matches.",
            },
        }
    return {
        "jobs": filtered["jobs"],
        "meta": {
            "scope": "matched",
            "totalOpen": total_open,
            "matchedCount": len(filtered["jobs"]),
            "candidateRoleHints": filtered["hints"],
            "personalized": True,
            "minMatchScore": filtered["minScore"],
        },
    }
