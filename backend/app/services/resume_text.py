"""Plain text from an uploaded resume file (PDF or DOCX), on the server.

Real PDFs keep their text in compressed (FlateDecode) streams, so scanning the raw bytes returns noise; pypdf
decodes them. Scanned (image-only) PDFs have no text layer and return "".
"""

from __future__ import annotations

import logging
import re
import zipfile
from io import BytesIO

logger = logging.getLogger("hireright.resume")


def _tidy(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def pdf_text(buf: bytes, max_pages: int = 12) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover - pypdf is in requirements.txt
        logger.warning("pypdf is not installed; PDF resumes cannot be read on the server")
        return ""
    try:
        reader = PdfReader(BytesIO(buf))
        pages = []
        for page in reader.pages[:max_pages]:
            try:
                pages.append(page.extract_text() or "")
            except Exception:  # one broken page must not lose the rest
                continue
        return _tidy("\n".join(pages))
    except Exception as err:
        logger.info("Could not read PDF text: %s", err)
        return ""


def docx_text(buf: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(buf)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
    except Exception:
        return ""
    xml = re.sub(r"</w:p>|<w:br[^>]*/>|<w:tab[^>]*/>", "\n", xml)
    return _tidy(re.sub(r"<[^>]+>", " ", xml))


def resume_file_text(buf: bytes, filename: str) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf") or buf[:5] == b"%PDF-":
        return pdf_text(buf)
    if name.endswith(".docx") or buf[:4] == b"PK\x03\x04":
        return docx_text(buf)
    return ""
