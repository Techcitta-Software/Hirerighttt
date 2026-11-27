"""DOCX text: headers first, then the body, then footers; tables as "cell | cell" rows; text boxes once.

Contact details often live in the Word header, which the old regex stripper (and mammoth in the browser) never read.
Text boxes are stored twice inside `mc:AlternateContent` (a modern `wps` copy in mc:Choice and a VML copy in
mc:Fallback); only the mc:Choice copy is read, so nothing is duplicated. XML is parsed with defusedxml (no entity
expansion), and the zip-bomb limits of `resume_text` apply to every part that is read.
"""

from __future__ import annotations

import logging
import re
import zipfile
from io import BytesIO

from app.services.resume_text import (
    DOCX_MAX_COMPRESSION_RATIO,
    DOCX_MAX_DOCUMENT_XML_BYTES,
    DOCX_MAX_ENTRIES,
    DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES,
    _read_capped,
)

logger = logging.getLogger("hireright.resume")

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
_PART_RE = re.compile(r"^word/(header\d*|document|footer\d*)\.xml$")


def _part_order(name: str) -> tuple[int, int]:
    m = _PART_RE.match(name)
    kind = m.group(1) if m else ""
    num = int(re.sub(r"\D", "", kind) or 0)
    return (0 if kind.startswith("header") else 1 if kind == "document" else 2, num)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


class _Walker:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def paragraph_text(self, p) -> str:
        """Text of one w:p: runs, tabs as spaces, breaks as newlines. Nested text boxes are emitted as their own lines."""
        out: list[str] = []
        boxes: list = []

        def walk(el) -> None:
            for child in el:
                tag = child.tag
                if tag == f"{MC}Fallback":
                    continue  # the VML duplicate of a text box
                if tag == f"{W}txbxContent":
                    boxes.append(child)
                    continue
                if tag == f"{W}t":
                    out.append(child.text or "")
                elif tag in (f"{W}tab", f"{W}ptab"):
                    out.append(" ")
                elif tag in (f"{W}br", f"{W}cr"):
                    out.append("\n")
                elif tag == f"{W}noBreakHyphen":
                    out.append("-")
                elif tag in (f"{W}delText", f"{W}instrText"):
                    continue  # deleted (tracked) text / field codes
                else:
                    walk(child)

        walk(p)
        for box in boxes:
            self.block(box)
        return "".join(out)

    def emit(self, text: str) -> None:
        for part in text.split("\n"):
            part = re.sub(r"[ \t ]+", " ", part).strip()
            if part:
                self.lines.append(part)

    def table(self, tbl) -> None:
        for tr in tbl:
            if tr.tag != f"{W}tr":
                continue  # (rows of a nested table are walked by that table, inside its cell)
            cells: list[str] = []
            for tc in tr:
                if tc.tag != f"{W}tc":
                    continue
                sub = _Walker()
                sub.block(tc)
                if sub.lines:
                    cells.append(" ".join(sub.lines) if len(sub.lines) <= 2 else "\n".join(sub.lines))
            multi = [c for c in cells if "\n" in c]
            if multi:
                # Layout tables (a whole column per cell): each cell is its own block, top to bottom.
                for c in cells:
                    self.emit(c)
            elif cells:
                self.emit(" | ".join(cells))

    def block(self, el) -> None:
        for child in el:
            tag = child.tag
            if tag == f"{W}p":
                self.emit(self.paragraph_text(child))
            elif tag == f"{W}tbl":
                self.table(child)
            elif tag == f"{MC}Fallback":
                continue
            elif _local(tag) in ("sdt", "sdtContent", "customXml", "smartTag", "hyperlink", "body", "AlternateContent",
                                 "Choice", "txbxContent", "ins", "moveTo", "hdr", "ftr"):
                self.block(child)


def docx_layout_text(buf: bytes) -> str:
    """Never raises; returns "" for anything that is not a readable DOCX (or breaks the size limits)."""
    try:
        from defusedxml import ElementTree as SafeET
    except ImportError:  # pragma: no cover - defusedxml is in requirements.txt
        from app.services.resume_text import docx_text

        return docx_text(buf)
    try:
        with zipfile.ZipFile(BytesIO(buf)) as zf:
            infos = zf.infolist()
            if len(infos) > DOCX_MAX_ENTRIES:
                logger.info("DOCX refused: %d entries", len(infos))
                return ""
            if sum(max(0, i.file_size) for i in infos) > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES:
                logger.info("DOCX refused: declared uncompressed size too large")
                return ""
            parts = sorted((i for i in infos if _PART_RE.match(i.filename)), key=lambda i: _part_order(i.filename))
            if not any(i.filename == "word/document.xml" for i in parts):
                return ""
            walker = _Walker()
            seen_hf: set[str] = set()
            for info in parts:
                if info.file_size > DOCX_MAX_DOCUMENT_XML_BYTES or info.file_size > DOCX_MAX_COMPRESSION_RATIO * max(
                    info.compress_size, 1
                ):
                    logger.info("DOCX part %s refused: %d bytes", info.filename, info.file_size)
                    if info.filename == "word/document.xml":
                        return ""
                    continue
                raw = _read_capped(zf, info, DOCX_MAX_DOCUMENT_XML_BYTES)
                if raw is None:
                    if info.filename == "word/document.xml":
                        return ""
                    continue
                try:
                    root = SafeET.fromstring(raw)
                except Exception:
                    logger.info("DOCX part %s is not valid XML", info.filename)
                    if info.filename == "word/document.xml":
                        return ""
                    continue
                part = _Walker()
                part.block(root)
                if info.filename != "word/document.xml":
                    # header1/header2/... often repeat the same text (first page / default / even): keep it once.
                    key = "\n".join(part.lines)
                    if not key or key in seen_hf:
                        continue
                    seen_hf.add(key)
                walker.lines.extend(part.lines)
    except Exception:
        logger.info("DOCX could not be read", exc_info=True)
        return ""
    return "\n".join(walker.lines).strip()
