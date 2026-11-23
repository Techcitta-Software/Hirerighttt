"""Career score = interview score, deterministic Role Skills Fit, and ranked applicant lists (tenant-scoped).

Pure in-memory data; heuristic scoring path (no LLM, no database, no network).
"""

from __future__ import annotations

import copy
import json

from app.services.interview_agent import career_score_for, career_status_for, score_session
from app.services.proctoring.score_penalty import apply_face_deviation_penalty_to_result
from app.services.role_skills_fit_scoring import (
    INTERVIEW_POINTS,
    RESUME_POINTS,
    compute_role_skills_fit,
)
from app.services.vendor.applicant_ranking import rank_job_applicants
from app.services.vendor.jobs import (
    create_job_application,
    create_vendor_job,
    list_job_applications,
    update_application_interview,
)

BAND_WORDS = ("Premium", "Market-Ready", "Industry Ready", "Growth Potential", "Skill Enhancement", "percentile", "/1000")

PROFILE = {
    "fullName": "Priya Nair",
    "currentRole": "Backend Developer",
    "skills": ["Node.js", "PostgreSQL", "Redis", "Docker"],
    "resumeText": "Backend developer. Built REST APIs in Node.js and Express on PostgreSQL with Redis caching.",
}
QUESTIONS = [
    {"text": "How does the Node.js event loop handle many concurrent requests?", "topic": "Node.js", "category": "Technical"},
    {"text": "Explain how indexes work in PostgreSQL and when they hurt writes.", "topic": "PostgreSQL", "category": "Technical"},
    {"text": "How would you design versioned REST APIs for a public client?", "topic": "REST APIs", "category": "Technical"},
]
STRONG = [
    "Node.js runs JavaScript on a single thread with an event loop. I/O is handed to libuv, so while a database "
    "query is waiting the loop serves other requests; CPU heavy work blocks it, so I move that to worker threads.",
    "A PostgreSQL index is usually a B-tree, so the planner can find rows without a sequential scan. Every insert "
    "and update must also maintain the index, so write heavy tables with many indexes get slower.",
    "I version REST APIs in the URL path, keep old versions until clients migrate, use proper HTTP status codes, "
    "and document each endpoint with OpenAPI so client teams can generate typed clients.",
]
WEAK = ["I am not sure.", "Indexes are a thing in databases I think.", "I have not done that."]


def _score(answers, required_skills=None):
    return score_session(
        role="Backend Developer",
        level="3-5 years",
        questions=QUESTIONS,
        answers=answers,
        profile=PROFILE,
        name="Priya Nair",
        required_skills=required_skills,
    )


# ── Item 3: one career score, equal to the interview score ────────────────────────────────────────────


def test_career_score_is_the_interview_score_on_a_0_to_100_scale():
    for overall in (0, 1, 37, 64.6, 100):
        assert career_score_for(overall) == max(0, min(100, round(overall)))
    assert career_score_for(140) == 100 and career_score_for(-5) == 0


def test_report_shows_one_number_and_no_band_labels():
    result = _score(STRONG)
    sc = result["scorecard"]
    assert sc["careerScore"] == result["overall"] == sc["sessionStats"]["overallInterviewScore"]
    text = json.dumps({k: sc[k] for k in ("finalCareerStatus", "bandInterpretation", "coachNotes")})
    assert not any(w in text for w in BAND_WORDS)
    assert career_status_for(90) == career_status_for(10)  # the status line never depends on a band


def test_proctoring_penalty_moves_career_score_with_the_interview_score_and_is_shown():
    result = _score(STRONG)
    before = result["overall"]
    apply_face_deviation_penalty_to_result(result, 2)
    assert result["overall"] == max(0, before - 10)
    assert result["scorecard"]["careerScore"] == result["overall"]
    assert result["scoreBeforeProctorPenalty"] == before and result["proctorScorePenalty"] == 10


# ── Item 8: deterministic, explainable Role Skills Fit ────────────────────────────────────────────────

CTX = {"skills": ["Node.js", "PostgreSQL"], "resumeSnippet": "Node.js and PostgreSQL developer"}
REQ = ["Node.js", "PostgreSQL", "REST APIs"]


def test_skills_fit_is_deterministic():
    runs = [compute_role_skills_fit(CTX, REQ, QUESTIONS, STRONG, [82, 78, 74]) for _ in range(5)]
    assert all(r == runs[0] for r in runs)
    full = [_score(STRONG)["roleSkillsAnalysis"] for _ in range(3)]
    assert all(r == full[0] for r in full)


def test_skills_fit_points_are_explainable():
    out = compute_role_skills_fit(CTX, REQ, QUESTIONS, STRONG, [82, 78, 74])
    by_skill = {r["skill"]: r for r in out["skills"]}
    # Node.js + PostgreSQL: on resume (40) and demonstrated (60); REST APIs: demonstrated only (60).
    assert by_skill["Node.js"]["points"] == RESUME_POINTS + INTERVIEW_POINTS == 100
    assert by_skill["REST APIs"]["points"] == INTERVIEW_POINTS and not by_skill["REST APIs"]["onResume"]
    assert out["fitScore"] == round((100 + 100 + 60) / 3)
    assert out["missingSkills"] == [] and out["matchedSkills"] == REQ
    assert "40 points" in out["method"]


