from __future__ import annotations

from app.services.candidate_name import (
    apply_resume_name,
    candidate_display_name,
    name_from_resume_text,
    normalize_person_name,
    resume_name,
)
from app.services.interview_agent import resolve_candidate_name, same_name_person, summarize_profile

NEW_RESUME = (
    "Bharath Krishna Pachimatla\nAI Engineer | Generative AI | Python\nHyderabad, India | +91 9010383256"
)
OLD_RESUME = "Giribabu Kothapalli\nIT Recruiter\nHyderabad, India"
CAPS_RESUME = "KAVYA IYER\nSenior Data Analyst\nkavya@example.com | +91 98765 43210"


# --- rule 1: the resume name always wins ------------------------------------------------------------------------


def test_resume_name_beats_a_different_signup_name():
    assert resolve_candidate_name({"resumeText": NEW_RESUME}, "Ravi Teja") == "Bharath Krishna Pachimatla"


def test_resume_name_beats_a_different_saved_profile_name():
    profile = {"fullName": "Giribabu Kothapalli", "resumeText": NEW_RESUME}
    assert resolve_candidate_name(profile, "Bharath krishna pachimatla") == "Bharath Krishna Pachimatla"


def test_resume_name_beats_a_short_saved_name_of_the_same_person():
    profile = {"fullName": "Bharath", "resumeText": NEW_RESUME}
    assert resolve_candidate_name(profile, "") == "Bharath Krishna Pachimatla"


def test_parsed_resume_name_is_used_when_it_is_written_on_the_resume():
    text = "Curriculum Vitae\nB. K. Pachimatla\nPython | FastAPI"
    profile = {
        "resumeFullName": "Bharath Krishna Pachimatla",
        "resumeText": "Bharath Krishna Pachimatla\n" + text,
    }
    assert resolve_candidate_name(profile, "Someone Else") == "Bharath Krishna Pachimatla"


def test_parsed_name_that_is_not_on_the_resume_is_ignored():
    profile = {"resumeFullName": "Mallory Fake", "resumeText": NEW_RESUME}
    assert resolve_candidate_name(profile, "") == "Bharath Krishna Pachimatla"


def test_old_resume_alone_names_that_resume_owner():
    assert resolve_candidate_name({"resumeText": OLD_RESUME}, "Bharath") == "Giribabu Kothapalli"


# --- rule 2: fall back to the signup name -----------------------------------------------------------------------


def test_no_resume_falls_back_to_the_signup_name():
    assert resolve_candidate_name({}, "Priya Nair") == "Priya Nair"
    assert resolve_candidate_name({"fullName": "Typed Name"}, "Priya Nair") == "Priya Nair"


def test_unreadable_resume_name_falls_back_to_the_signup_name():
    profile = {"fullName": "Giribabu Kothapalli", "resumeText": "ai engineer | python | fastapi | rag"}
    assert resolve_candidate_name(profile, "Bharath Krishna Pachimatla") == "Bharath Krishna Pachimatla"


def test_nothing_at_all_is_candidate():
    assert resolve_candidate_name({}, "") == "Candidate"


def test_saved_name_is_used_when_there_is_no_resume_and_no_account_name():
    assert resolve_candidate_name({"fullName": "Priya Nair"}, "") == "Priya Nair"


def test_the_demo_name_is_never_used_as_a_fallback():
    assert (
        resolve_candidate_name({"fullName": "Arjun Sharma"}, "Bharath Krishna Pachimatla")
        == "Bharath Krishna Pachimatla"
    )


# --- extraction guards and normalisation ---------------------------------------------------------------------------


def test_job_titles_and_technologies_are_not_names():
    assert name_from_resume_text("Senior Software Engineer\nPython | AWS | React") == ""
    assert name_from_resume_text("Python Developer\nReact Node AWS") == ""


def test_all_caps_resume_names_are_title_cased():
    assert name_from_resume_text(CAPS_RESUME) == "Kavya Iyer"
    assert resolve_candidate_name({"resumeText": CAPS_RESUME}, "kavya") == "Kavya Iyer"
    assert normalize_person_name("KAVYA  IYER") == "Kavya Iyer"
    assert normalize_person_name("d'souza") == "D'Souza"


def test_initials_and_mixed_case_names_are_kept():
    assert name_from_resume_text("K. Ramesh Rao\nBackend Engineer") == "K. Ramesh Rao"
    assert normalize_person_name("Ronald McDonald") == "Ronald McDonald"
    assert normalize_person_name("B.K. SINGH") == "B.K. Singh"


