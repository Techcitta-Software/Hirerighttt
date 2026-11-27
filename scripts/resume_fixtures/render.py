"""Render a fixture spec (specs.py) to HTML (for PDF), plain text, or DOCX (raw WordprocessingML templates).

Pure standard library. Deterministic: the same spec always gives the same HTML / TXT / DOCX bytes
(DOCX zip entries carry a fixed timestamp).
"""

from __future__ import annotations

import html
import io
import zipfile
from typing import Any
from xml.sax.saxutils import escape as xesc

PRESENT_WORDS = {"present", "current", "till date", "now", "ongoing", "today"}


# ── text building blocks ──────────────────────────────────────────────────────────────────────────────────────


def display_name(spec: dict[str, Any]) -> str:
    return spec.get("name_display") or spec["name"]


def date_range(job: dict[str, Any], sep: str = " – ") -> str:
    if not job["end"]:
        return f"{job['start']}–"
    return f"{job['start']}{sep}{job['end']}"


def job_heading(job: dict[str, Any], style: str) -> list[tuple[str, str]]:
    """The printed heading of a job as (style, text) lines. 'jobrow' carries "left\tright"."""
    t, c, city = job["title"], job["company"], job["city"]
    if style == "pipe":
        return [("jobhead", f"{t} | {c} | {city}"), ("dates", date_range(job, " - "))]
    if style == "pipe_dates":
        return [("jobhead", f"{t} | {c} | {city} | {date_range(job)}")]
    if style == "emdash":
        return [("jobhead", f"{t} — {c}, {city}"), ("dates", date_range(job))]
    if style == "dept":
        return [("jobhead", f"{t}, {c}, {city}"), ("dates", date_range(job))]
    if style == "comma":
        return [("jobhead", f"{t}, {c}, {city}"), ("dates", date_range(job))]
    if style == "comma_dash":
        return [("jobhead", f"{t}, {c} — {city}"), ("dates", date_range(job))]
    if style == "dash_paren":
        return [("jobhead", f"{t} – {c}, {city} ({date_range(job)})")]
    if style == "two_line":
        return [("jobhead", t), ("dates", f"{c} | {city} | {date_range(job)}")]
    if style == "at":
        return [("jobhead", f"{t} at {c}, {city}"), ("dates", date_range(job))]
    if style == "us":
        return [("jobrow", f"{t}, {c} — {city}\t{date_range(job)}")]
    if style == "comma_pipe_dates":
        return [("jobhead", f"{t}, {c}, {city} | {date_range(job)}")]
    raise ValueError(f"unknown job_style {style}")


def education_line(e: dict[str, Any], sep: str = " — ") -> str:
    parts = [e["institution"]]
    if e.get("place") and e["place"] not in e["institution"]:
        parts.append(e["place"])
    years = f"{e['startYear']} - {e['endYear']}" if e.get("startYear") else e["endYear"]
    if years:
        parts.append(years)
    line = f"{e['degree']}{sep}{', '.join(parts)}"
    if e.get("note"):
        line += f" ({e['note']})"
    return line


def contact_items(spec: dict[str, Any]) -> list[str]:
    items = [spec["email"], spec["phone"], spec["location"], *spec.get("links", [])]
    return [i for i in items if i]


