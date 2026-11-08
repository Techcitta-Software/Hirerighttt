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

# Skill names that are also ordinary English words. In free text they only count when written like a skill
# ("Go", "REST", "Spring"), never in lower case ("go live", "the rest of", "spring release").
AMBIGUOUS_SKILLS = frozenset({"go", "rest", "spring", "spark", "rag", "api", "transformers", "embeddings"})

# Everyday English and job-ad filler. Never skills, and not counted in the JD vocabulary overlap.
COMMON_WORDS = (
    frozenset(
        """
        a about above after again all also am an any are as at be because been before being below between both
        but by can could did do does doing done down during each etc few from further get gets had has having he
        her here hers him his how if in into is it its itself just know like make makes many may me more most my
        no nor not now of off on once one only other our ours out over own same she should so some such than that
        their theirs them then there these they this those through to too under until up us very via was we well
        were what when where which while who whom why will within without would you your yours
        able across along around based best build builds building closely collaborate collaborating company day
        daily deliver delivering design designing develop developing drive ensure environment excellent expected
        expert expertise familiar familiarity fast field help hiring ideal including key knowledge large level
        looking manage managing minimum new nice opportunity part people plus position preferred problem problems
        product products project projects proven quality range responsible responsibilities review reviews salary
        scale senior junior skill skills solid solutions solving someone strong support systems teams technical
        technology tools understanding various want way ways wide work working world write writing year years
        months candidate candidates applicants join joining hire hired role roles job jobs team platform
        """.split()
    )
    | SKILL_STOP
)

# Spelling variants that mean the same skill (as written in text → canonical key).
SKILL_ALIASES = {
    "postgres": "postgresql",
    "nodejs": "node.js",
    "node": "node.js",
    "reactjs": "react",
    "react.js": "react",
    "nextjs": "next.js",
    "golang": "go",
    "k8s": "kubernetes",
    "rest api": "rest apis",
    "restful": "rest apis",
    "restful api": "rest apis",
    "restful apis": "rest apis",
    "amazon web services": "aws",
    "gen ai": "generative ai",
    "genai": "generative ai",
}


def _canon(skill: str) -> str:
    key = re.sub(r"\s+", " ", str(skill or "").strip().lower())
    return SKILL_ALIASES.get(key, key)


def _display(skill: str) -> str:
    s = str(skill or "").strip()
    return s[:1].upper() + s[1:] if s and s == s.lower() else s


def _pattern_skills(text: str) -> list[str]:
    """Recognised technical skills in `text`, in order of appearance (ambiguous words only when skill-cased)."""
    found: list[str] = []
    for m in SKILL_PATTERN.finditer(str(text or "")):
        token = m.group(0).strip()
        if token.lower() in AMBIGUOUS_SKILLS and token == token.lower():
            continue
        found.append(token)
    return found


def extract_primary_skills_from_jd(jd: str, required_skills: list | None = None) -> list[str]:
    """Skills a job asks for, most important first.

    1. The skills the vendor listed on the job (as written).
    2. Recognised technical skills named in the JD, in the order they appear.
    3. Only when neither exists (e.g. a non-tech JD without a skill list): distinctive JD words, filler removed.
    Duplicates and fragments of an already-listed skill ("REST" when "REST APIs" is listed) are dropped.
    """
    out: list[str] = []
    seen: set[str] = set()

    def add(raw: str) -> None:
        name = str(raw or "").strip()
        if not name or len(name) > 100:
            return
        key = _canon(name)
        if key in seen:
            return
        if any(len(k) > len(key) and re.search(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])", k) for k in seen):
            return
        seen.add(key)
        out.append(_display(name))

    for s in required_skills or []:
        add(str(s))
    for token in _pattern_skills(jd):
        add(token)
    if not out:
        for word in re.split(r"[^a-z0-9+#./-]+", str(jd or "").lower()):
            word = word.strip("./-")
            if 3 <= len(word) <= 24 and word not in COMMON_WORDS and not word.isdigit():
                add(word)
            if len(out) >= 15:
                break
    return out[:40]


def _has_skill(skill: str, text: str) -> bool:
    """Whole-word match of a skill (or one of its spelling variants, singular or plural) in `text`.

    Skills that are also English words ("Go", "REST", "Spring") only count when not written in lower case.
    """
    key = _canon(skill)
    variants = {key} | {alias for alias, canon in SKILL_ALIASES.items() if canon == key}
    if key.endswith("s") and len(key) > 3:
        variants.add(key[:-1])
    for v in variants:
        pattern = re.compile(r"(?<![A-Za-z0-9])" + re.escape(v) + r"s?(?![A-Za-z0-9])", re.I)
        for m in pattern.finditer(text):
            if v in AMBIGUOUS_SKILLS and m.group(0) == m.group(0).lower():
                continue
            return True
    return False


def _tokenize_skills(text: str) -> set[str]:
    """Meaningful words of a text (filler removed), used for the JD vocabulary overlap."""
    norm = str(text or "").lower()
    out: set[str] = set()
    for token in _pattern_skills(text):
        out.add(_canon(token))
    for part in re.split(r"[^a-z0-9+#./-]+", norm):
        part = part.strip("./-")
        if 3 <= len(part) <= 24 and part not in COMMON_WORDS and not part.isdigit():
            out.add(_canon(part))
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
    matched: list[str] = []
    missing: list[str] = []
    for skill in primary_skills:
        (matched if _has_skill(skill, resume) else missing).append(skill)
    resume_skill_coverage = round((len(matched) / max(1, len(primary_skills))) * 100)

    jd_tokens = _tokenize_skills(jd)
    resume_tokens = _tokenize_skills(resume)
    jd_overlap = 0
    if jd_tokens:
        overlap = sum(1 for t in jd_tokens if t in resume_tokens or _has_skill(t, resume))
        jd_overlap = round((overlap / len(jd_tokens)) * 100)
    # The job's skills carry the score; the JD vocabulary overlap rewards a resume written in the same terms.
    ats_score = min(100, round(resume_skill_coverage * 0.7 + jd_overlap * 0.3))
    return {
        "atsScore": ats_score,
        "jdMatchScore": jd_overlap,
        "resumeSkillCoverage": resume_skill_coverage,
        "primarySkills": primary_skills,
        "matchedSkills": matched,
        "missingSkills": missing[:20],
    }
