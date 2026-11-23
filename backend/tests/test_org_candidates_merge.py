"""One directory row per candidate: a candidate who applied to two jobs of the organisation (vendor-ui QA)."""

from app.services.vendor.org_candidates import _merge_records


def _app(app_id, job_id, status="New", interview=None):
    return {
        "id": app_id,
        "source": "application",
        "jobId": job_id,
        "jobTitle": f"Job {job_id}",
        "candidateEmail": "rahul@x.test",
        "candidateName": "Rahul",
        "status": status,
        "appliedAt": f"2026-11-2{app_id[-1]}T10:00:00Z",
        "interviewResult": interview,
    }


def test_row_is_the_application_with_the_interview():
    interviewed = _app("app1", "job-fe", status="interviewed", interview={"overall": 14})
    other = _app("app2", "job-be")
    for a, b in ((other, interviewed), (interviewed, other)):
        row = _merge_records(a, b)
        assert row["id"] == "app1"
        assert row["jobId"] == "job-fe" and row["jobTitle"] == "Job job-fe"
        assert row["status"] == "interviewed"
        assert row["interviewResult"] == {"overall": 14}
        assert sorted(row["appliedJobIds"]) == ["job-be", "job-fe"]


def test_applied_job_ids_accumulate_over_several_merges():
    row = _merge_records(_app("app1", "j1"), _app("app2", "j2"))
    row = _merge_records(row, _app("app3", "j3"))
    assert row["appliedJobIds"] == ["j1", "j2", "j3"]


def test_vault_row_merged_with_application_keeps_application_id():
    vault = {"id": "v1", "source": "vault", "jobId": None, "candidateEmail": "rahul@x.test", "candidateName": "R"}
    row = _merge_records(vault, _app("app1", "j1"))
    assert row["id"] == "app1" and row["source"] == "application" and row["appliedJobIds"] == ["j1"]


def test_shortlist_survives_a_talent_record_merged_after_the_application():
    """GET /api/vendor/candidates: the talent-access record ("New") came after the application and reset its status."""
    app = _app("app1", "j1", status="Shortlisted")
    talent = {"id": "talent-u1", "source": "interview", "jobId": None, "candidateEmail": "rahul@x.test", "status": "New"}
    assert _merge_records(app, talent)["status"] == "Shortlisted"
    assert _merge_records(talent, app)["status"] == "Shortlisted"


# ── Two jobs, one row: per-application data (gap: filter by the other job showed the interviewed job's data) ──


def _two_jobs_row():
    interviewed = {**_app("app1", "job-fe", status="In Review", interview={"overall": 82}), "atsScore": 71, "jdMatchScore": 64}
    other = {**_app("app2", "job-be", status="Shortlisted"), "atsScore": 40, "jdMatchScore": 35}
    return _merge_records(other, interviewed)


def test_merged_row_keeps_each_application_with_its_own_scores():
    row = _two_jobs_row()
    apps = {a["jobId"]: a for a in row["applications"]}
    assert set(apps) == {"job-fe", "job-be"}
    assert apps["job-fe"]["applicationId"] == "app1" and apps["job-fe"]["interviewed"] is True
    assert apps["job-fe"]["interviewScore"] == 82 and apps["job-fe"]["atsScore"] == 71
    assert apps["job-be"]["applicationId"] == "app2" and apps["job-be"]["interviewed"] is False
    assert apps["job-be"]["status"] == "Shortlisted" and apps["job-be"]["atsScore"] == 40
    assert row["interviewJobId"] == "job-fe"


def test_projection_onto_the_other_job_uses_that_application():
    from app.services.vendor.org_candidates import project_to_job

    row = _two_jobs_row()
    be = project_to_job(row, "job-be")
    assert be["id"] == "app2" and be["jobId"] == "job-be" and be["jobTitle"] == "Job job-be"
    assert be["status"] == "Shortlisted" and be["atsScore"] == 40 and be["jdMatchScore"] == 35
    assert be["interviewJobId"] == "job-fe"  # the interview shown is attributed to the job it was taken for
    fe = project_to_job(row, "job-fe")
    assert fe["id"] == "app1" and fe["atsScore"] == 71
    assert project_to_job(row, "job-unknown") is row


def test_applications_survive_further_merges_without_duplicates():
    row = _two_jobs_row()
    session_copy = _app("app1", "job-fe", status="In Review", interview={"overall": 82})
    row = _merge_records(row, session_copy)
    row = _merge_records(row, {"id": "talent-u1", "source": "interview", "candidateEmail": "rahul@x.test"})
    assert sorted(a["applicationId"] for a in row["applications"]) == ["app1", "app2"]


def test_job_filter_matches_any_applied_job_and_projects(monkeypatch):
    from app.services.vendor import org_candidates as oc

    row = _two_jobs_row()
    assert oc._matches_filters(row, {"jobId": "job-be"}) is True
    assert oc._matches_filters(row, {"jobId": "job-zz"}) is False


def test_list_job_candidates_shows_the_filtered_jobs_application():
    from app.services.vendor.org_candidates import list_job_candidates

    resume = "Python developer. Built REST APIs with Flask and PostgreSQL." * 2
    db = {
        "users": [{"id": "u1", "email": "rahul@x.test", "role": "jobseeker", "status": "active"}],
        "profiles": {},
        "interviews": {},
        "jobs": [],
        "employerApplications": [
            {"id": "app1", "organizationId": "org-1", "jobId": "job-fe", "candidateEmail": "rahul@x.test",
             "status": "interviewed", "appliedAt": "2026-11-01T10:00:00Z",
             "data": {"jobTitle": "Frontend", "resumeText": resume, "atsScore": 71, "interviewResult": {"overall": 82}}},
            {"id": "app2", "organizationId": "org-1", "jobId": "job-be", "candidateEmail": "rahul@x.test",
             "status": "shortlisted", "appliedAt": "2026-11-02T10:00:00Z",
             "data": {"jobTitle": "Backend", "resumeText": resume, "atsScore": 40}},
        ],
    }
    out = list_job_candidates(db, "org-1", "job-be")
    assert out["total"] == 1
    row = out["candidates"][0]
    assert row["id"] == "app2" and row["jobTitle"] == "Backend" and row["atsScore"] == 40
    assert row["status"] == "Shortlisted"
