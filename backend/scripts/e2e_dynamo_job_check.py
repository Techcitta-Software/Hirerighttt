"""E2E: vendor creates job, candidate lists it, verify item in DynamoDB."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.load_env import load_env

load_env()

import boto3
from boto3.dynamodb.conditions import Attr

from app.db.dynamo.table_specs import physical_table_name
from app.db.dynamo_config import database_provider, dynamo_resource_kwargs

API = "http://127.0.0.1:8787"
UNIQUE = f"dynamo-e2e-{int(time.time())}"


def _request(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{API}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"error": raw}
        return e.code, payload


def _count_jobs_dynamo(title_substring: str | None = None) -> tuple[int, list[dict]]:
    table = boto3.resource("dynamodb", **dynamo_resource_kwargs()).Table(physical_table_name("main"))
    fe = Attr("entity_type").eq("job")
    items: list[dict] = []
    kwargs = {"FilterExpression": fe}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    if title_substring:
        matches = [
            it
            for it in items
            if title_substring.lower() in str((it.get("data") or {}).get("title") or "").lower()
            or title_substring.lower() in str(it.get("data", {}).get("title", "")).lower()
        ]
        return len(items), matches
    return len(items), items


def main() -> int:
    print(f"DATABASE_PROVIDER={database_provider()}")
    print(f"DynamoDB main table: {physical_table_name('main')}")

    health_status, health = _request("GET", "/api/health")
    print(f"Health: {health_status} {health.get('database', health)}")
    if health_status != 200:
        print("API not reachable. Start: npm run dev:all")
        return 1

    jobs_before, _ = _count_jobs_dynamo()
    print(f"Jobs in DynamoDB (entity_type=job) before: {jobs_before}")

    emp_status, emp_login = _request(
        "POST",
        "/api/login",
        {"email": "employer@hireright.com", "password": "password123", "expectedRole": "employer"},
    )
    if emp_status != 200:
        print("Employer login failed:", emp_status, emp_login)
        return 1
    emp_token = emp_login["token"]
    print("Employer logged in:", emp_login["user"]["email"])

    job_title = f"E2E Dynamo Test {UNIQUE}"
    body = {
        "title": job_title,
        "jobDescription": (
            "This is an automated end-to-end test job created to verify DynamoDB persistence. "
            "We need at least thirty characters in the description for validation."
        ),
        "roleTrack": "Software Engineer",
        "experienceLevel": "3-5 years",
        "location": "Remote",
        "requiredSkills": ["Python", "DynamoDB", "API Testing"],
        "company": "TechCitta Solutions",
    }
    create_status, created = _request("POST", "/api/vendor/jobs", body, token=emp_token)
    if create_status != 201:
        print("Create job failed:", create_status, created)
        return 1
    job = created.get("job") or {}
    job_id = job.get("id")
    share_code = job.get("shareableCode") or job.get("shareable_code")
    print(f"Created job id={job_id} title={job_title} shareableCode={share_code}")

    time.sleep(2)
    jobs_after, ddb_matches = _count_jobs_dynamo(job_title)
    print(f"Jobs in DynamoDB after: {jobs_after} (delta +{jobs_after - jobs_before})")
    ddb_ok = len(ddb_matches) >= 1
    if ddb_ok:
        sample = ddb_matches[0]
        data = sample.get("data") or {}
        print(f"DynamoDB item pk={sample.get('pk')} sk={sample.get('sk')} title={data.get('title')}")
    else:
        print("WARNING: No matching job item found in DynamoDB scan")

    cand_status, cand_login = _request(
        "POST",
        "/api/login",
        {"email": "demo@hireright.com", "password": "password123", "expectedRole": "jobseeker"},
    )
    if cand_status != 200:
        print("Candidate login failed:", cand_status, cand_login)
        return 1
    cand_token = cand_login["token"]
    print("Candidate logged in:", cand_login["user"]["email"])

    list_status, listing = _request("GET", "/api/jobs?limit=200", token=cand_token)
    if list_status != 200:
        print("List jobs failed:", list_status, listing)
        return 1
    jobs = listing.get("jobs") or []
    found = next((j for j in jobs if j.get("id") == job_id or j.get("title") == job_title), None)
    api_ok = found is not None
    print(f"Candidate /api/jobs: {len(jobs)} open jobs; test job visible={api_ok}")
    if found:
        print(f"  matched: id={found.get('id')} title={found.get('title')}")

    print("\n=== SUMMARY ===")
    print(f"  Vendor create job (HTTP 201): OK")
    print(f"  Stored in DynamoDB (job entity): {'OK' if ddb_ok else 'FAIL'}")
    print(f"  Visible on candidate /api/jobs: {'OK' if api_ok else 'FAIL'}")
    return 0 if ddb_ok and api_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())