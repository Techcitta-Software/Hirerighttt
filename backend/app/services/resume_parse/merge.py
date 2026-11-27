"""Field cleanup shared by the LLM extract and the rules extract.

A trailing city is moved out of the company. No employer is created or removed.
"""

from __future__ import annotations

from app.services.resume_parse.deterministic import place_tail


def split_company_place(job: dict) -> dict:
    """('KMC Hospital, Mangaluru') -> company 'KMC Hospital', location 'Mangaluru' when location is empty.

    Unknown tails stay on the company. An empty company is left as written.
    """
    company = str(job.get("company") or "").strip()
    if not company:
        return job
    kept, tail = place_tail(company)
    kept, tail = kept.strip(), tail.strip()
    if not tail or not kept or kept == company:
        return job
    out = {**job, "company": kept}
    if not str(job.get("location") or "").strip():
        out["location"] = tail
    return out


def apply_company_places(extract: dict | None) -> dict:
    """Strip a trailing ', City' from each job's company into location. The job list is not extended."""
    if not isinstance(extract, dict):
        return {}
    jobs = extract.get("workExperiences")
    if not isinstance(jobs, list):
        return extract
    return {
        **extract,
        "workExperiences": [split_company_place(job) if isinstance(job, dict) else job for job in jobs],
    }
