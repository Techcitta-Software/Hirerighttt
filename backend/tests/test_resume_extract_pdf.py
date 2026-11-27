"""pdf_layout_text: compressed streams, two-column order, pypdf fallback, scanned pages."""

import io

from app.services.resume_parse.extract_pdf import pdf_layout_text


def _pdf(lines=None, *, stream: bytes | None = None, compress: bool = False) -> bytes:
    if stream is None:
        ops = ["BT", "/F1 10 Tf", "13 TL", "50 790 Td"] + [f"({line}) Tj T*" for line in (lines or [])] + ["ET"]
        stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{off:010d} 00000 n \n".encode() for off in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    if not compress:
        return out
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(out)).pages:
        writer.add_page(page)
    for page in writer.pages:
        page.compress_content_streams()
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _two_column_pdf() -> bytes:
    """Sidebar on the left, the person's name (larger type) on the right, six shared baselines."""
    left = ["Figma", "Sketch", "Miro", "Canva", "Notion", "Slack"]
    right = [
        "Ananya Kulkarni",
        "Product Designer",
        "Portfolio systems",
        "Brand research",
        "Design ops",
        "Team leadership",
    ]
    ops = []
    for i, (left_word, right_word) in enumerate(zip(left, right)):
        y = 720 - i * 22
        right_size = 22 if i == 0 else 11
        ops.append(f"BT /F1 11 Tf 1 0 0 1 36 {y} Tm ({left_word}) Tj ET")
        ops.append(f"BT /F1 {right_size} Tf 1 0 0 1 330 {y} Tm ({right_word}) Tj ET")
    return _pdf(stream="\n".join(ops).encode("latin-1"))


def test_compressed_pdf_returns_real_words():
    word = "FastAPI"
    data = _pdf(
        ["Priya Raman", f"Senior engineer shipping {word} services on PostgreSQL."],
        compress=True,
    )
    assert word.encode("ascii") not in data
    out = pdf_layout_text(data)
    assert word in out.text
    assert "Priya Raman" in out.text
    assert "FlateDecode" not in out.text
    assert all(ch.isprintable() or ch in "\n\r\t" for ch in out.text)
    letters = sum(ch.isalpha() for ch in out.text)
    assert letters > len(out.text) // 2
    assert out.method == "pdfium"


def test_two_column_page_reads_left_then_right():
    out = pdf_layout_text(_two_column_pdf())
    text = out.text
    # The whole left column (sidebar) precedes the right column (name and role).
    assert text.index("Slack") < text.index("Ananya")
    left = ["Figma", "Sketch", "Miro", "Canva", "Notion", "Slack"]
    assert [text.index(token) for token in left] == sorted(text.index(token) for token in left)
    for line in out.lines:
        assert not ("Figma" in line and "Ananya" in line)
    assert any("Ananya" in name for name in out.name_candidates)


def test_pdfium_open_error_uses_pypdf(monkeypatch):
    import pypdfium2

    def boom(*_args, **_kwargs):
        raise RuntimeError("pdfium unavailable")

    monkeypatch.setattr(pypdfium2, "PdfDocument", boom)
    data = _pdf(["Priya Raman builds FastAPI services for PostgreSQL."], compress=True)
    out = pdf_layout_text(data)
    assert out.method == "pypdf"
    assert "FastAPI" in out.text


def test_image_only_pdf_is_scanned():
    out = pdf_layout_text(_pdf([], compress=True))
    assert out.pages > 0
    assert out.scanned is True
    assert out.text.strip() == ""


def test_broken_pdf_does_not_raise():
    out = pdf_layout_text(b"%PDF-1.4 broken")
    assert isinstance(out.text, str)
    assert out.method in ("pdfium", "pypdf")