def test_name_label_line_is_read():
    assert name_from_resume_text("RESUME\nName: ananya rao\nEmail: a@x.com") == "Ananya Rao"


def test_same_person_matching():
    assert same_name_person("Bharath", "Bharath Krishna Pachimatla")
    assert same_name_person("bharath krishna pachimatla", "Bharath  Krishna Pachimatla")
    assert not same_name_person("Giribabu Kothapalli", "Bharath Krishna Pachimatla")
    assert not same_name_person("", "Bharath")


def test_interviewer_greeting_context_uses_the_resume_name():
    ctx = summarize_profile({"fullName": "Ravi Teja", "resumeText": NEW_RESUME}, "Ravi Teja")
    assert ctx["name"] == "Bharath Krishna Pachimatla"


# --- rule 3/4: persistence and replacing the resume ---------------------------------------------------------------


def test_apply_resume_name_persists_the_resume_name_over_a_contradicting_client_name():
    out = apply_resume_name(
        {"fullName": "Ravi Teja", "name": "Ravi Teja", "resumeText": NEW_RESUME}, "Ravi Teja"
    )
    assert out["fullName"] == out["name"] == out["resumeFullName"] == "Bharath Krishna Pachimatla"


def test_apply_resume_name_without_resume_uses_signup_name():
    out = apply_resume_name({"fullName": "Typed"}, "Priya Nair")
    assert out["fullName"] == "Priya Nair" and "resumeFullName" not in out


def test_replacing_the_resume_updates_the_name():
    from app.services.resume_replace import build_resume_replacement_profile

    prev = apply_resume_name({"resumeText": OLD_RESUME, "resumeName": "old.pdf"}, "Account Name")
    assert prev["fullName"] == "Giribabu Kothapalli"
    replaced = build_resume_replacement_profile(
        prev,
        extract={"fullName": "BHARATH KRISHNA PACHIMATLA", "resumeText": NEW_RESUME},
        upload={"resumeStoragePath": "users/u1/resume/new.pdf"},
        filename="new.pdf",
    )
    replaced = apply_resume_name(replaced, "Account Name")
    assert replaced["fullName"] == replaced["name"] == "Bharath Krishna Pachimatla"
    assert resume_name(replaced) == "Bharath Krishna Pachimatla"


def test_interview_profile_heals_a_stale_name_even_if_the_browser_sends_it():
    from app.server.runtime import merge_interview_profile

    db = {
        "users": [{"email": "b@example.com", "name": "Bharath krishna pachimatla"}],
        "profiles": {"b@example.com": {"fullName": "Giribabu Kothapalli", "resumeText": NEW_RESUME}},
    }
    out = merge_interview_profile(db, "b@example.com", {"fullName": "Giribabu Kothapalli"})
    assert out["fullName"] == "Bharath Krishna Pachimatla" and out["name"] == out["fullName"]


def test_interview_profile_ignores_the_signup_name_when_the_resume_differs():
    from app.server.runtime import merge_interview_profile

    db = {"users": [{"email": "p@example.com", "name": "Signup Person"}], "profiles": {}}
    out = merge_interview_profile(
        db, "p@example.com", {"fullName": "Signup Person", "resumeText": "Priya Nair\nEngineer"}
    )
    assert out["fullName"] == "Priya Nair"


def test_talent_index_record_uses_the_resume_name():
    from app.db.talent_index import build_talent_record

    rec = build_talent_record(
        {"id": "u1", "email": "k@example.com", "name": "Signup Name"},
        {"fullName": "Signup Name", "resumeText": CAPS_RESUME},
    )
    assert rec["fullName"] == "Kavya Iyer"


# --- recruiter / org views ------------------------------------------------------------------------------------------


def test_recruiter_applicant_row_shows_the_resume_name():
    from app.services.vendor.org_candidates import _record_from_application

    app = {
        "id": "a1",
        "candidateEmail": "k@example.com",
        "data": {"candidateName": "Signup Name", "resumeText": CAPS_RESUME},
    }
    assert _record_from_application(app)["candidateName"] == "Kavya Iyer"


def test_recruiter_row_follows_the_current_profile_resume_after_replacement():
    from app.services.vendor.org_candidates import _record_from_application

    db = {"profiles": {"b@example.com": {"resumeText": NEW_RESUME}}}
    app = {
        "id": "a1",
        "candidateEmail": "b@example.com",
        "data": {"candidateName": "Giribabu Kothapalli", "resumeText": OLD_RESUME},
    }
    assert _record_from_application(app, db)["candidateName"] == "Bharath Krishna Pachimatla"


