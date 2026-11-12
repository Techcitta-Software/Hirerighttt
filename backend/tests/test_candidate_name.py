from __future__ import annotations

from app.services.interview_agent import resolve_candidate_name, same_name_person

NEW_RESUME = "Bharath Krishna Pachimatla\nAI Engineer | Generative AI | Python\nHyderabad, India | +91 9010383256"
OLD_RESUME = "Giribabu Kothapalli\nIT Recruiter\nHyderabad, India"


def test_stale_name_from_an_older_resume_is_replaced_by_the_current_resume():
    profile = {"fullName": "Giribabu Kothapalli", "resumeText": NEW_RESUME}
    assert resolve_candidate_name(profile, "Bharath krishna pachimatla") == "Bharath Krishna Pachimatla"


def test_stale_name_falls_back_to_the_signup_name_when_the_resume_has_no_readable_name():
    profile = {"fullName": "Giribabu Kothapalli", "resumeText": "ai engineer | python | fastapi | rag"}
    assert resolve_candidate_name(profile, "Bharath Krishna Pachimatla") == "Bharath Krishna Pachimatla"


def test_a_matching_saved_name_is_kept():
    profile = {"fullName": "Bharath Krishna Pachimatla", "resumeText": NEW_RESUME}
    assert resolve_candidate_name(profile, "Bharath") == "Bharath Krishna Pachimatla"


def test_a_short_saved_name_that_belongs_to_the_same_person_is_kept():
    profile = {"fullName": "Bharath", "resumeText": NEW_RESUME}
    assert resolve_candidate_name(profile, "") == "Bharath"


def test_saved_name_is_used_when_there_is_nothing_to_compare_it_with():
    assert resolve_candidate_name({"fullName": "Priya Nair"}, "") == "Priya Nair"


def test_name_comes_from_the_resume_when_nothing_is_saved():
    assert resolve_candidate_name({"resumeText": NEW_RESUME}, "") == "Bharath Krishna Pachimatla"


def test_the_demo_name_is_never_used():
    assert resolve_candidate_name({"fullName": "Arjun Sharma"}, "Bharath Krishna Pachimatla") == "Bharath Krishna Pachimatla"


def test_the_old_resume_alone_still_names_that_resume_owner():
    assert resolve_candidate_name({"resumeText": OLD_RESUME}, "") == "Giribabu Kothapalli"


def test_same_person_matching():
    assert same_name_person("Bharath", "Bharath Krishna Pachimatla")
    assert same_name_person("bharath krishna pachimatla", "Bharath  Krishna Pachimatla")
    assert not same_name_person("Giribabu Kothapalli", "Bharath Krishna Pachimatla")
    assert not same_name_person("", "Bharath")


def test_interview_profile_heals_a_stale_name_even_if_the_browser_sends_it():
    from app.server.runtime import merge_interview_profile

    db = {
        "users": [{"email": "b@example.com", "name": "Bharath krishna pachimatla"}],
        "profiles": {"b@example.com": {"fullName": "Giribabu Kothapalli", "resumeText": NEW_RESUME}},
    }
    sent_by_old_browser = {"fullName": "Giribabu Kothapalli"}
    out = merge_interview_profile(db, "b@example.com", sent_by_old_browser)
    assert out["fullName"] == "Bharath Krishna Pachimatla" and out["name"] == out["fullName"]


def test_interview_profile_keeps_a_correct_name():
    from app.server.runtime import merge_interview_profile

    db = {"users": [{"email": "p@example.com", "name": "Priya Nair"}], "profiles": {}}
    out = merge_interview_profile(db, "p@example.com", {"fullName": "Priya Nair", "resumeText": "Priya Nair\nEngineer"})
    assert out["fullName"] == "Priya Nair"
