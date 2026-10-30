from __future__ import annotations

import re
from typing import Any

SKILL_STOP = frozenset(
    {
        "and",
        "or",
        "the",
        "with",
        "for",
        "years",
        "year",
        "experience",
        "required",
        "must",
        "have",
        "ability",
        "strong",
        "good",
        "plus",
        "including",
        "using",
        "work",
        "team",
        "role",
        "job",
    }
)

SKILL_PATTERN = re.compile(
    r"\b(?:React(?:\.js)?|Node(?:\.js)?|TypeScript|JavaScript|Python|Java|Go|Golang|AWS|Azure|GCP|"
    r"Docker|Kubernetes|SQL|PostgreSQL|MongoDB|Redis|Kafka|GraphQL|REST|API|CI/CD|Agile|Scrum|Next\.js|"
    r"Vue|Angular|Tailwind|Redux|Spring|Django|FastAPI|LLM|Gemini|OpenAI|Machine Learning|Data Engineering|"
    r"DevOps|SRE|Microservices|System Design|PyTorch|TensorFlow|Keras|scikit-learn|Pandas|NumPy|"
    r"Hugging Face|Transformers|LangChain|LlamaIndex|RAG|Embeddings|Vector Database|Pinecone|FAISS|"
    r"pgvector|Fine-tuning|Prompt Engineering|NLP|Computer Vision|Deep Learning|MLOps|MLflow|Spark|"
    r"Airflow|Databricks|Snowflake|dbt|Tableau|Power BI|Figma|Salesforce|SEO|Generative AI)\b",
    re.I,
)


def extract_primary_skills_from_jd(jd: str, required_skills: list | None = None) -> list[str]:
    from_list = [str(s).strip() for s in (required_skills or []) if str(s).strip()]
    found: set[str] = {s.lower() for s in from_list}
    text = str(jd or "")
    for m in SKILL_PATTERN.finditer(text):
        token = m.group(0).strip()
        if len(token) > 1:
            found.add(token.lower())
    for word in re.split(r"[^a-z0-9+#./-]+", text.lower()):
        if len(word) < 2 or len(word) > 24 or word in SKILL_STOP:
            continue
        if re.match(r"^[a-z]+(?:js|ts|py)?$", word) and len(word) >= 3:
            found.add(word)
    return [s.replace(s[0], s[0].upper(), 1) if s else s for s in list(found)[:40]]


def _tokenize_skills(text: str) -> set[str]:
    norm = str(text or "").lower()
    out: set[str] = set()
    for m in SKILL_PATTERN.finditer(norm):
        out.add(m.group(0).lower())
    for part in re.split(r"[^a-z0-9+#./-]+", norm):
        if 3 <= len(part) <= 24 and part not in SKILL_STOP:
            out.add(part)
    return out


def compute_ats_score(input: dict[str, Any]) -> dict[str, Any]:
    jd = str(input.get("jobDescription") or "")
    resume = str(input.get("resumeText") or "")
    primary_skills = extract_primary_skills_from_jd(jd, input.get("requiredSkills") or [])
    if not jd.strip() and not primary_skills:
        return {
            "atsScore": 0,
            "jdMatchScore": 0,
            "resumeSkillCoverage": 0,
            "primarySkills": primary_skills,
            "matchedSkills": [],
            "missingSkills": [],
        }
    jd_tokens = _tokenize_skills(jd)
    resume_tokens = _tokenize_skills(resume)
    skill_keys = [s.lower() for s in primary_skills]
    matched: list[str] = []
    missing: list[str] = []
    for skill in skill_keys if skill_keys else list(jd_tokens)[:25]:
        hit = (
            skill in resume_tokens
            or skill in resume.lower()
            or any(t in skill or skill in t for t in resume_tokens)
        )
        (matched if hit else missing).append(skill)
    denom = max(1, len(skill_keys) or len(jd_tokens) or 1)
    resume_skill_coverage = round((len(matched) / denom) * 100)
    jd_overlap = 0
    if jd_tokens:
        overlap = sum(1 for t in jd_tokens if t in resume_tokens)
        jd_overlap = round((overlap / len(jd_tokens)) * 100)
    ats_score = min(100, round(resume_skill_coverage * 0.65 + jd_overlap * 0.35))
    return {
        "atsScore": ats_score,
        "jdMatchScore": jd_overlap,
        "resumeSkillCoverage": resume_skill_coverage,
        "primarySkills": primary_skills,
        "matchedSkills": matched,
        "missingSkills": missing[:20],
    }
