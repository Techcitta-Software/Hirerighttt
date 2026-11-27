"""TXT resumes are stored and downloaded as text/plain with the .txt name kept."""

from __future__ import annotations

import base64

import pytest

from app.services.storage.resume_storage import (
    infer_resume_content_type,
    parse_resume_upload_body,
    stored_resume_filename,
)


def test_txt_upload_is_accepted_and_download_keeps_txt():
    raw = base64.b64encode(b"Priya Raman\nEngineer\n").decode()
    parsed = parse_resume_upload_body({"filename": "Priya Raman.txt", "file_base64": raw})
    assert parsed["filename"].endswith(".txt")
    assert parsed["buffer"].startswith(b"Priya")
    name = stored_resume_filename("users/u1/resume/resume.txt", "Priya Raman.pdf")
    assert name == "Priya Raman.txt"
    assert infer_resume_content_type(name, "application/octet-stream") == "text/plain; charset=utf-8"
    assert infer_resume_content_type("notes.TXT", "text/plain") == "text/plain; charset=utf-8"


def test_pdf_is_not_served_as_text():
    assert infer_resume_content_type("resume.pdf", "text/plain") == "application/pdf"
    assert infer_resume_content_type("resume", "text/plain") == "application/octet-stream"


def test_docx_still_required_when_the_name_is_not_a_resume():
    with pytest.raises(ValueError):
        parse_resume_upload_body({"filename": "photo.png", "file_base64": base64.b64encode(b"x").decode()})
