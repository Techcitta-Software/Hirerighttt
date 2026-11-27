"""PDF text in reading order, with pypdfium2 (Apache-2.0 / BSD-3; PDFium is BSD-3).

Why not the PDF's own text order: two-column resumes (a sidebar with tools / contact / skills next to the main
column) come out interleaved from most readers ("Figma ANANYA / Adobe XD KULKARNI"), and the sidebar tool list then
looks like the candidate's name. Here characters are grouped into words by their boxes, words into rows by baseline,
and a column gutter (a wide gap that many rows share) splits each band into its left and right column. The left
column is emitted fully, then the right column — never interleaved, and not reordered to put the name first.
A line that crosses the gutter (a full-width heading) ends the band.

The largest text on page 1 is almost always the person's name; it is returned as a name candidate and does not
change column order.
Falls back to pypdf (`resume_text.pdf_text`) when pypdfium2 is missing or cannot open the file.
"""

from __future__ import annotations

import ctypes
import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger("hireright.resume")

MAX_PAGES = 12
COLUMN_GAP = 24.0  # points: a gap at least this wide between words on one row may be a column gutter
GUTTER_VOTES = 4  # rows that must share the gutter before the page is treated as two columns
ROW_TOLERANCE = 2.5  # points between baselines of words on the same row
SCANNED_CHARS_PER_PAGE = 100  # fewer readable characters than this per page: an image-only (scanned) PDF


@dataclass
class PdfText:
    text: str
    lines: list[str]
    name_candidates: list[str] = field(default_factory=list)
    pages: int = 0
    chars_per_page: list[int] = field(default_factory=list)
    method: str = "pdfium"

    @property
    def scanned(self) -> bool:
        if not self.pages:
            return False
        return sum(self.chars_per_page) / max(1, self.pages) < SCANNED_CHARS_PER_PAGE


@dataclass
class _Word:
    x0: float
    x1: float
    y: float  # top-down baseline (0 = top of the page)
    text: str
    size: float  # glyph height (loose box), a stand-in for the font size


def _page_words(tp, page_height: float, raw) -> list[_Word]:
    n = tp.count_chars()
    if n <= 0:
        return []
    text = tp.get_text_range(0, n)
    ox, oy = ctypes.c_double(), ctypes.c_double()
    words: list[_Word] = []
    cur: _Word | None = None
    for i in range(min(n, len(text))):
        ch = text[i]
        if not ch or ch.isspace() or ch in "￾￿":
            if cur:
                words.append(cur)
                cur = None
            continue
        left, bottom, right, top = tp.get_charbox(i, loose=True)
        if raw.FPDFText_GetCharOrigin(tp, i, ox, oy):
            y = page_height - oy.value
        else:
            y = page_height - bottom
        size = max(0.0, top - bottom)
        if cur is not None:
            gap = left - cur.x1
            same_row = abs(cur.y - y) <= max(ROW_TOLERANCE, 0.25 * max(size, cur.size))
            # Characters that touch (or overlap, from kerning) belong to one word; a real space is in the text.
            if same_row and gap <= max(0.6, 0.12 * max(size, cur.size)) and left >= cur.x0 - 1:
                cur.x1 = max(cur.x1, right)
                cur.text += ch
                cur.size = max(cur.size, size)
                continue
            words.append(cur)
        cur = _Word(left, right, y, ch, size)
    if cur:
        words.append(cur)
    return words


def _rows(words: list[_Word]) -> list[tuple[float, list[_Word]]]:
    rows: list[tuple[float, list[_Word]]] = []
    for w in sorted(words, key=lambda w: (w.y, w.x0)):
        if rows and abs(rows[-1][0] - w.y) <= ROW_TOLERANCE:
            rows[-1][1].append(w)
        else:
            rows.append((w.y, [w]))
    return rows


def _join(words: list[_Word]) -> str:
    parts = sorted(words, key=lambda w: w.x0)
    out = ""
    prev: _Word | None = None
    for w in parts:
        if prev is None:
            out = w.text
        else:
            # Punctuation the PDF placed as its own glyph run ("Pune" ","): glue it back on.
            glue = w.x0 - prev.x1 <= 0.6 * max(w.size, prev.size, 1.0) * 0.25 and re.fullmatch(r"[,.;:)\]%]+", w.text)
            out += ("" if glue else " ") + w.text
        prev = w
    return out


def _gutter(rows: list[tuple[float, list[_Word]]]) -> float | None:
    """x of the column gutter shared by at least GUTTER_VOTES rows, else None (single column)."""
    votes: dict[int, int] = {}
    for _, ws in rows:
        ws = sorted(ws, key=lambda w: w.x0)
        if len(ws) < 2:
            continue
        for x in {round(ws[i].x0 / 12) for i in range(1, len(ws)) if ws[i].x0 - ws[i - 1].x1 >= COLUMN_GAP}:
            votes[x] = votes.get(x, 0) + 1
    if not votes:
        return None
    best = max(votes, key=lambda k: (votes[k] + votes.get(k - 1, 0) + votes.get(k + 1, 0), -k))
    if votes[best] + votes.get(best - 1, 0) + votes.get(best + 1, 0) < GUTTER_VOTES:
        return None
    return (best - 1) * 12 - 2


