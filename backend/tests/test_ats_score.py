"""Resume-vs-JD ATS scoring: real skills only, whole-word matching, stable order."""

from __future__ import annotations

from app.services.vendor.ats_score import compute_ats_score, extract_primary_skills_from_jd

JD = (
    "We are hiring a Backend Engineer to design and build Python services for our hiring platform. "
    "You will build REST APIs with Django and FastAPI, model data in PostgreSQL, write efficient SQL, "
    "containerise services with Docker and deploy on AWS. You will write tests and review code."
)
REQUIRED = ["Python", "Django", "PostgreSQL", "REST APIs", "Docker", "AWS"]
GOOD_RESUME = (
    "Backend developer, 4 years. Built REST APIs in Django and FastAPI, designed PostgreSQL schemas, "
    "optimised SQL queries, wrote pytest suites. Skills: Python, Django, FastAPI, PostgreSQL, SQL, Redis, Git."
)


def test_listed_skills_first_then_jd_skills_in_order() -> None:
    skills = extract_primary_skills_from_jd(JD, REQUIRED)
    assert skills[:6] == REQUIRED
    assert skills[6:] == ["FastAPI", "SQL"]


def test_no_filler_words_become_skills() -> None:
    skills = {s.lower() for s in extract_primary_skills_from_jd(JD, [])}
    for filler in ("are", "build", "services", "hiring", "platform", "design", "write", "engineer"):
        assert filler not in skills
    assert {"python", "django", "postgresql", "docker", "aws"} <= skills


def test_order_is_stable() -> None:
    assert extract_primary_skills_from_jd(JD, []) == extract_primary_skills_from_jd(JD, [])


def test_good_resume_scores_well_and_lists_real_gaps() -> None:
    r = compute_ats_score({"jobDescription": JD, "resumeText": GOOD_RESUME, "requiredSkills": REQUIRED})
    assert r["atsScore"] >= 60
    assert r["matchedSkills"][:4] == ["Python", "Django", "PostgreSQL", "REST APIs"]
    assert r["missingSkills"] == ["Docker", "AWS"]


def test_unrelated_resume_scores_low() -> None:
    r = compute_ats_score(
        {"jobDescription": JD, "resumeText": "Sales executive. Excel, negotiation, CRM.", "requiredSkills": REQUIRED}
    )
    assert r["atsScore"] < 15
    assert r["matchedSkills"] == []


def test_whole_word_and_case_aware_matching() -> None:
    r = compute_ats_score({"jobDescription": "Go developer " * 5, "resumeText": "I use Google Docs and go to work", "requiredSkills": ["Go"]})
    assert r["matchedSkills"] == []
    r = compute_ats_score({"jobDescription": "Go developer " * 5, "resumeText": "Built services in Go and Rust", "requiredSkills": ["Go"]})
    assert r["matchedSkills"] == ["Go"]


def test_spelling_variants_match() -> None:
    r = compute_ats_score(
        {"jobDescription": "x" * 40, "resumeText": "Worked with Postgres, NodeJS and RESTful API design", "requiredSkills": ["PostgreSQL", "Node.js", "REST APIs"]}
    )
    assert r["matchedSkills"] == ["PostgreSQL", "Node.js", "REST APIs"]


def test_non_tech_jd_without_skill_list_still_gets_skills() -> None:
    skills = [s.lower() for s in extract_primary_skills_from_jd("Sales executive with negotiation, CRM and Excel reporting.", [])]
    assert "negotiation" in skills and "excel" in skills
    assert "with" not in skills and "and" not in skills
