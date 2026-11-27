"""One entry point for resume text on the server: PDF (pypdfium2 layout, pypdf fallback), DOCX (XML walker), TXT."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.resume_parse.extract_docx import docx_layout_text
from app.services.resume_parse.extract_pdf import pdf_layout_text

MAX_RESUME_BYTES = 2_000_000
SUPPORTED_KINDS = ("pdf", "docx", "txt")
IMAGE_EXT = re.compile(r"\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$", re.I)


class UnsupportedResumeFile(ValueError):
    def __init__(self, message: str, code: str, status: int = 415) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class ExtractedText:
    kind: str  # pdf | docx | txt | text (client-supplied text only)
    text: str
    method: str  # pdfium | pypdf | docx-xml | txt | client
    name_candidates: list[str] = field(default_factory=list)
    pages: int = 0
    chars_per_page: list[int] = field(default_factory=list)
    scanned: bool = False


def txt_text(buf: bytes) -> str:
    """UTF-8 (with or without a BOM), else Windows-1252; NULs removed, line endings normalised."""
    if buf[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = buf.decode("utf-16", errors="replace")
    else:
        try:
            text = buf.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = buf.decode("cp1252", errors="replace")
    text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(re.sub(r"[ \t\f\v ]+", " ", ln).strip() for ln in text.split("\n")).strip()


def detect_kind(buf: bytes, filename: str) -> str:
    name = (filename or "").strip().lower()
    if buf[:5] == b"%PDF-" or (name.endswith(".pdf") and b"%PDF-" in buf[:1024]):
        return "pdf"
    if buf[:4] == b"PK\x03\x04":
        return "docx" if not name.endswith((".xlsx", ".pptx", ".zip")) else "unsupported"
    if IMAGE_EXT.search(name) or buf[:3] == b"\xff\xd8\xff" or buf[:8] == b"\x89PNG\r\n\x1a\n":
        return "image"
    if name.endswith(".doc") or buf[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "doc"
    if name.endswith(".txt") or _looks_like_text(buf):
        return "txt"
    return "unsupported"


def _looks_like_text(buf: bytes) -> bool:
    sample = buf[:4096]
    if not sample or b"\x00" in sample.replace(b"\x00\n", b""):
        return False
    printable = sum(1 for b in sample if b >= 32 or b in (9, 10, 13))
    return printable / len(sample) > 0.97


def extract_resume_file(buf: bytes, filename: str) -> ExtractedText:
    """Text of an uploaded resume. Raises UnsupportedResumeFile for photos, .doc and other formats."""
    if not buf:
        raise UnsupportedResumeFile("The resume file is empty.", "empty_file", 400)
    if len(buf) > MAX_RESUME_BYTES:
        raise UnsupportedResumeFile("Resume files must be 2 MB or smaller.", "file_too_large", 413)
    kind = detect_kind(buf, filename)
    if kind == "image":
        raise UnsupportedResumeFile(
            "Photo resumes are not supported yet. Upload your resume as a PDF, Word (.docx) or text file.", "image_resume"
        )
    if kind == "doc":
        raise UnsupportedResumeFile(
            "Old Word (.doc) files cannot be read. Save it as .docx or PDF and upload again.", "doc_resume"
        )
    if kind == "unsupported":
        raise UnsupportedResumeFile("Upload your resume as a PDF, Word (.docx) or text file.", "unsupported_file")
    if kind == "pdf":
        pdf = pdf_layout_text(buf)
        return ExtractedText(
            kind="pdf",
            text=pdf.text,
            method=pdf.method,
            name_candidates=pdf.name_candidates,
            pages=pdf.pages,
            chars_per_page=pdf.chars_per_page,
            scanned=pdf.scanned,
        )
    if kind == "docx":
        return ExtractedText(kind="docx", text=docx_layout_text(buf), method="docx-xml", pages=1)
    return ExtractedText(kind="txt", text=txt_text(buf), method="txt", pages=1)