def test_recruiter_profile_row_shows_the_resume_name():
    from app.services.vendor.org_candidates import _record_from_profile

    user = {"id": "u1", "email": "k@example.com", "name": "Signup Name"}
    profile = {"fullName": "Signup Name", "resumeText": CAPS_RESUME}
    db = {"profiles": {"k@example.com": profile}}
    assert _record_from_profile(db, user, profile, None)["candidateName"] == "Kavya Iyer"


def test_display_name_without_resume_uses_the_given_name_then_the_email():
    assert candidate_display_name({"profiles": {}}, "x@example.com", given="Given Name") == "Given Name"
    assert candidate_display_name({"profiles": {}}, "x@example.com") == "x@example.com"


# --- Two-column resumes and split surnames (a product name must never become the candidate's name) ---------------
from app.services.candidate_name import looks_like_person_name as _looks, name_from_resume_text as _from_text  # noqa: E402

_SPLIT = "RS\nRavi Shankar\nNallamothu\nAI Engineer · Generative AI\nCONTACT\nE-MAIL\nnallamothuravi9@gmail.com\nSKILLS\nGoogle Gemini API"
_JUMBLED = (
    "PROFILE RS AI Engineer who ships Generative AI in Python. Hands-on with the Google Gemini API, Amazon Bedrock and "
    "AWS. Ravi Shankar Looking to build reliable AI products. Nallamothu CORE STRENGTHS RAG Engineering CONTACT "
    "E-MAIL nallamothuravi9@gmail.com LOCATION Hyderabad, India"
)


def test_product_names_are_not_person_names():
    for value in ("Gemini API", "Google Gemini API", "Amazon Bedrock", "FastAPI", "Hyderabad"):
        assert not _looks(value), value


def test_surname_on_its_own_line_is_joined_using_the_email():
    assert _from_text(_SPLIT) == "Ravi Shankar Nallamothu"


def test_two_column_resume_read_out_of_order_still_finds_the_name():
    assert _from_text(_JUMBLED) == "Ravi Shankar Nallamothu"


def test_ai_returning_a_product_name_is_ignored():
    assert resume_name({"resumeText": _JUMBLED, "resumeFullName": "Gemini API"}) == "Ravi Shankar Nallamothu"


def test_city_in_email_is_not_added_to_the_name():
    assert _from_text("Rahul Verma\nrahul.hyderabad@gmail.com\nHyderabad, India") == "Rahul Verma"


def test_email_does_not_duplicate_part_of_an_apostrophe_name():
    assert _from_text("PRIYA D'SOUZA\nStaff Nurse\npriya.dsouza@gmail.com") == "Priya D'Souza"


# --- design tools are never a name (T4: two-column designer resume became "Adobe Xd") ----------------------------

DESIGNER_RESUME = (
    "TOOLS\nFigma\nAdobe XD\nSketch\nAdobe Illustrator\nAdobe Photoshop\nProtopie\nCONTACT\n"
    "ananya.kulkarni@t5.test\n+91 97300 12121\nPune, Maharashtra\nbehance.net/ananyak\nSKILLS\nUI Design\n"
    "UX Research\nWireframing\nPrototyping\nEDUCATION\nB.Des, Interaction Design\nMIT Institute of Design, Pune\n2019\n"
    "ANANYA\nKULKARNI\nSenior Product Designer\nPROFILE\nProduct designer with 5 years of experience."
)


def test_design_tool_lines_are_not_a_name():
    assert name_from_resume_text(DESIGNER_RESUME) == "Ananya Kulkarni"


def test_design_tools_never_look_like_a_person():
    from app.services.candidate_name import looks_like_person_name

    for tool in ("Adobe XD", "Adobe Xd", "Sketch", "Adobe Photoshop", "Adobe Illustrator", "InDesign", "Canva",
                 "Framer", "InVision", "Zeplin", "Blender", "AutoCAD", "Protopie"):
        assert not looks_like_person_name(tool), tool


def test_parsed_tool_name_is_replaced_by_the_resume_name():
    profile = {"resumeFullName": "Adobe Xd", "resumeText": DESIGNER_RESUME}
    assert resume_name(profile) == "Ananya Kulkarni"
