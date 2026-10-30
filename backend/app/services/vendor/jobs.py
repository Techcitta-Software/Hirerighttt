from __future__ import annotations

import secrets
from typing import Any
from urllib.parse import unquote

from app.db.store import find_job_by_shareable_code
from app.services.vendor.ats_score import compute_ats_score, extract_primary_skills_from_jd


def slugify_company_name(name: str) -> str:
    base = re_sub_slug(str(name or "company"))
    return base or "company"


def re_sub_slug(text: str) -> str:
    import re

    base = re.sub(r"[^a-z0-9]+", "-", text.lower().strip())
    return re.sub(r"^-+|-+$", "", base)[:48]


def new_shareable_code() -> str:
    return secrets.token_hex(5)


def new_id() -> str:
    return secrets.token_hex(8)


def create_vendor_job(db: dict, organization_id: str, created_by_user_id: str, body: dict) -> dict:
    title = str(body.get("title") or "").strip()
    job_description = str(body.get("jobDescription") or "").strip()
    if not title or len(title) > 200 or len(job_description) < 30 or len(job_description) > 20000:
        err = ValueError("Provide a title (up to 200 characters) and complete JD (30–20,000 characters).")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    skills_raw = body.get("requiredSkills")
    if isinstance(skills_raw, list):
        required_skills = [str(s).strip() for s in skills_raw if str(s).strip()]
    else:
        required_skills = [s.strip() for s in str(body.get("skills") or "").split(",") if s.strip()]
    if not required_skills:
        required_skills = extract_primary_skills_from_jd(job_description, [])
    if len(required_skills) > 40 or any(len(s) > 100 for s in required_skills):
        err = ValueError("Provide at most 40 skills, each up to 100 characters.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    shareable_code = new_shareable_code()
    existing = {j.get("shareableCode") for j in db.get("jobs") or []}
    while shareable_code in existing:
        shareable_code = new_shareable_code()
    user = next((u for u in db.get("users") or [] if u.get("id") == created_by_user_id), None)
    company = str(body.get("company") or (user.get("companyName") if user else "") or "Organization").strip()
    role_track = str(body.get("roleTrack") or body.get("role") or title).strip()
    if len(role_track) > 120:
        err = ValueError("Role track must be 120 characters or less.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    from datetime import datetime, timezone

    job = {
        "id": new_id(),
        "organizationId": organization_id,
        "createdByUserId": created_by_user_id,
        "title": title,
        "company": company,
        "companySlug": slugify_company_name(company),
        "roleTrack": role_track,
        "experienceLevel": str(body.get("experienceLevel") or body.get("experience") or "2–5 years").strip(),
        "location": str(body.get("location") or "Remote").strip(),
        "jobDescription": job_description,
        "requiredSkills": required_skills,
        "shareableCode": shareable_code,
        "status": "active",
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "createdByEmail": user.get("email") if user else None,
    }
    db.setdefault("jobs", []).append(job)
    return job


def _normalize_shareable_code(code: str) -> str:
    try:
        return unquote(str(code or "").strip()).lower()
    except Exception:
        return str(code or "").strip().lower()


def _is_job_link_active(job: dict | None) -> bool:
    status = str(job.get("status") if job else "published").lower()
    return status in ("active", "published")


def get_job_by_shareable_code(db: dict, code: str, company_slug: str | None = None) -> dict | None:
    c = _normalize_shareable_code(code)
    if not c:
        return None
    slug = slugify_company_name(company_slug) if company_slug else None
    matches = [
        j
        for j in db.get("jobs") or []
        if _is_job_link_active(j) and str(j.get("shareableCode") or "").lower() == c
    ]
    if not matches:
        return None
    if not slug or len(matches) == 1:
        return matches[0]
    by_slug = next(
        (
            j
            for j in matches
            if (j.get("companySlug") or slugify_company_name(j.get("company") or "")) == slug
        ),
        None,
    )
    return by_slug or matches[0]


async def resolve_public_job(db: dict, database_url: str, code: str, company_slug: str | None = None) -> dict | None:
    job = get_job_by_shareable_code(db, code, company_slug)
    if not job:
        job = get_job_by_shareable_code(db, code, None)
    if not job and database_url:
        from_db = find_job_by_shareable_code(database_url, code)
        if from_db:
            job = from_db
            db.setdefault("jobs", [])
            idx = next((i for i, j in enumerate(db["jobs"]) if j.get("id") == from_db.get("id")), -1)
            if idx >= 0:
                db["jobs"][idx] = {**db["jobs"][idx], **from_db}
            else:
                db["jobs"].append(from_db)
    return job


def parse_public_job_path(pathname: str) -> dict[str, Any]:
    raw = str(pathname or "").replace("/api/jobs/public/", "").replace("/api/jobs/public", "")
    parts = [p for p in raw.strip("/").split("/") if p]
    is_apply = bool(parts) and parts[-1] == "apply"
    segments = parts[:-1] if is_apply else parts

    def decode_segment(segment: str) -> str:
        if not segment:
            return ""
        try:
            return unquote(segment)
        except Exception:
            return segment

    company_slug = decode_segment(segments[0]) if len(segments) >= 2 else None
    code = decode_segment(segments[1] if len(segments) >= 2 else (segments[0] if segments else ""))
    return {"code": code, "companySlug": company_slug, "isApply": is_apply}


def list_open_jobs(db: dict) -> list[dict]:
    jobs = [
        j
        for j in db.get("jobs") or []
        if _is_job_link_active(j) and str(j.get("title") or "").strip()
    ]
    return sorted(jobs, key=lambda j: str(j.get("createdAt") or ""), reverse=True)


def job_visible_to_recruiter(job: dict | None, options: dict | None = None) -> bool:
    if not job:
        return False
    options = options or {}
    user_id = str(options.get("createdByUserId") or "")
    if not user_id:
        return True
    if str(job.get("createdByUserId") or "") == user_id:
        return True
    user_email = str(options.get("createdByEmail") or "").strip().lower()
    creator_email = str(job.get("createdByEmail") or "").strip().lower()
    if not job.get("createdByUserId") and user_email and creator_email == user_email:
        return True
    return False


def list_org_jobs(db: dict, organization_id: str, options: dict | None = None) -> list[dict]:
    org_id = str(organization_id or "")
    options = options or {}

    def ok(j: dict) -> bool:
        if str(j.get("organizationId")) != org_id:
            return False
        if j.get("status") in ("archived", "deleted"):
            return False
        return job_visible_to_recruiter(j, options)

    return sorted([j for j in db.get("jobs") or [] if ok(j)], key=lambda j: str(j.get("createdAt") or ""), reverse=True)


def get_org_job(db: dict, organization_id: str, job_id: str) -> dict | None:
    return next(
        (j for j in db.get("jobs") or [] if j.get("id") == job_id and j.get("organizationId") == organization_id),
        None,
    )


def get_org_job_for_recruiter(db: dict, organization_id: str, job_id: str, options: dict | None = None) -> dict | None:
    job = get_org_job(db, organization_id, job_id)
    if not job or not job_visible_to_recruiter(job, options):
        return None
    return job


def get_org_application(db: dict, organization_id: str, application_id: str) -> dict | None:
    return next(
        (
            a
            for a in db.get("employerApplications") or []
            if a.get("id") == application_id and a.get("organizationId") == organization_id
        ),
        None,
    )


def get_org_application_for_recruiter(
    db: dict, organization_id: str, application_id: str, options: dict | None = None
) -> dict | None:
    app = get_org_application(db, organization_id, application_id)
    if not app or not app.get("jobId"):
        return app
    job = get_org_job_for_recruiter(db, organization_id, app["jobId"], options)
    return app if job else None


def delete_vendor_job(db: dict, organization_id: str, job_id: str) -> dict:
    jid = str(job_id or "").strip()
    if not jid:
        err = ValueError("Job id is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    job = get_org_job(db, organization_id, jid)
    if not job:
        err = ValueError("Job not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err
    db["jobs"] = [j for j in db.get("jobs") or [] if j.get("id") != jid]
    db["employerApplications"] = [a for a in db.get("employerApplications") or [] if a.get("jobId") != jid]
    return {"id": jid, "title": job.get("title")}


def _merge_application_payload(application: dict, job: dict, payload: dict) -> None:
    resume_text = str(payload.get("resumeText") or application.get("data", {}).get("resumeText") or "")
    ats = payload.get("atsEvaluation")
    if ats is None and len(resume_text.strip()) >= 30:
        ats = compute_ats_score(
            {
                "resumeText": resume_text,
                "jobDescription": job.get("jobDescription") or "",
                "requiredSkills": job.get("requiredSkills") or [],
            }
        )
    from datetime import datetime, timezone

    application["data"] = {
        **(application.get("data") or {}),
        "candidateName": str(payload.get("candidateName") or application.get("data", {}).get("candidateName") or "").strip(),
        "candidatePhone": str(payload.get("candidatePhone") or application.get("data", {}).get("candidatePhone") or "").strip(),
        "candidateRole": str(payload.get("candidateRole") or application.get("data", {}).get("candidateRole") or "").strip(),
        "experienceYears": str(payload.get("experienceYears") or application.get("data", {}).get("experienceYears") or "").strip(),
        "resumeName": str(payload.get("resumeName") or application.get("data", {}).get("resumeName") or "resume"),
        "resumeText": resume_text[:50000],
        "jobTitle": job.get("title"),
        "company": job.get("company"),
        "roleTrack": job.get("roleTrack"),
        **(
            {
                "atsScore": ats["atsScore"],
                "jdMatchScore": ats["jdMatchScore"],
                "resumeSkillCoverage": ats.get("resumeSkillCoverage"),
                "primarySkills": ats["primarySkills"],
                "matchedSkills": ats["matchedSkills"],
                "missingSkills": ats["missingSkills"],
                "atsStrengths": ats.get("strengths") or [],
                "atsGaps": ats.get("gaps") or [],
                "atsSummary": ats.get("summary") or "",
                "atsConfidence": ats.get("confidence") or "medium",
                "aiEnhancedAts": bool(ats.get("aiEnhanced")),
                "atsBreakdown": ats.get("atsBreakdown"),
                "improvementTips": ats.get("improvementTips") or [],
            }
            if ats
            else {}
        ),
    }
    application["appliedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_job_application(db: dict, job: dict, payload: dict) -> dict:
    email = str(payload.get("candidateEmail") or "").strip().lower()
    if not email:
        err = ValueError("candidateEmail is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    db.setdefault("employerApplications", [])
    dup = next((a for a in db["employerApplications"] if a.get("jobId") == job.get("id") and a.get("candidateEmail") == email), None)
    if dup:
        if dup.get("candidateUserId") and dup.get("candidateUserId") != payload.get("candidateUserId"):
            err = ValueError("Application belongs to another account.")
            err.status = 403  # type: ignore[attr-defined]
            raise err
        dup["candidateUserId"] = payload.get("candidateUserId") or dup.get("candidateUserId")
        _merge_application_payload(dup, job, payload)
        return {"application": dup, "created": False, "ats": dup.get("data")}
    resume_text = str(payload.get("resumeText") or "")
    ats = payload.get("atsEvaluation") or compute_ats_score(
        {
            "resumeText": resume_text,
            "jobDescription": job.get("jobDescription") or "",
            "requiredSkills": job.get("requiredSkills") or [],
        }
    )
    from datetime import datetime, timezone

    application = {
        "id": new_id(),
        "organizationId": job.get("organizationId"),
        "jobId": job.get("id"),
        "candidateEmail": email,
        "candidateUserId": payload.get("candidateUserId"),
        "status": "applied",
        "appliedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data": {
            "candidateName": str(payload.get("candidateName") or "").strip(),
            "candidatePhone": str(payload.get("candidatePhone") or "").strip(),
            "candidateRole": str(payload.get("candidateRole") or "").strip(),
            "experienceYears": str(payload.get("experienceYears") or "").strip(),
            "resumeName": str(payload.get("resumeName") or "resume"),
            "resumeText": resume_text[:50000],
            "atsScore": ats["atsScore"],
            "jdMatchScore": ats["jdMatchScore"],
            "resumeSkillCoverage": ats.get("resumeSkillCoverage"),
            "primarySkills": ats["primarySkills"],
            "matchedSkills": ats["matchedSkills"],
            "missingSkills": ats["missingSkills"],
            "atsStrengths": ats.get("strengths") or [],
            "atsGaps": ats.get("gaps") or [],
            "atsSummary": ats.get("summary") or "",
            "atsConfidence": ats.get("confidence") or "medium",
            "aiEnhancedAts": bool(ats.get("aiEnhanced")),
            "atsBreakdown": ats.get("atsBreakdown"),
            "improvementTips": ats.get("improvementTips") or [],
            "interviewScore": None,
            "interviewResult": None,
            "vendorReport": None,
            "jobTitle": job.get("title"),
            "company": job.get("company"),
            "roleTrack": job.get("roleTrack"),
        },
    }
    db["employerApplications"].append(application)
    return {"application": application, "created": True, "ats": ats}


def attach_candidate_report_to_application(
    db: dict, application: dict, candidate_email: str, options: dict | None = None
) -> dict:
    options = options or {}
    email = str(candidate_email or "").strip().lower()
    if not email or not application.get("data"):
        return application
    profile = (db.get("profiles") or {}).get(email) or {}
    if not application["data"].get("candidateRole"):
        application["data"]["candidateRole"] = str(options.get("candidateRole") or profile.get("currentRole") or "").strip()
    for key, pkey in (
        ("resumeName", "resumeName"),
        ("resumeStoragePath", "resumeStoragePath"),
        ("resumeFileId", "resumeFileId"),
        ("resumeUrl", "resumeUrl"),
    ):
        if profile.get(pkey) and not application["data"].get(key):
            application["data"][key] = profile[pkey]
    if options.get("attachInterviewReport") is False:
        return application
    interview = options.get("interview") or (db.get("interviews") or {}).get(email)
    if not interview:
        return application
    application["data"]["interviewResult"] = interview
    if isinstance(interview.get("overall"), (int, float)):
        application["data"]["interviewScore"] = interview["overall"]
    if not application["data"].get("candidateRole") and interview.get("role"):
        application["data"]["candidateRole"] = interview["role"]
    return application


def list_job_applications(db: dict, organization_id: str, job_id: str) -> list[dict]:
    apps = [
        a
        for a in db.get("employerApplications") or []
        if a.get("organizationId") == organization_id and a.get("jobId") == job_id
    ]
    return sorted(apps, key=lambda a: str(a.get("appliedAt") or ""), reverse=True)


def update_application_interview(
    db: dict, application_id: str, organization_id: str, result: dict, extra: dict | None = None
) -> dict | None:
    extra = extra or {}
    app = next(
        (
            a
            for a in db.get("employerApplications") or []
            if a.get("id") == application_id and a.get("organizationId") == organization_id
        ),
        None,
    )
    if not app:
        return None
    from datetime import datetime, timezone

    app["status"] = "interviewed"
    app["data"] = {
        **(app.get("data") or {}),
        "interviewScore": result.get("overall"),
        "interviewOnlyScore": result.get("interviewScore"),
        "compositeInterviewAts": result.get("compositeScore") or result.get("overall"),
        "interviewAtsScore": result.get("atsScore") or extra.get("atsScore") or app.get("data", {}).get("atsScore"),
        "interviewResult": result,
        "resumeFitScore": result.get("resumeFitScore"),
        "evaluatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "vendorReport": extra.get("vendorReport") if "vendorReport" in extra else app.get("data", {}).get("vendorReport"),
        **extra,
    }
    return app


def public_job_payload(job: dict) -> dict:
    return {
        "id": job.get("id"),
        "organizationId": job.get("organizationId"),
        "title": job.get("title"),
        "company": job.get("company"),
        "companySlug": job.get("companySlug") or slugify_company_name(job.get("company") or ""),
        "roleTrack": job.get("roleTrack"),
        "experienceLevel": job.get("experienceLevel"),
        "location": job.get("location"),
        "jobDescription": job.get("jobDescription"),
        "requiredSkills": job.get("requiredSkills") or [],
        "shareableCode": job.get("shareableCode"),
        "createdAt": job.get("createdAt"),
    }


def public_job_list_payload(job: dict) -> dict:
    base = public_job_payload(job)
    jd = str(job.get("jobDescription") or "")
    return {
        **{k: base[k] for k in base if k != "jobDescription"},
        "requiredSkills": (job.get("requiredSkills") or [])[:12],
        "jobDescription": f"{jd[:360]}…" if len(jd) > 360 else jd,
    }