def test_strong_candidate_ranks_above_weak_candidate():
    strong = compute_role_skills_fit(CTX, REQ, QUESTIONS, STRONG, [82, 78, 74])
    weak = compute_role_skills_fit(CTX, REQ, QUESTIONS, WEAK, [10, 20, 5])
    nothing = compute_role_skills_fit({"skills": [], "resumeSnippet": ""}, REQ, QUESTIONS, WEAK, [10, 20, 5])
    assert strong["fitScore"] > weak["fitScore"] > nothing["fitScore"] == 0
    assert weak["missingSkills"] == ["REST APIs"]  # on neither the resume nor demonstrated
    assert _score(STRONG)["resumeFitScore"] > _score(WEAK)["resumeFitScore"]


def test_buzzwords_in_low_scoring_answers_earn_no_interview_credit():
    stuffed = ["Node.js Node.js event loop", "PostgreSQL index", "REST APIs REST"]
    out = compute_role_skills_fit(CTX, REQ, QUESTIONS, stuffed, [20, 15, 10])
    assert out["evidencedInAnswers"] == []


def test_one_number_for_skills_fit_across_the_report():
    result = _score(STRONG)
    fit = result["roleSkillsAnalysis"]["fitScore"]
    dims = {c["label"]: c["score"] for c in result["categories"]}
    assert result["resumeFitScore"] == fit == result["scorecard"]["industryAlignment"] == dims["Role Skills Fit"]


def test_job_interviews_use_the_jobs_required_skills():
    result = _score(STRONG, required_skills=["Kubernetes", "Go"])
    analysis = result["roleSkillsAnalysis"]
    assert analysis["skillSource"] == "job" and analysis["requiredSkills"] == ["Kubernetes", "Go"]
    assert analysis["fitScore"] == 0 and analysis["missingSkills"] == ["Kubernetes", "Go"]


# ── Item 4: applicants ranked by top candidature, tenant-scoped ──────────────────────────────────────


def _vendor_db():
    db = {"users": [], "profiles": {}, "jobs": [], "employerApplications": []}
    job = create_vendor_job(
        db, "org-a", "u-a", {"title": "Backend Engineer", "roleTrack": "Backend Developer", "experienceLevel": "3-5 Years", "location": "Bengaluru", "jobDescription": "Backend engineer building Node.js services on PostgreSQL with REST APIs.", "requiredSkills": REQ}
    )
    other = create_vendor_job(db, "org-b", "u-b", {"title": "Other", "roleTrack": "Go Developer", "experienceLevel": "3-5 Years", "location": "Pune", "jobDescription": "Go engineer building distributed systems and gRPC services.", "requiredSkills": ["Go"]})
    return db, job, other


def _apply(db, job, email, applied_at):
    app = create_job_application(db, job, {"candidateEmail": email, "candidateName": email.split("@")[0], "resumeText": "Node.js"})[
        "application"
    ]
    app["appliedAt"] = applied_at
    return app


def _interview(db, app, overall, fit, completed):
    result = {"overall": overall, "date": completed, "roleSkillsAnalysis": {"requiredSkills": REQ, "fitScore": fit}}
    updated = update_application_interview(db, app["id"], app["organizationId"], result)
    updated["data"]["evaluatedAt"] = completed


def test_applicants_are_ranked_by_score_then_fit_then_completion_time():
    db, job, _ = _vendor_db()
    a = _apply(db, job, "a@x.com", "2026-11-01T09:00:00Z")
    b = _apply(db, job, "b@x.com", "2026-11-01T10:00:00Z")
    c = _apply(db, job, "c@x.com", "2026-11-01T11:00:00Z")
    d = _apply(db, job, "d@x.com", "2026-11-01T12:00:00Z")
    e = _apply(db, job, "e@x.com", "2026-11-01T13:00:00Z")  # applied, not interviewed yet
    _interview(db, a, 70, 60, "2026-11-02T10:00:00Z")
    _interview(db, b, 82, 50, "2026-11-02T12:00:00Z")
    _interview(db, c, 70, 80, "2026-11-02T11:00:00Z")
    _interview(db, d, 70, 60, "2026-11-02T09:00:00Z")  # same score+fit as a, finished earlier

    ranked = rank_job_applicants(list_job_applications(db, "org-a", job["id"]))
    assert [r["candidateEmail"] for r in ranked] == ["b@x.com", "c@x.com", "d@x.com", "a@x.com", "e@x.com"]
    assert [r["rank"] for r in ranked] == [1, 2, 3, 4, None]
    assert ranked[0]["rankInterviewScore"] == 82 and ranked[1]["rankRoleSkillsFit"] == 80
    # Ranking is stable: the same rows in any input order give the same ranking.
    again = rank_job_applicants(list(reversed(copy.deepcopy(list_job_applications(db, "org-a", job["id"])))))
    assert [r["id"] for r in again] == [r["id"] for r in ranked]


def test_finished_interview_is_on_the_application_the_recruiter_lists():
    db, job, _ = _vendor_db()
    app = _apply(db, job, "a@x.com", "2026-11-01T09:00:00Z")
    _interview(db, app, 77, 60, "2026-11-02T10:00:00Z")
    [row] = rank_job_applicants(list_job_applications(db, "org-a", job["id"]))
    assert row["data"]["interviewResult"]["overall"] == 77 and row["rank"] == 1


def test_other_organisations_never_see_or_rank_these_applicants():
    db, job, other = _vendor_db()
    app = _apply(db, job, "a@x.com", "2026-11-01T09:00:00Z")
    _interview(db, app, 90, 90, "2026-11-02T10:00:00Z")
    assert list_job_applications(db, "org-b", job["id"]) == []
    assert rank_job_applicants(list_job_applications(db, "org-b", job["id"])) == []
    assert list_job_applications(db, "org-a", other["id"]) == []
    # A result cannot be written onto another organisation's application either.
    assert update_application_interview(db, app["id"], "org-b", {"overall": 1}) is None
