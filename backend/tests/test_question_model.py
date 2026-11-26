"""Resume-only technical vs non-technical question model."""

from __future__ import annotations

from app.services.interview_question_model import classify_question_model


def _model(profile: dict) -> dict:
    return classify_question_model(profile)


def test_sales_executive_is_non_technical_high() -> None:
    out = _model({"currentRole": "Sales Executive"})
    assert out["questionModel"] == "non_technical"
    assert out["questionModelConfidence"] == "high"


def test_software_engineer_is_technical_high() -> None:
    out = _model({"currentRole": "Software Engineer"})
    assert out["questionModel"] == "technical"
    assert out["questionModelConfidence"] == "high"


def test_sales_engineer_is_mixed_non_technical_not_tech() -> None:
    out = _model({"currentRole": "Sales Engineer"})
    assert out["questionModel"] == "non_technical"
    assert out["questionModel"] != "technical"
    assert out["questionModelConfidence"] == "medium"


def test_python_developer_is_technical() -> None:
    out = _model({"currentRole": "Python Developer"})
    assert out["questionModel"] == "technical"
    assert out["questionModelConfidence"] == "high"


def test_data_analyst_with_three_tech_skills_is_technical() -> None:
    out = _model({"currentRole": "Data Analyst", "skills": ["Python", "SQL", "Spark"]})
    assert out["questionModel"] == "technical"


def test_data_analyst_with_excel_only_is_non_technical() -> None:
    out = _model({"currentRole": "Data Analyst", "skills": ["Excel"]})
    assert out["questionModel"] == "non_technical"


def test_empty_resume_defaults_technical_low() -> None:
    out = _model({})
    assert out["questionModel"] == "technical"
    assert out["questionModelConfidence"] == "low"
    assert out["questionModelReason"] == "thin_default_technical"


def test_mba_without_engineering_degree_or_skills_is_non_technical_low() -> None:
    out = _model({"education": [{"degree": "MBA"}], "skills": []})
    assert out["questionModel"] == "non_technical"
    assert out["questionModelConfidence"] == "low"
    assert out["questionModelReason"] == "thin_commerce_degree"


def test_java_and_react_without_a_title_are_technical_medium() -> None:
    out = _model({"skills": ["Java", "React"]})
    assert out["questionModel"] == "technical"
    assert out["questionModelConfidence"] == "medium"


def test_stored_question_model_is_not_trusted() -> None:
    out = _model({"questionModel": "non_technical", "currentRole": "Software Engineer"})
    assert out["questionModel"] == "technical"


def test_job_interview_nontech_questions_keep_the_fifteen_point_slot() -> None:
    from app.services.interview_jd_plan import SLOT_ALIGNMENT, SLOT_JD, fallback_question_for_slot
    from app.services.interview_weighting import is_technical

    jd = fallback_question_for_slot(
        {"slot": SLOT_JD, "target": "renewals", "targetKind": "skill"},
        "Account Executive",
        "non_technical",
    )
    assert jd["questionModel"] == "non_technical"
    assert jd["scoringProfile"] == "situational"
    assert jd["planSlot"] == SLOT_JD
    assert "lookFor" in jd
    assert is_technical(jd) is True
    assert "debug" not in jd["text"].lower()

    aligned = fallback_question_for_slot(
        {"slot": SLOT_ALIGNMENT, "target": "Salesforce"},
        "",
        "non_technical",
    )
    assert aligned["scoringProfile"] == "achievement"
    assert is_technical(aligned) is False

    technical = fallback_question_for_slot({"slot": SLOT_JD, "target": "Python"}, "", "technical")
    assert technical.get("questionModel") != "non_technical"
    assert technical["scoringProfile"] == "technical"
