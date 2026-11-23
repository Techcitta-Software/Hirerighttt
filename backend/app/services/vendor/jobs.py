from __future__ import annotations

from app.db.finders import (
    employer_apps_for_job,
    find_employer_app,
    find_employer_app_for,
    find_job,
    find_user,
    jobs_by_shareable_code,
    jobs_for_org,
    open_jobs,
    remove_job,
    shareable_codes_exist,
)
from app.db.uow import UnitOfWork
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
    while shareable_codes_exist(db, [shareable_code]):
        shareable_code = new_shareable_code()
    user = find_user(db, user_id=created_by_user_id)
    company = str(body.get("company") or (user.get("companyName") if user else "") or "Organization").strip()
    role_track = str(body.get("roleTrack") or body.get("role") or "").strip()
    if not role_track:
        err = ValueError("Role is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    if len(role_track) > 120:
        err = ValueError("Role track must be 120 characters or less.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    experience_level = str(body.get("experienceLevel") or body.get("experience") or "").strip()
    if not experience_level:
        err = ValueError("Years of experience is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    location = str(body.get("location") or "").strip()
    if not location:
        err = ValueError("Location is required.")
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
        "experienceLevel": experience_level,
        "location": location,
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
    matches = [j for j in jobs_by_shareable_code(db, c) if _is_job_link_active(j)]
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
        if isinstance(db, UnitOfWork):
            return None  # the finder above already queried the database
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
    jobs = [j for j in open_jobs(db) if _is_job_link_active(j) and str(j.get("title") or "").strip()]
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

    return sorted([j for j in jobs_for_org(db, org_id) if ok(j)], key=lambda j: str(j.get("createdAt") or ""), reverse=True)


def get_org_job(db: dict, organization_id: str, job_id: str) -> dict | None:
    job = find_job(db, job_id)
    return job if job and job.get("organizationId") == organization_id else None


def get_org_job_for_recruiter(db: dict, organization_id: str, job_id: str, options: dict | None = None) -> dict | None:
    job = get_org_job(db, organization_id, job_id)
    if not job or not job_visible_to_recruiter(job, options):
        return None
    return job


def get_org_application(db: dict, organization_id: str, application_id: str) -> dict | None:
    app = find_employer_app(db, application_id)
    return app if app and app.get("organizationId") == organization_id else None


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
    remove_job(db, jid)
    return {"id": jid, "title": job.get("title")}


# --- Job lifecycle (PATCH /api/vendor/jobs/{id}) -----------------------------------------------------------------
# "active" is the legacy spelling of "published" (jobs created before the lifecycle existed).
JOB_STATUSES = ("draft", "published", "closed", "archived")
JOB_CLOSED_MESSAGE = "This job is no longer accepting applications."
# Allowed moves. draft <-> published is publish / unpublish, published <-> closed is close / reopen;
# archive hides the job from the employer's list (applicants and reports stay), restoring brings it back closed.
JOB_STATUS_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "draft": ("published", "archived"),
    "published": ("draft", "closed", "archived"),
    "closed": ("published", "archived"),
    "archived": ("closed",),
}
_EDITABLE_TEXT_FIELDS = {
    # body key -> (job key, max length, label)
    "title": ("title", 200, "Title"),
    "roleTrack": ("roleTrack", 120, "Role"),
    "experienceLevel": ("experienceLevel", 80, "Years of experience"),
    "location": ("location", 120, "Location"),
}


def job_status(job: dict | None) -> str:
    """Canonical lifecycle status of a job ("active" and missing both read as published)."""
    raw = str((job or {}).get("status") or "published").strip().lower()
    return "published" if raw in ("active", "published", "") else raw


def _bad_request(message: str, status: int = 400) -> ValueError:
    err = ValueError(message)
    err.status = status  # type: ignore[attr-defined]
    return err


def update_vendor_job(job: dict, body: dict) -> dict:
    """Apply an edit / status change to `job` in place. Returns {"changed": [...fields], "from": old, "to": new}.

    Raises ValueError (with .status) on invalid input. The caller has already checked tenant and role.
    Interviews that already ran keep the questions they were asked (they are stored on the session / result);
    only interviews started after this edit read the new description and skills."""
    if not isinstance(body, dict) or not body:
        raise _bad_request("Nothing to update.")
    allowed = set(_EDITABLE_TEXT_FIELDS) | {"jobDescription", "requiredSkills", "status"}
    unknown = sorted(k for k in body if k not in allowed)
    if unknown:
        raise _bad_request(f"These fields cannot be changed: {', '.join(unknown)}.")
    updates: dict[str, Any] = {}
    for key, (job_key, max_len, label) in _EDITABLE_TEXT_FIELDS.items():
        if key not in body:
            continue
        value = body[key]
        if not isinstance(value, str) or not value.strip():
            raise _bad_request(f"{label} is required.")
        value = value.strip()
        if len(value) > max_len:
            raise _bad_request(f"{label} must be {max_len} characters or less.")
        updates[job_key] = value
    if "jobDescription" in body:
        jd = body["jobDescription"]
        if not isinstance(jd, str) or not (30 <= len(jd.strip()) <= 20000):
            raise _bad_request("Provide a complete JD (30–20,000 characters).")
        updates["jobDescription"] = jd.strip()
    if "requiredSkills" in body:
        raw = body["requiredSkills"]
        if isinstance(raw, str):
            raw = raw.split(",")
        if not isinstance(raw, list) or any(not isinstance(s, str) for s in raw):
            raise _bad_request("Skills must be a list of names.")
        skills = list(dict.fromkeys(s.strip() for s in raw if s.strip()))
        if not skills:
            raise _bad_request("Add at least one skill.")
        if len(skills) > 40 or any(len(s) > 100 for s in skills):
            raise _bad_request("Provide at most 40 skills, each up to 100 characters.")
        updates["requiredSkills"] = skills
    old_status = job_status(job)
    new_status = old_status
    if "status" in body:
        wanted = str(body["status"] or "").strip().lower()
        if wanted == "active":
            wanted = "published"
        if wanted not in JOB_STATUSES:
            raise _bad_request(f"Status must be one of: {', '.join(JOB_STATUSES)}.")
        if wanted != old_status and wanted not in JOB_STATUS_TRANSITIONS.get(old_status, ()):
            raise _bad_request(f"A {old_status} job cannot be moved to {wanted}.", 409)
        new_status = wanted
    changed = [k for k, v in updates.items() if job.get(k) != v]
    for k in changed:
        job[k] = updates[k]
    if new_status != old_status:
        job["status"] = new_status
        changed.append("status")
    if changed:
        from datetime import datetime, timezone

        job["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"changed": changed, "from": old_status, "to": new_status}


def find_job_by_code_any_status(db: dict, code: str, database_url: str = "") -> dict | None:
    """The job behind a share link whatever its status (to tell "closed" apart from "never existed")."""
    c = _normalize_shareable_code(code)
    if not c:
        return None
    matches = jobs_by_shareable_code(db, c)
    if matches:
        return matches[0]
    if database_url.strip() and not isinstance(db, UnitOfWork):
        return find_job_by_shareable_code(database_url, c, include_inactive=True)
    return None


def closed_job_response_body(job: dict) -> dict:
    """What a share / apply link answers for a job that exists but no longer takes applications (HTTP 410)."""
    return {
        "error": JOB_CLOSED_MESSAGE,
        "code": "JOB_CLOSED",
        "job": {"title": job.get("title"), "company": job.get("company"), "status": job_status(job)},
    }


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


APPLICATION_SOURCES = ("job_board", "shared_link", "invite")


def application_source(value: object) -> str | None:
    """Where the candidate applied from; unknown values are dropped rather than trusted."""
    v = str(value or "").strip().lower()
    return v if v in APPLICATION_SOURCES else None


def create_job_application(db: dict, job: dict, payload: dict) -> dict:
    email = str(payload.get("candidateEmail") or "").strip().lower()
    if not email:
        err = ValueError("candidateEmail is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    db.setdefault("employerApplications", [])
    dup = find_employer_app_for(db, job.get("id"), email)
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
            "source": application_source(payload.get("source")),
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
    from app.services.candidate_name import candidate_display_name

    # The applicant is shown by the name on their (current) resume, never a signup / typed name that differs.
    application["data"]["candidateName"] = candidate_display_name(
        db, email, resume_text=application["data"].get("resumeText"), given=application["data"].get("candidateName")
    )
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
    # The interview taken for THIS job always wins; never replace it with the candidate's latest
    # interview for some other role or a practice run.
    if application["data"].get("interviewSource") == "job":
        return application
    interview = options.get("interview") or (db.get("interviews") or {}).get(email)
    if not interview:
        return application
    application["data"]["interviewResult"] = interview
    application["data"]["interviewSource"] = "general"
    if isinstance(interview.get("overall"), (int, float)):
        application["data"]["interviewScore"] = interview["overall"]
    if not application["data"].get("candidateRole") and interview.get("role"):
        application["data"]["candidateRole"] = interview["role"]
    return application


def list_job_applications(db: dict, organization_id: str, job_id: str) -> list[dict]:
    apps = [a for a in employer_apps_for_job(db, job_id) if a.get("organizationId") == organization_id]
    return sorted(apps, key=lambda a: str(a.get("appliedAt") or ""), reverse=True)


def update_application_interview(
    db: dict, application_id: str, organization_id: str, result: dict, extra: dict | None = None
) -> dict | None:
    extra = extra or {}
    app = get_org_application(db, organization_id, application_id)
    if not app:
        return None
    from datetime import datetime, timezone

    # A vendor's decision (shortlisted / rejected) stands; the interview only moves a new applicant forward.
    if str(app.get("status") or "applied").lower() not in ("shortlisted", "rejected"):
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
        "status": job_status(job),
        "createdAt": job.get("createdAt"),
        "updatedAt": job.get("updatedAt"),
    }


def public_job_list_payload(job: dict) -> dict:
    base = public_job_payload(job)
    jd = str(job.get("jobDescription") or "")
    return {
        **{k: base[k] for k in base if k != "jobDescription"},
        "requiredSkills": (job.get("requiredSkills") or [])[:12],
        "jobDescription": f"{jd[:360]}…" if len(jd) > 360 else jd,
    }
