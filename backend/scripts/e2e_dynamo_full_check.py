"""
Full DynamoDB E2E: dummy signup, session, vendor job, candidate listing.
Run with API up: python scripts/e2e_dynamo_full_check.py
"""

from __future__ import annotations

import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.load_env import load_env

load_env()

import boto3
from boto3.dynamodb.conditions import Attr

from app.db.dynamo.table_specs import physical_table_name
from app.db.dynamo_config import database_provider, dynamo_resource_kwargs

API = "http://127.0.0.1:8787"
TS = int(time.time())
TAG = f"full-e2e-{TS}"


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def _table():
    return boto3.resource("dynamodb", **dynamo_resource_kwargs()).Table(physical_table_name("main"))


def _get(pk: str, sk: str = "META") -> dict | None:
    return _table().get_item(Key={"pk": pk, "sk": sk}).get("Item")


def _request(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{API}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"error": raw}
        return e.code, payload


def _count_entity(entity_type: str) -> int:
    n = 0
    kwargs: dict = {"FilterExpression": Attr("entity_type").eq(entity_type), "Select": "COUNT"}
    while True:
        resp = _table().scan(**kwargs)
        n += int(resp.get("Count", 0))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return n


def main() -> int:
    results: list[Check] = []
    print(f"=== DynamoDB full E2E ({TAG}) ===")
    print(f"provider={database_provider()} table={physical_table_name('main')}\n")

    st, health = _request("GET", "/api/health")
    db = health.get("database") or {}
    db_ok = (
        st == 200
        and db.get("connected")
        and (db.get("storage") == "dynamodb" or db.get("dynamodb"))
    )
    results.append(Check("API health + DynamoDB", db_ok, json.dumps(db, default=str)))
    if not db_ok:
        _print(results)
        return 1

    counts_before = {et: _count_entity(et) for et in ("user", "job", "hireright_session", "talent_profile")}
    print("Entity counts (before):", counts_before)

    # --- 1) New candidate signup ---
    cand_email = f"candidate-{TAG}@test.hireright.local"
    cand_phone = f"+9198{secrets.randbelow(10**8):08d}"
    st, signup = _request(
        "POST",
        "/api/signup",
        {
            "email": cand_email,
            "password": "password123",
            "name": f"Candidate {TAG}",
            "phone": cand_phone,
            "role": "jobseeker",
        },
    )
    uid = (signup.get("user") or {}).get("id") if st == 201 else None
    user_item = _get(f"USER#{uid}") if uid else None
    results.append(
        Check(
            "Signup candidate (HTTP 201)",
            st == 201 and uid is not None,
            f"status={st} userId={uid}",
        )
    )
    results.append(
        Check(
            "DynamoDB user row",
            user_item is not None and (user_item.get("data") or {}).get("email") == cand_email,
            f"pk=USER#{uid}" if uid else "missing",
        )
    )

    cand_token = signup.get("token") if st == 201 else None
    sess_item = _get(f"SESSION#{cand_token}") if cand_token else None
    results.append(
        Check(
            "DynamoDB session after signup",
            sess_item is not None and (sess_item.get("data") or {}).get("email") == cand_email,
            f"pk=SESSION#{cand_token[:8]}..." if cand_token else "no token",
        )
    )

    # Profile saved via save_db on signup
    st_me, me = _request("GET", "/api/me", token=cand_token)
    results.append(Check("GET /api/me (candidate)", st_me == 200 and me.get("user", {}).get("email") == cand_email, f"status={st_me}"))

    # --- 2) Employer job ---
    st, emp = _request(
        "POST",
        "/api/login",
        {"email": "employer@hireright.com", "password": "password123", "expectedRole": "employer"},
    )
    emp_token = emp.get("token") if st == 200 else None
    results.append(Check("Login employer (demo)", st == 200, f"status={st}"))

    job_title = f"Dummy Job {TAG}"
    st, created = _request(
        "POST",
        "/api/vendor/jobs",
        {
            "title": job_title,
            "jobDescription": (
                f"Automated dummy job {TAG}. We validate DynamoDB writes for vendor workflows. "
                "Minimum thirty characters required here."
            ),
            "roleTrack": "Backend Engineer",
            "experienceLevel": "2-4 years",
            "location": "Hyderabad, Remote",
            "requiredSkills": ["Node.js", "AWS", "Testing"],
        },
        token=emp_token,
    )
    job = created.get("job") or {}
    job_id = job.get("id")
    org_id = job.get("organizationId") or (emp.get("user") or {}).get("primaryOrganizationId")
    job_item = _get(f"ORG#{org_id}", f"JOB#{job_id}") if job_id and org_id else None
    results.append(Check("Vendor create job (HTTP 201)", st == 201 and job_id, f"jobId={job_id} status={st}"))
    results.append(
        Check(
            "DynamoDB job row",
            job_item is not None and (job_item.get("data") or {}).get("title") == job_title,
            f"pk=ORG#{org_id} sk=JOB#{job_id}" if job_id else "missing",
        )
    )

    st, vendor_jobs = _request("GET", "/api/vendor/jobs", token=emp_token)
    vendor_has = any((j.get("id") == job_id or j.get("title") == job_title) for j in (vendor_jobs.get("jobs") or []))
    results.append(Check("Vendor job list includes new job", st == 200 and vendor_has, f"total={vendor_jobs.get('total')}"))

    # --- 3) Candidate sees open jobs ---
    st, listing = _request("GET", "/api/jobs?limit=200", token=cand_token)
    open_has = any((j.get("id") == job_id or j.get("title") == job_title) for j in (listing.get("jobs") or []))
    results.append(
        Check(
            "Candidate /api/jobs lists new job",
            st == 200 and open_has,
            f"openJobs={len(listing.get('jobs') or [])}",
        )
    )

    # --- 4) Public job link (no auth) — proves job readable from Dynamo-backed store ---
    code = job.get("shareableCode") or job.get("shareable_code") or ""
    pub_path = f"/api/jobs/public/{code}"
    st, pub = _request("GET", pub_path)
    pub_job = (pub.get("job") or {})
    results.append(
        Check(
            "Public job link resolves",
            st == 200 and pub_job.get("id") == job_id,
            f"GET {pub_path} title={pub_job.get('title', '?')[:40]}",
        )
    )

    time.sleep(1)
    counts_after = {et: _count_entity(et) for et in ("user", "job", "hireright_session", "talent_profile")}
    print("\nEntity counts (after):", counts_after)
    print(
        "Deltas:",
        {k: counts_after[k] - counts_before[k] for k in counts_before},
    )

    user_delta = counts_after["user"] - counts_before["user"]
    job_delta = counts_after["job"] - counts_before["job"]
    session_delta = counts_after["hireright_session"] - counts_before["hireright_session"]
    results.append(Check("Dynamo user count increased", user_delta >= 1, f"+{user_delta}"))
    results.append(Check("Dynamo job count increased", job_delta >= 1, f"+{job_delta}"))
    results.append(Check("Dynamo session count increased", session_delta >= 1, f"+{session_delta}"))

    _print(results)
    failed = [c for c in results if not c.ok]
    if failed:
        print(f"\n{len(failed)} check(s) FAILED.")
        return 1
    print(f"\nAll {len(results)} checks PASSED — dummy data is in DynamoDB and APIs agree.")
    return 0


def _print(results: list[Check]) -> None:
    print("\n--- Results ---")
    for c in results:
        mark = "PASS" if c.ok else "FAIL"
        print(f"  [{mark}] {c.name}: {c.detail}")


if __name__ == "__main__":
    raise SystemExit(main())