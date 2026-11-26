"""Server-side resume text (compressed PDFs, DOCX) and the assessment AI payload (UUIDs from Postgres)."""

import asyncio
import base64
import io
import uuid
import zipfile
from datetime import datetime, timezone

import pytest

from app.assessment.contracts import AssessmentError
from app.services.resume_text import docx_text, pdf_text, resume_file_text

RESUME_LINES = [
    "Priya Raman",
    "Senior Backend Engineer, ShopNova Pvt Ltd (Jan 2022 - Present)",
    "Built the order service in Python FastAPI and PostgreSQL handling 3k req/s.",
    "Skills: Python, FastAPI, PostgreSQL, Redis, Kafka",
]


def _pdf(lines, compress=False) -> bytes:
    ops = ["BT", "/F1 10 Tf", "13 TL", "50 790 Td"] + [f"({l}) Tj T*" for l in lines] + ["ET"]
    stream = "\n".join(ops).encode("latin-1")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    if not compress:
        return out
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(out)).pages:
        writer.add_page(page)
    for page in writer.pages:
        page.compress_content_streams()  # FlateDecode, like PDFs exported from Word / Google Docs
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _docx(lines) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{l}</w:t></w:r></w:p>" for l in lines)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", f'<w:document xmlns:w="x"><w:body>{body}</w:body></w:document>')
    return buf.getvalue()


def test_compressed_pdf_text_is_read():
    data = _pdf(RESUME_LINES, compress=True)
    assert b"FastAPI" not in data  # the text really is compressed
    text = pdf_text(data)
    assert "Priya Raman" in text and "FastAPI" in text and "ShopNova" in text


def test_docx_keeps_paragraphs():
    text = docx_text(_docx(RESUME_LINES))
    assert text.splitlines()[0] == "Priya Raman"
    assert "Kafka" in text


def test_unreadable_files_return_empty():
    assert pdf_text(b"%PDF-1.4 broken") == ""
    assert resume_file_text(b"hello", "notes.txt") == ""


def test_assessment_resume_upload_reads_compressed_pdf():
    from app.assessment.service import extract_resume_text

    text = extract_resume_text({"filename": "priya.pdf", "file_base64": base64.b64encode(_pdf(RESUME_LINES, compress=True)).decode()})
    assert "Senior Backend Engineer" in text and "PostgreSQL" in text


def test_assessment_scanned_pdf_gets_a_clear_error():
    from app.assessment.service import extract_resume_text

    with pytest.raises(Exception) as err:
        extract_resume_text({"filename": "scan.pdf", "file_base64": base64.b64encode(_pdf([], compress=True)).decode()})
    assert "scanned" in str(err.value)


def test_assessment_payload_with_uuid_and_datetime_is_sent(monkeypatch):
    """Rows from Postgres carry UUIDs: building the AI request used to crash with a 500."""
    from app.assessment import provider

    sent = {}

    class Result:
        text = '{"ok": true}'
        model = "test-model"

    async def fake_generate(**kw):
        sent["user"] = kw["user"]
        return Result()

    monkeypatch.setattr(provider, "gemini_configured", lambda: True)
    monkeypatch.setattr(provider, "generate_content", fake_generate)
    job_id = uuid.uuid4()
    out = asyncio.run(provider.structured_call(
        system="s", payload={"job": {"id": job_id, "created_at": datetime(2026, 11, 18, tzinfo=timezone.utc)}},
        validate=lambda d: d, purpose="plan"))
    assert out["data"] == {"ok": True}
    assert str(job_id) in sent["user"]


def test_assessment_provider_not_configured(monkeypatch):
    from app.assessment import provider

    monkeypatch.setattr(provider, "gemini_configured", lambda: False)
    with pytest.raises(AssessmentError):
        asyncio.run(provider.structured_call(system="s", payload={}, validate=lambda d: d, purpose="plan"))


def test_assessment_quotes_ignore_pdf_line_breaks_and_curly_quotes():
    from app.assessment.contracts import quoted_in

    resume = "- Built the order\nservice in Python FastAPI and PostgreSQL handling 3k req/s."
    assert quoted_in("Built the order service in Python FastAPI", [resume])
    assert quoted_in("“Built the order service”", [resume])
    assert not quoted_in("Built the payments service in Rust", [resume])
    assert not quoted_in("", [resume])


def test_assessment_competency_matches_id_name_or_order():
    from app.assessment.contracts import match_competency

    comps = [{"id": "ownership", "name": "Project ownership"}, {"id": "core_knowledge", "name": "Core technical knowledge"}]
    assert match_competency("ownership", comps, 0)["id"] == "ownership"
    assert match_competency("Core Technical Knowledge", comps, 0)["id"] == "core_knowledge"
    assert match_competency("", comps, 1)["id"] == "core_knowledge"
    assert match_competency("made-up competency", comps, 0) is None


def test_stored_resume_keeps_its_real_extension():
    """A Word resume was served as "resume.pdf" (application/pdf), so vendors could not view it."""
    from app.services.storage.resume_storage import infer_resume_content_type, stored_resume_filename

    assert stored_resume_filename("users/u1/resume/resume.docx", None) == "resume.docx"
    assert stored_resume_filename("users/u1/resume/resume.docx", "Arjun_Mehta_Resume.pdf") == "Arjun_Mehta_Resume.docx"
    assert stored_resume_filename("users/u1/resume/resume.pdf", "CV Final.pdf") == "CV Final.pdf"
    assert stored_resume_filename("users/u1/resume/resume.pdf", "") == "resume.pdf"
    assert stored_resume_filename("users/u1/resume/resume.pdf", 'evil"name\r\n.pdf') == "evil name .pdf"
    assert infer_resume_content_type(stored_resume_filename("k/resume.docx", None)).endswith("wordprocessingml.document")


def test_infer_resume_content_type_prefers_extension_over_stored_text():
    """A PDF stored as text/plain or octet-stream must still be served as application/pdf."""
    from app.services.storage.resume_storage import infer_resume_content_type

    pdf = "application/pdf"
    docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    doc = "application/msword"
    assert infer_resume_content_type("resume.pdf") == pdf
    assert infer_resume_content_type("resume.pdf", "text/plain") == pdf
    assert infer_resume_content_type("resume.pdf", "text/plain; charset=utf-8") == pdf
    assert infer_resume_content_type("resume.pdf", "application/octet-stream") == pdf
    assert infer_resume_content_type("resume.pdf", pdf) == pdf
    assert infer_resume_content_type("resume.docx", "text/plain") == docx
    assert infer_resume_content_type("resume.docx", pdf) == docx
    assert infer_resume_content_type("resume.doc", "text/plain") == doc
    assert infer_resume_content_type("resume.doc", doc) == doc
    assert infer_resume_content_type("resume", "text/plain") == "application/octet-stream"
    assert infer_resume_content_type("resume", pdf) == pdf
