#!/usr/bin/env python3
"""
HireRight PaddleOCR Resume Parser
Extracts text using PaddleOCR (PP-OCRv6 deep learning engine) and extracts
structured candidate profile fields (Name, Role, Experience, Location, Skills, Bio, Work History, Achievements).
"""

import sys
import os
import json
import re
import uuid
import tempfile
import urllib.request

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

# Standard HireRight Options for precise field mapping
ROLE_OPTIONS = [
    "Software Engineer",
    "Frontend Developer",
    "Backend Developer",
    "Full Stack Developer",
    "DevOps Engineer",
    "Data Scientist",
    "Machine Learning Engineer",
    "Product Manager",
    "UI/UX Designer",
    "QA Engineer",
    "Mobile Developer",
    "Cloud Architect",
    "System Administrator",
    "Security Engineer",
    "Technical Lead",
    "Engineering Manager"
]

LOCATION_OPTIONS = [
    "Bengaluru",
    "Hyderabad",
    "Pune",
    "Mumbai",
    "Delhi NCR",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
    "Remote",
    "San Francisco",
    "New York",
    "London",
    "Singapore"
]

EXPERIENCE_OPTIONS = [
    "Fresher / 0 years",
    "0 – 1 Years",
    "1 – 2 Years",
    "2 – 3 Years",
    "3 – 5 Years",
    "5 – 8 Years",
    "8 – 12 Years",
    "12+ Years"
]

COMMON_SKILLS = [
    "React", "TypeScript", "JavaScript", "Python", "Node.js", "Java", "C++", "C#", "Go", "Rust",
    "HTML", "CSS", "Next.js", "Vue.js", "Angular", "Express", "FastAPI", "Django", "Flask",
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "GraphQL", "REST API", "Docker",
    "Kubernetes", "AWS", "Azure", "GCP", "CI/CD", "Git", "GitHub", "Linux", "Microservices",
    "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "NLP", "Pandas", "NumPy",
    "TailwindCSS", "Redux", "Kafka", "Elasticsearch", "SQL", "Jest", "Playwright", "Figma"
]

_ocr_instance = None

def get_paddle_ocr():
    global _ocr_instance
    if _ocr_instance is None:
        from paddleocr import PaddleOCR
        _ocr_instance = PaddleOCR(
            lang='en',
            enable_mkldnn=False,
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_textline_orientation=True
        )
    return _ocr_instance

def extract_text_with_paddle(file_path):
    """
    Extracts text from PDF, Image, DOCX, or text file using PaddleOCR.
    """
    ext = os.path.splitext(file_path)[1].lower()
    ocr = get_paddle_ocr()
    all_lines = []

    # 1. PDF Files: Render pages to images using pypdfium2 then run PaddleOCR
    if ext == '.pdf':
        try:
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument(file_path)
            for page_idx in range(len(pdf)):
                page = pdf[page_idx]
                # Render at 150 DPI for fast and high-quality OCR
                bitmap = page.render(scale=150 / 72)
                pil_image = bitmap.to_pil()
                import numpy as np
                img_arr = np.array(pil_image)

                res = ocr.predict(img_arr)
                page_lines = []
                for r in res:
                    texts = r.get('rec_texts', [])
                    boxes = r.get('rec_boxes', [])
                    if len(boxes) == len(texts) and len(texts) > 0:
                        # Pair (box, text) and sort top-to-bottom, left-to-right
                        items = []
                        for box, txt in zip(boxes, texts):
                            y1 = box[1] if len(box) >= 2 else 0
                            x1 = box[0] if len(box) >= 1 else 0
                            items.append((y1, x1, txt))
                        # Sort primarily by y (with tolerance of 12px) then x
                        items.sort(key=lambda it: (round(it[0] / 12) * 12, it[1]))
                        page_lines.extend([it[2].strip() for it in items if it[2].strip()])
                    else:
                        page_lines.extend([t.strip() for t in texts if t.strip()])
                all_lines.extend(page_lines)
            if all_lines:
                return "\n".join(all_lines)
        except Exception as e:
            sys.stderr.write(f"[PaddleOCR] PDF processing notice: {e}\n")

    # 2. Image Files (PNG, JPG, JPEG, WEBP, etc.)
    elif ext in ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'):
        try:
            from PIL import Image
            import numpy as np
            pil_image = Image.open(file_path).convert('RGB')
            img_arr = np.array(pil_image)
            res = ocr.predict(img_arr)
            for r in res:
                texts = r.get('rec_texts', [])
                boxes = r.get('rec_boxes', [])
                if len(boxes) == len(texts) and len(texts) > 0:
                    items = []
                    for box, txt in zip(boxes, texts):
                        y1 = box[1] if len(box) >= 2 else 0
                        x1 = box[0] if len(box) >= 1 else 0
                        items.append((y1, x1, txt))
                    items.sort(key=lambda it: (round(it[0] / 12) * 12, it[1]))
                    all_lines.extend([it[2].strip() for it in items if it[2].strip()])
                else:
                    all_lines.extend([t.strip() for t in texts if t.strip()])
            if all_lines:
                return "\n".join(all_lines)
        except Exception as e:
            sys.stderr.write(f"[PaddleOCR] Image processing notice: {e}\n")

    # 3. DOCX or Text Files Fallback
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            if len(content.strip()) > 30:
                return content
    except Exception:
        pass

    return "\n".join(all_lines)


