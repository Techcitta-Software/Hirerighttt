from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

JOB_DELETED_MESSAGE = "This job was removed by the employer."


def map_employer_status_to_candidate_status(employer_status: str) -> str:
    mapping = {
        "applied": "Applied",
        "interviewed": "In Review",
        "shortlisted": "Interview",
        "rejected": "Applied",
    }
    return mapping.get(str(employer_status or "applied").lower(), "Applied")


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
        "status": map_employer_status_to_candidate_status(employer_app.get("status") or "applied"),
        "employerStatus": employer_app.get("status"),
        "appliedAt": employer_app.get("appliedAt") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
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
    for email, rows in (db.get("applications") or {}).items():
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