def _page_lines(words: list[_Word]) -> list[str]:
    rows = _rows(words)
    bnd = _gutter(rows)
    if bnd is None:
        return [_join(ws) for _, ws in rows]
    out: list[str] = []
    left: list[str] = []
    right: list[str] = []

    def flush() -> None:
        # Whole left column, then the whole right column. The name stays in name_candidates; it does not pick a side.
        out.extend(left)
        out.extend(right)
        left.clear()
        right.clear()

    for _, ws in rows:
        if any(w.x0 < bnd - 4 and w.x1 > bnd + 8 for w in ws):
            flush()
            out.append(_join(ws))
            continue
        lt = _join([w for w in ws if w.x0 < bnd])
        rt = _join([w for w in ws if w.x0 >= bnd])
        if lt:
            left.append(lt)
        if rt:
            right.append(rt)
    flush()
    return out


def _largest_text(words: list[_Word]) -> str:
    """The run of the largest glyphs near the top of page 1 (the name on most resumes), or ""."""
    letters = [w for w in words if re.search(r"[A-Za-z]", w.text)]
    if len(letters) < 6:
        return ""
    sizes = sorted({round(w.size, 1) for w in letters}, reverse=True)
    top = sizes[0]
    big = [w for w in letters if round(w.size, 1) >= top - 0.2]
    # Only a real outlier: if a third of the page is this size, it is body text, not a heading.
    if len(sizes) < 2 or len(big) > max(6, len(letters) // 3):
        return ""
    big.sort(key=lambda w: (w.y, w.x0))
    first_y = big[0].y
    run = [w for w in big if w.y - first_y <= top * 2.6]  # the name can wrap onto a second line
    return " ".join(_join(ws) for _, ws in _rows(run)).strip()


def pdf_layout_text(buf: bytes, max_pages: int = MAX_PAGES) -> PdfText:
    """Reading-order text of a PDF. Never raises: pypdf is used when pypdfium2 cannot read the file."""
    try:
        return _layout_with_pdfium(buf, max_pages)
    except Exception:
        logger.info("PDF layout extract failed", exc_info=True)
        try:
            return _pypdf_fallback(buf)
        except Exception:
            logger.info("pypdf fallback failed", exc_info=True)
            return PdfText(text="", lines=[], pages=0, method="pypdf")


def _layout_with_pdfium(buf: bytes, max_pages: int) -> PdfText:
    try:
        import pypdfium2 as pdfium
        import pypdfium2.raw as raw
    except ImportError:  # pragma: no cover - pypdfium2 is in requirements.txt
        logger.warning("pypdfium2 is not installed; falling back to pypdf for PDF resumes")
        return _pypdf_fallback(buf)
    try:
        pdf = pdfium.PdfDocument(buf)
    except Exception as err:
        logger.info("pypdfium2 could not open the PDF (%s); trying pypdf", type(err).__name__)
        return _pypdf_fallback(buf)
    page_lines: list[list[str]] = []
    names: list[str] = []
    counts: list[int] = []
    try:
        total = len(pdf)
        for i in range(min(total, max_pages)):
            page = pdf[i]
            tp = None
            try:
                tp = page.get_textpage()
                words = _page_words(tp, page.get_height(), raw)
                hint = ""
                if i == 0:
                    hint = _largest_text(words)
                    if hint:
                        names.append(hint)
                counts.append(sum(len(w.text) for w in words))
                page_lines.append([ln for ln in _page_lines(words) if ln.strip()])
            except Exception:  # one broken page must not lose the rest
                logger.info("pypdfium2 failed on page %d", i + 1, exc_info=True)
                counts.append(0)
                page_lines.append([])
            finally:
                if tp is not None:
                    try:
                        tp.close()
                    except Exception:
                        pass
                try:
                    page.close()
                except Exception:
                    pass
        pages = min(total, max_pages)
    finally:
        try:
            pdf.close()
        except Exception:
            pass
    lines = _strip_page_noise(page_lines)
    text = "\n".join(lines).strip()
    if not text:
        fb = _pypdf_fallback(buf)
        if fb.text:
            return fb
    return PdfText(
        text=text, lines=lines, name_candidates=names, pages=pages, chars_per_page=counts, method="pdfium"
    )


_PAGE_NO = re.compile(r"^(?:page\s*)?\d{1,2}\s*(?:/|of)\s*\d{1,2}$|^page\s+\d{1,2}$|^-\s*\d{1,2}\s*-$", re.I)


def _strip_page_noise(pages: list[list[str]]) -> list[str]:
    """Drop "Page 2 of 3" lines, and a running header/footer (the same line at the top or bottom of several pages)
    after its first occurrence."""
    edge_counts: dict[str, int] = {}
    if len(pages) >= 2:
        for lines in pages:
            for ln in set(lines[:2] + lines[-2:]):
                edge_counts[ln.strip()] = edge_counts.get(ln.strip(), 0) + 1
    running = {ln for ln, c in edge_counts.items() if c >= 2 and len(ln) <= 80}
    out: list[str] = []
    seen: set[str] = set()
    for lines in pages:
        for idx, ln in enumerate(lines):
            key = ln.strip()
            if _PAGE_NO.match(key):
                continue
            at_edge = idx < 2 or idx >= len(lines) - 2
            if key in running and at_edge:
                if key in seen:
                    continue
                seen.add(key)
            out.append(ln)
    return out


def _pypdf_fallback(buf: bytes) -> PdfText:
    from app.services.resume_text import pdf_text

    text = pdf_text(buf)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    pages = 0
    try:
        from io import BytesIO

        from pypdf import PdfReader

        pages = min(len(PdfReader(BytesIO(buf)).pages), MAX_PAGES)
    except Exception:
        pages = 1 if text else 0
    per = len(text.replace("\n", "")) // max(1, pages) if pages else 0
    return PdfText(text=text, lines=lines, pages=pages, chars_per_page=[per] * pages, method="pypdf")