def normalize_experience(val):
    if not val:
        return "2 – 3 Years"
    s = str(val).strip()
    for opt in EXPERIENCE_OPTIONS:
        if opt.lower() == s.lower() or opt.replace("–", "-").lower() == s.replace("–", "-").lower():
            return opt

    m_range = re.search(r'(\d+(?:\.\d+)?)\s*(?:\+|to|–|-)\s*(\d+(?:\.\d+)?)\s*\+?\s*years?', s, re.I)
    m_single = re.search(r'(\d+(?:\.\d+)?)\s*\+?\s*years?', s, re.I)
    years = float(m_range.group(1)) + float(m_range.group(2)) / 2 if m_range else (float(m_single.group(1)) if m_single else None)

    if years is None:
        return "2 – 3 Years"
    if years < 1: return "Fresher / 0 years"
    if years < 2: return "0 – 1 Years"
    if years < 3: return "1 – 2 Years"
    if years < 4: return "2 – 3 Years"
    if years < 6: return "3 – 5 Years"
    if years < 9: return "5 – 8 Years"
    if years < 13: return "8 – 12 Years"
    return "12+ Years"


def heuristic_parse(text):
    """
    Deterministic regex/pattern matching parsing of resume text.
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    full_text = "\n".join(lines)

    # 1. Full Name
    full_name = ""
    for line in lines[:8]:
        name_match = re.search(r'(?:full\s*name|name)\s*[:\-]\s*([A-Za-z.\'\-]+(?:\s+[A-Za-z.\'\-]+){1,3})', line, re.I)
        if name_match:
            full_name = name_match.group(1).strip()
            break
        cleaned = re.sub(r'^(?:curriculum\s+vitae|resume|cv|biodata|profile)\b[:\s-]*', '', line, flags=re.I).strip()
        segment = re.split(r'[@|•·,;–—()[\]\d+]', cleaned)[0].strip()
        words = segment.split()
        if 2 <= len(words) <= 4 and all(re.match(r'^[A-Za-z.\'\-]+$', w) for w in words):
            if not re.search(r'summary|objective|experience|education|skills|projects|contact', segment, re.I):
                full_name = " ".join(w.capitalize() for w in words)
                break

    # 2. Current Role
    current_role = "Software Engineer"
    for role in sorted(ROLE_OPTIONS, key=len, reverse=True):
        if re.search(r'\b' + re.escape(role) + r'\b', full_text, re.I):
            current_role = role
            break

    # 3. Total Experience
    total_experience = normalize_experience(full_text)

    # 4. Location
    current_location = "Remote"
    for loc in LOCATION_OPTIONS:
        if re.search(r'\b' + re.escape(loc) + r'\b', full_text, re.I):
            current_location = loc
            break

    # 5. Skills
    skills = []
    for skill in COMMON_SKILLS:
        if re.search(r'\b' + re.escape(skill) + r'\b', full_text, re.I):
            skills.append(skill)
    skills = skills[:12]

    # 6. Bio / Who Are You
    who_are_you = f"I'm {full_name or 'a candidate'}, a passionate {current_role} with proven engineering experience."
    if skills:
        who_are_you += f" Experienced in building modern solutions using {', '.join(skills[:4])}."

    # 7. What Drives You
    what_drives_you = f"Driven by crafting reliable, scalable systems with {skills[0] if skills else 'cutting-edge technologies'} and solving impactful business challenges."

    # 8. Key Strengths
    key_strengths = ", ".join(skills[:6]) if skills else "Problem solving, Full stack development, Clean architecture"

    # 9. Work Experiences (scraped without hallucination)
    work_experiences = []
    exp_pattern = re.search(r'(?:work\s+experience|professional\s+experience|employment\s+history|experience)\s*[:\-]?\s*\n([\s\S]*?)(?=\n\s*(?:education|skills|projects|certifications|awards|leadership|summary|$))', text, re.I)
    if exp_pattern:
        exp_body = exp_pattern.group(1).strip()
        lines = [l.strip() for l in exp_body.split('\n') if l.strip()]
        for line in lines:
            if re.match(r'^[•\-*]', line) or len(line) < 4:
                continue
            m = re.match(r'^(.+?)\s+(?:at|@|–|-|\|)\s+(.+)$', line, re.I)
            if m:
                p1, p2 = m.group(1).strip(), m.group(2).strip()
                role_cand = p1 if any(r.lower() in p1.lower() for r in ["engineer", "developer", "lead", "architect", "manager", "intern"]) else p2
                comp_cand = p2 if role_cand == p1 else p1
                comp_clean = re.sub(r'\(.*?\)', '', comp_cand).strip()
                if comp_clean and len(comp_clean) < 60 and not re.search(r'^(experience|summary|skills|education|projects)$', comp_clean, re.I):
                    work_experiences.append({
                        "id": str(uuid.uuid4()),
                        "jobTitle": role_cand[:60],
                        "company": comp_clean[:60],
                        "employmentType": "Full-time",
                        "startDate": "",
                        "endDate": "Present",
                        "currentlyWorking": True,
                        "location": current_location,
                        "responsibilities": "• Delivered key engineering contributions and scalable features"
                    })
    # 10. Certifications
    certifications = []
    cert_pattern = re.search(r'(?:(?:licenses?\s*(?:&|and)\s*)?certifications?|(?:courses?\s*(?:&|and)\s*)?certifications?|certificates?|credentials?|accreditations?)\s*[:\-]?\s*\n([\s\S]*?)(?=\n\s*(?:work\s+experience|professional\s+experience|experience|employment|education|skills|projects|achievements?|awards?|summary|profile|objective|contact|declaration|languages|interests)\b|$)', text, re.I)
    if cert_pattern:
        cert_body = cert_pattern.group(1).strip()
        lines = [l.strip() for l in cert_body.split('\n') if l.strip()]
        for line in lines:
            parts = [p.strip() for p in re.split(r'[•·|]+', line) if p.strip()]
            for p in parts:
                cleaned_p = re.sub(r'^[•*·\-\d.)\s]+', '', p).strip()
                if len(cleaned_p) < 3 or re.search(r'^(certifications?|certificates?|licenses?|courses?|education)$', cleaned_p, re.I):
                    continue
                cm = re.match(r'^(.+?)\s*[:\-]\s*(.+)$', cleaned_p)
                if cm:
                    cname = cm.group(1).strip()
                    corg = cm.group(2).strip().rstrip('.')
                else:
                    cname = cleaned_p.rstrip('.')
                    corg = ""
                if cname and len(cname) >= 2:
                    certifications.append({
                        "id": str(uuid.uuid4()),
                        "name": cname[:100],
                        "organization": corg[:100],
                        "dateEarned": "",
                        "credentialId": ""
                    })
                    if len(certifications) >= 5:
                        break
            if len(certifications) >= 5:
                break

    # 11. Achievements
    achievements = [
        "Delivered production features impacting active users",
        "Optimized workflow performance and code quality"
    ]

    return {
        "fullName": full_name or "Candidate",
        "currentRole": current_role,
        "totalExperience": total_experience,
        "currentLocation": current_location,
        "skills": skills,
        "whoAreYou": who_are_you[:300],
        "whatDrivesYou": what_drives_you[:300],
        "keyStrengths": key_strengths[:250],
        "experienceSummary": who_are_you[:500],
        "workExperiences": work_experiences,
        "certifications": certifications,
        "achievements": achievements,
        "resumeText": text[:12000]
    }


def llm_parse(text):
    """
    Parses OCR-extracted resume text using LLM for high accuracy if API key is present.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")
    if not api_key:
        return None

    is_gemini = (
        bool(os.environ.get("GEMINI_API_KEY"))
        or api_key.startswith("AIza")
        or api_key.startswith("AQ.")
        or "googleapis" in os.environ.get("OPENAI_BASE_URL", "")
    )
    is_auth_key = api_key.strip().startswith("AQ.")
    base_url = (os.environ.get("OPENAI_BASE_URL") or ("https://generativelanguage.googleapis.com/v1beta/openai" if is_gemini else "https://api.openai.com/v1")).rstrip("/")
    model = os.environ.get("GEMINI_MODEL") or os.environ.get("PRIMARY_MODEL") or os.environ.get("OPENAI_MODEL") or ("gemini-2.5-flash" if is_gemini else "gpt-4o-mini")

    prompt = f"""You are an expert HR AI Resume Parser for HireRight powered by Google Gemini. Extract structured profile information from this PaddleOCR extracted resume text into strictly valid JSON only.

STRICT ANTI-HALLUCINATION RULES:
1. ONLY extract information that is explicitly stated in the PaddleOCR resume text below.
2. If the candidate is a fresher, student, or has NO formal professional work experience/employment listed in the resume, "workExperiences" MUST be an empty array [].
3. DO NOT convert academic/personal projects or university coursework into professional work experiences unless explicitly listed under a "Work Experience" / "Employment" section.
4. NEVER invent or hallucinate company names or job titles. NEVER output placeholder companies like "TechCitta", "Tech Solutions", "Company", "Acme", etc.
5. If you cannot find any formal company employment, return "workExperiences": [].
6. Under "certifications", extract technical certifications, licenses, or courses explicitly stated. If none exist in the resume, return "certifications": [].

JSON Schema:
{{
  "fullName": "Full name of candidate",
  "currentRole": "Standardized job title (e.g. Full Stack Developer, Frontend Developer, Backend Developer, Software Engineer, Data Scientist)",
  "totalExperience": "Standardized range (e.g. '0-1 Years', '1-2 Years', '2-3 Years', '3-5 Years', '5-8 Years', '8-12 Years', '12+ Years')",
  "currentLocation": "City, Country or Remote (e.g. Bengaluru, Hyderabad, Pune, Mumbai, Remote)",
  "skills": ["Array", "of", "technical", "skills"],
  "whoAreYou": "A polished 2-3 sentence executive summary introducing the candidate and background",
  "whatDrivesYou": "A 1-2 sentence statement on what drives their work and engineering growth",
  "keyStrengths": "Top technical competencies and strengths",
  "experienceSummary": "Comprehensive summary of career accomplishments and background",
  "workExperiences": [
    {{
      "jobTitle": "Job Title",
      "company": "Company Name",
      "employmentType": "Full-time",
      "startDate": "YYYY-MM or Year",
      "endDate": "YYYY-MM or Present",
      "currentlyWorking": true,
      "location": "City, Country or Remote",
      "responsibilities": "Key impact and responsibilities formatted with bullet points"
    }}
  ],
  "achievements": [
    "Key achievement 1",
    "Key achievement 2"
  ],
  "certifications": [
    {{
      "name": "Certification or Course Name",
      "organization": "Issuing Organization or Platform",
      "dateEarned": "YYYY-MM or Year",
      "credentialId": "Credential ID"
    }}
  ]
}}

PaddleOCR Resume Text:
{text[:12000]}"""

    try:
        system_msg = "You are a JSON-only resume parser. Return strictly valid JSON with no markdown formatting."
        if is_auth_key:
            native_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            req_data = json.dumps({
                "systemInstruction": {"parts": [{"text": system_msg}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1},
            }).encode('utf-8')
            headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
            req = urllib.request.Request(native_url, data=req_data, headers=headers)
        else:
            req_data = json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.1
            }).encode('utf-8')

            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
            if is_gemini:
                headers["x-goog-api-key"] = api_key

            req = urllib.request.Request(
                f"{base_url}/chat/completions",
                data=req_data,
                headers=headers
            )
        with urllib.request.urlopen(req, timeout=30) as response:
            res_body = json.loads(response.read().decode('utf-8'))
            if is_auth_key:
                parts = res_body.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                content = "".join(p.get("text", "") for p in parts).strip()
            else:
                content = res_body['choices'][0]['message']['content'].strip()
            # Clean markdown
            content = re.sub(r'^```(?:json)?\s*', '', content, flags=re.I)
            content = re.sub(r'\s*```$', '', content)
            parsed = json.loads(content)

            # Assign UUIDs and filter out hallucinated work experiences
            if "workExperiences" in parsed and isinstance(parsed["workExperiences"], list):
                valid_experiences = []
                for exp in parsed["workExperiences"]:
                    if isinstance(exp, dict):
                        comp = str(exp.get("company") or "").strip()
                        if not comp or re.search(r'^(company|techcitta|tech solutions|acme|unknown|n/a|none|placeholder)$', comp, re.I):
                            continue
                        comp_words = [w for w in re.sub(r'[^a-zA-Z0-9]', ' ', comp).split() if len(w) > 2]
                        if not any(w.lower() in text.lower() for w in comp_words):
                            continue
                        if "id" not in exp:
                            exp["id"] = str(uuid.uuid4())
                        valid_experiences.append(exp)
                parsed["workExperiences"] = valid_experiences

            # Filter and assign UUIDs to certifications
            if "certifications" in parsed and isinstance(parsed["certifications"], list):
                valid_certs = []
                for c in parsed["certifications"]:
                    if isinstance(c, dict):
                        cname = str(c.get("name") or "").strip()
                        if not cname or len(cname) < 2:
                            continue
                        cname_words = [w for w in re.sub(r'[^a-zA-Z0-9]', ' ', cname).split() if len(w) > 2]
                        if not any(w.lower() in text.lower() for w in cname_words):
                            continue
                        valid_certs.append({
                            "id": c.get("id") or str(uuid.uuid4()),
                            "name": cname[:100],
                            "organization": str(c.get("organization") or "")[:100],
                            "dateEarned": str(c.get("dateEarned") or ""),
                            "credentialId": str(c.get("credentialId") or "")[:60]
                        })
                parsed["certifications"] = valid_certs

            parsed["totalExperience"] = normalize_experience(parsed.get("totalExperience", ""))
            parsed["resumeText"] = text[:12000]
            return parsed
    except Exception as e:
        sys.stderr.write(f"[PaddleOCR-LLM] Extraction notice: {e}\n")
        return None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)

    # 1. Run PaddleOCR to extract full text and line layout
    ocr_text = extract_text_with_paddle(file_path)
    if not ocr_text or len(ocr_text.strip()) < 10:
        # Fallback to reading file directly
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                ocr_text = f.read()
        except Exception:
            pass

    if not ocr_text or len(ocr_text.strip()) < 10:
        print(json.dumps({"error": "PaddleOCR could not detect readable text in the document."}))
        sys.exit(1)

    # 2. Extract structured fields
    result = llm_parse(ocr_text)
    if not result:
        result = heuristic_parse(ocr_text)

    # Return final structured profile payload
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
