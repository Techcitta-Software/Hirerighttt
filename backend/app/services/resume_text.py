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


# DOCX is a zip archive: a tiny upload can declare gigabytes of XML (zip bomb, V-07). Real resumes have a few dozen
# entries and a document.xml well under 5 MB.
DOCX_MAX_ENTRIES = 500
DOCX_MAX_DOCUMENT_XML_BYTES = 5_000_000
DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES = 50_000_000
DOCX_MAX_COMPRESSION_RATIO = 200


def _read_capped(zf: zipfile.ZipFile, info: zipfile.ZipInfo, cap: int) -> bytes | None:
    """Decompress at most `cap` bytes (the header's file_size can lie, so the stream itself is bounded too)."""
    out = bytearray()
    with zf.open(info) as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            out += chunk
            if len(out) > cap:
                return None
    return bytes(out)


def docx_text(buf: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(buf)) as zf:
            infos = zf.infolist()
            if len(infos) > DOCX_MAX_ENTRIES:
                logger.info("DOCX refused: %d entries", len(infos))
                return ""
            if sum(max(0, i.file_size) for i in infos) > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES:
                logger.info("DOCX refused: declared uncompressed size too large")
                return ""
            info = zf.getinfo("word/document.xml")
            if (
                info.file_size > DOCX_MAX_DOCUMENT_XML_BYTES
                or info.file_size > DOCX_MAX_COMPRESSION_RATIO * max(info.compress_size, 1)
            ):
                logger.info("DOCX refused: document.xml %d bytes (compressed %d)", info.file_size, info.compress_size)
                return ""
            raw = _read_capped(zf, info, DOCX_MAX_DOCUMENT_XML_BYTES)
            if raw is None:
                logger.info("DOCX refused: document.xml expands past the limit")
                return ""
            xml = raw.decode("utf-8", errors="ignore")
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