def section_blocks(spec: dict[str, Any], skip: tuple[str, ...] = ()) -> list[tuple[str, list[tuple[str, str]]]]:
    """(key, lines) per section in printed order. Lines are (style, text)."""
    out: list[tuple[str, list[tuple[str, str]]]] = []
    glyph = spec.get("bullet_glyph", "• ")
    plain = spec["fmt"] == "txt"
    if plain:
        glyph = spec.get("bullet_glyph", "- ")
    edu_sep = " - " if plain else " — "

    def add(key: str, heading: str, lines: list[tuple[str, str]]):
        if key in skip or not lines:
            return
        out.append((key, [("heading", heading), *lines]))

    if spec.get("summary"):
        add("summary", spec.get("summary_heading", "SUMMARY"), [("para", p) for p in spec["summary"]])
    jl: list[tuple[str, str]] = []
    for job in spec.get("jobs", []):
        jl += job_heading(job, spec["job_style"])
        jl += [("bullet", f"{glyph}{b}") for b in job["bullets"]]
    add("experience", spec.get("job_heading", "EXPERIENCE"), jl)
    add("projects", "PROJECTS", [("para", f"{t} - {d}") for t, d in spec.get("projects", [])])
    if spec.get("tools"):
        add("tools", "TOOLS", [("item", t) for t in spec["tools"]])
    if spec.get("skills"):
        if "skills" in spec.get("sidebar", []):
            add("skills", "SKILLS", [("item", s) for s in spec["skills"]])
        else:
            add("skills", "SKILLS", [("para", ", ".join(spec["skills"]))])
    edu = spec.get("education", [])
    if "education" in spec.get("sidebar", []):
        el: list[tuple[str, str]] = []
        for e in edu:
            el += [("item", e["degree"]), ("item", e["institution"] + (f", {e['place']}" if e.get("place") else "")), ("item", e["endYear"])]
        add("education", "EDUCATION", el)
    else:
        add("education", "EDUCATION", [("para", education_line(e, edu_sep)) for e in edu])
    certs = spec.get("certs", [])
    if certs:
        if spec.get("certs_one_line"):
            add("certs", "CERTIFICATIONS", [("para", ", ".join(f"{n} ({o})" for n, o in certs))])
        else:
            add("certs", "CERTIFICATIONS", [("para", f"{n}{edu_sep}{o}") for n, o in certs])
    for heading, lines in spec.get("extra", []):
        add(heading.lower(), heading, [("para", line) for line in lines])
    if spec.get("languages"):
        add("languages", "LANGUAGES", [("item", x) for x in spec["languages"]])
    if "contact" in spec.get("sidebar", []):
        add("contact", "CONTACT", [("item", x) for x in contact_items(spec)])
    return out


def header_lines(spec: dict[str, Any], with_contact: bool = True) -> list[tuple[str, str]]:
    lines: list[tuple[str, str]] = []
    if spec.get("toolbar"):
        lines.append(("toolbar", spec["toolbar"]))
    for part in display_name(spec).split("\n"):
        lines.append(("name", part))
    if spec.get("headline"):
        lines.append(("headline", spec["headline"]))
    if with_contact:
        lines.append(("contact", " | ".join(contact_items(spec))))
    return lines


# ── TXT ───────────────────────────────────────────────────────────────────────────────────────────────────────


def render_txt(spec: dict[str, Any]) -> str:
    out = [t for _, t in header_lines(spec)]
    for _, lines in section_blocks(spec):
        out.append("")
        out += [t.replace("\t", "    ") for _, t in lines]
    return "\n".join(out) + "\n"


# ── HTML (rendered to PDF by headless Chromium) ───────────────────────────────────────────────────────────────

CSS = """
@page { size: A4; margin: 14mm 14mm 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.45; color: #111; margin: 0; }
.name { font-size: 26px; font-weight: 700; line-height: 1.15; margin: 0; }
.toolbar { font-size: 10px; color: #444; margin-bottom: 6px; }
.headline { font-size: 14px; color: #333; margin: 2px 0 4px; }
.contact { font-size: 10.5px; color: #333; margin-bottom: 8px; }
.heading { font-size: 12.5px; font-weight: 700; letter-spacing: .5px; margin: 12px 0 4px; border-bottom: 1px solid #999; }
.jobhead { font-weight: 700; margin-top: 6px; }
.jobrow { display: flex; justify-content: space-between; font-weight: 700; margin-top: 6px; }
.jobrow span:last-child { font-weight: 400; }
.dates { color: #444; }
.bullet { margin-left: 10px; }
.item { }
.para { margin: 2px 0; }
.grid { display: grid; gap: 28px; }
.left-side { grid-template-columns: 34% 1fr; }
.right-side { grid-template-columns: 1fr 32%; }
.sidebar { background: #f2f2f2; padding: 10px; }
.cells { display: flex; justify-content: space-between; font-size: 10.5px; margin: 6px 0 10px; }
.uniform * { font-size: 11px !important; font-weight: 400 !important; }
.multi .bullet { font-size: 13px; line-height: 1.9; }
"""


