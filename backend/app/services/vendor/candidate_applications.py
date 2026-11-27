from __future__ import annotations

from app.db.finders import applications_for_job
from datetime import datetime, timezone
from typing import Any

JOB_DELETED_MESSAGE = "This job was removed by the employer."


def map_employer_status_to_candidate_status(employer_status: str) -> str:
    mapping = {
        "applied": "Applied",
        "interviewed": "In Review",
        "shortlisted": "Selected",
        "rejected": "Not selected",
    }
    return mapping.get(str(employer_status or "applied").strip().lower(), "Applied")


def application_timeline(employer_status: str, applied_at: str | None = None) -> list[dict[str, Any]]:
    """Steps a candidate can track. Applied is always done; exactly one step is current (the furthest done).

    Selected and Not selected are mutually exclusive. ``applied_at`` is the candidate's apply time
    (callers pass the same timestamp stored on the application). The step list does not repeat it.
    """
    _ = applied_at  # part of the signature so callers can pass the apply time with the status
    status = str(employer_status or "applied").strip().lower()
    review_done = status in ("interviewed", "shortlisted", "rejected")
    selected_done = status == "shortlisted"
    closed_done = status == "rejected"
    steps = [
        {"key": "applied", "label": "Applied", "done": True},
        {"key": "review", "label": "In review", "done": review_done},
        {"key": "selected", "label": "Selected", "done": selected_done},
        {"key": "closed", "label": "Not selected", "done": closed_done},
    ]
    current_at = max((i for i, step in enumerate(steps) if step["done"]), default=0)
    for i, step in enumerate(steps):
        step["current"] = i == current_at
    return steps


def build_candidate_job_application_record(job: dict, employer_app: dict, options: dict | None = None) -> dict:
    options = options or {}
    data = employer_app.get("data") or {}
    interview_overall = None
    if isinstance(data.get("interviewScore"), (int, float)):
        interview_overall = data["interviewScore"]
    elif isinstance((data.get("interviewResult") or {}).get("overall"), (int, float)):
        interview_overall = data["interviewResult"]["overall"]
    match = options.get("match")
    if isinstance(match, (int, float)) and match == match:
        match_val = round(float(match))
    elif isinstance(data.get("atsScore"), (int, float)):
        match_val = round(data["atsScore"])
    elif interview_overall is not None:
        match_val = round(interview_overall)
    else:
        match_val = 0
    jd = str(job.get("jobDescription") or "")
    employer_status = str(employer_app.get("status") or "applied").strip() or "applied"
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    applied_at = employer_app.get("appliedAt") or now
    return {
        "id": employer_app["id"],
        "employerApplicationId": employer_app["id"],
        "jobId": job["id"],
        "organizationId": job["organizationId"],
        "title": job.get("title"),
        "company": job.get("company"),
        "location": job.get("location") or "",
        "roleTrack": job.get("roleTrack") or "",
        "experienceLevel": job.get("experienceLevel") or "",
        "shareableCode": job.get("shareableCode"),
        "companySlug": job.get("companySlug"),
        "jobDescription": jd[:2000] if jd else "",
        "match": match_val,
        "status": map_employer_status_to_candidate_status(employer_status),
        "employerStatus": employer_status,
        "appliedAt": applied_at,
        "timeline": application_timeline(employer_status, applied_at),
        "atsScore": data.get("atsScore"),
        "jdMatchScore": data.get("jdMatchScore"),
        "interviewScore": interview_overall,
        "jobStatus": "active",
    }


def mark_candidate_job_applications_deleted(db: dict, job_id: str, meta: dict | None = None) -> dict:
    meta = meta or {}
    jid = str(job_id or "").strip()
    if not jid:
        return {"updated": 0, "records": []}
    deleted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    patch = {
        "jobStatus": "deleted",
        "jobDeletedAt": deleted_at,
        "jobDeletedMessage": JOB_DELETED_MESSAGE,
        **({"title": meta["title"]} if meta.get("title") else {}),
        **({"company": meta["company"]} if meta.get("company") else {}),
    }
    updated = 0
    records: list[dict] = []
    for email, rows in applications_for_job(db, jid).items():
        if not isinstance(rows, list):
            continue
        for i, row in enumerate(rows):
            if str(row.get("jobId") or "") != jid:
                continue
            rows[i] = {**row, **patch}
            updated += 1
            records.append({"email": email, "record": rows[i]})
    return {"updated": updated, "records": records}


def record_candidate_job_application(
    db: dict, email: str, job: dict, employer_app: dict, options: dict | None = None
) -> dict:
    record = build_candidate_job_application_record(job, employer_app, options)
    db.setdefault("applications", {})
    lst = list(db["applications"].get(email) or [])
    idx = next((i for i, r in enumerate(lst) if r.get("id") == record["id"]), -1)
    if idx >= 0:
        lst[idx] = {**lst[idx], **record}
    else:
        lst.insert(0, record)
    db["applications"][email] = lst
    return record