def _div(style: str, text: str) -> str:
    if style == "jobrow":
        left, right = text.split("\t")
        return f'<div class="jobrow"><span>{html.escape(left)}</span><span>{html.escape(right)}</span></div>'
    return f'<div class="{style}">{html.escape(text)}</div>'


def _lines_html(lines: list[tuple[str, str]]) -> str:
    return "\n".join(_div(s, t) for s, t in lines)


def render_html(spec: dict[str, Any]) -> str:
    layout = spec["layout"]
    body_class = {"uniform": "uniform", "multi_page": "multi"}.get(layout, "")
    if layout in ("two_col_left", "two_col_right"):
        side_keys = tuple(spec["sidebar"])
        blocks = section_blocks(spec)
        side = [b for b in blocks if b[0] in side_keys]
        side.sort(key=lambda b: side_keys.index(b[0]))
        main = [b for b in blocks if b[0] not in side_keys]
        head = header_lines(spec, with_contact="contact" not in side_keys)
        side_html = "\n".join(_lines_html(lines) for _, lines in side)
        main_html = _lines_html(head) + "\n" + "\n".join(_lines_html(lines) for _, lines in main)
        if layout == "two_col_left":
            body = f'<div class="grid left-side"><div class="sidebar">{side_html}</div><div>{main_html}</div></div>'
        else:
            body = f'<div class="grid right-side"><div>{main_html}</div><div class="sidebar">{side_html}</div></div>'
    elif layout == "three_col_header":
        head = _lines_html(header_lines(spec, with_contact=False))
        cells = "".join(f"<span>{html.escape(x)}</span>" for x in (spec["email"], spec["phone"], spec["location"]))
        body = head + f'<div class="cells">{cells}</div>' + "\n".join(_lines_html(lines) for _, lines in section_blocks(spec))
    else:
        body = _lines_html(header_lines(spec)) + "\n" + "\n".join(_lines_html(lines) for _, lines in section_blocks(spec))
    title = html.escape(spec["name"]) + " - Resume (fixture)"
    return (
        f'<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><style>{CSS}</style></head>'
        f'<body class="{body_class}">\n{body}\n</body></html>\n'
    )


# ── DOCX (raw XML) ────────────────────────────────────────────────────────────────────────────────────────────

NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'xmlns:o="urn:schemas-microsoft-com:office:office" '
    'mc:Ignorable="wps"'
)

SIZES = {"name": 44, "headline": 26, "heading": 24, "toolbar": 18}


def w_para(text: str, style: str = "para") -> str:
    bold = style in ("name", "heading", "jobhead", "jobrow")
    size = SIZES.get(style, 21)
    rpr = f"<w:rPr>{'<w:b/>' if bold else ''}<w:sz w:val=\"{size}\"/></w:rPr>"
    if style == "jobrow":
        left, right = text.split("\t")
        runs = (
            f'<w:r>{rpr}<w:t xml:space="preserve">{xesc(left)}</w:t></w:r>'
            f'<w:r><w:tab/><w:t xml:space="preserve">{xesc(right)}</w:t></w:r>'
        )
    else:
        runs = f'<w:r>{rpr}<w:t xml:space="preserve">{xesc(text)}</w:t></w:r>'
    return f"<w:p>{runs}</w:p>"


def w_paras(lines: list[tuple[str, str]]) -> str:
    return "".join(w_para(t, s) for s, t in lines)


def w_table(rows: list[list[str]], widths: list[int]) -> str:
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    trs = []
    for row in rows:
        tcs = "".join(
            f'<w:tc><w:tcPr><w:tcW w:w="{widths[i]}" w:type="dxa"/></w:tcPr>{cell or "<w:p/>"}</w:tc>' for i, cell in enumerate(row)
        )
        trs.append(f"<w:tr>{tcs}</w:tr>")
    return (
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>'
        f"<w:tblGrid>{grid}</w:tblGrid>{''.join(trs)}</w:tbl>"
    )


def w_textbox(inner: str, shape_id: int) -> str:
    """A text box as Word writes it: a DrawingML shape (mc:Choice) plus a VML copy (mc:Fallback) of the same text."""
    return (
        "<w:p><w:r><mc:AlternateContent>"
        '<mc:Choice Requires="wps"><w:drawing>'
        '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="5400000" cy="1100000"/>'
        f'<wp:docPr id="{shape_id}" name="Text Box {shape_id}"/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5400000" cy="1100000"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>'
        f"<wps:txbx><w:txbxContent>{inner}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>"
        "</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>"
        '<mc:Fallback><w:pict><v:shape id="tb' + str(shape_id) + '" style="width:425pt;height:87pt" type="#_x0000_t202">'
        f"<v:textbox><w:txbxContent>{inner}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>"
        "</mc:AlternateContent></w:r></w:p>"
    )


def _docx_zip(document_body: str, header: str | None = None, footer: str | None = None) -> bytes:
    sect = ""
    rels = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>']
    overrides = [
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    ]
    refs = ""
    if header is not None:
        rels.append('<Relationship Id="rIdHdr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>')
        overrides.append('<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>')
        refs += '<w:headerReference w:type="default" r:id="rIdHdr1"/>'
    if footer is not None:
        rels.append('<Relationship Id="rIdFtr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>')
        overrides.append('<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>')
        refs += '<w:footerReference w:type="default" r:id="rIdFtr1"/>'
    sect = (
        f'<w:sectPr>{refs}<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'
    )
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{document_body}{sect}</w:body></w:document>'
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'
    )
    ct = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>' + "".join(overrides) + "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(rels) + "</Relationships>"
    )
    parts = [
        ("[Content_Types].xml", ct),
        ("_rels/.rels", root_rels),
        ("word/document.xml", doc),
        ("word/styles.xml", styles),
        ("word/_rels/document.xml.rels", doc_rels),
    ]
    if header is not None:
        parts.append(("word/header1.xml", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {NS}>{header}</w:hdr>'))
    if footer is not None:
        parts.append(("word/footer1.xml", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr {NS}>{footer}</w:ftr>'))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode("utf-8"))
    return buf.getvalue()


def render_docx(spec: dict[str, Any]) -> bytes:
    layout = spec["layout"]
    blocks = section_blocks(spec)
    rest = "".join(w_paras(lines) for _, lines in blocks)
    if layout == "single":
        return _docx_zip(w_paras(header_lines(spec)) + rest)
    if layout == "textbox":
        name_box = w_textbox(w_paras(header_lines(spec, with_contact=False)), 1)
        contact_box = w_textbox(w_paras([("contact", x) for x in contact_items(spec)]), 2)
        return _docx_zip(name_box + contact_box + rest)
    if layout == "header_footer":
        header = w_paras([("contact", f"{spec['email']} | {spec['phone']}")])
        footer = w_paras([("contact", " | ".join([spec["location"], *spec.get("links", [])]))])
        return _docx_zip(w_paras(header_lines(spec, with_contact=False)) + rest, header=header, footer=footer)
    if layout == "table":
        rows = [[w_paras(header_lines(spec, with_contact=False)), w_paras([("contact", x) for x in contact_items(spec)])]]
        for _, lines in blocks:
            heading, body = lines[0], lines[1:]
            rows.append([w_para(heading[1], "heading"), w_paras(body)])
        return _docx_zip(w_table(rows, [2600, 7000]) + "<w:p/>")
    raise ValueError(f"no DOCX renderer for layout {layout}")
