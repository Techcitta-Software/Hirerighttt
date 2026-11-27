"""Skill names as one canonical spelling: 'ReactJS' -> 'React', 'Excel (pivot tables)' -> 'Excel', dedupe, <= 40."""

from __future__ import annotations

import re

MAX_SKILLS = 40
MAX_SKILL_WORDS = 4

# lower-case spelling (punctuation and spaces kept) -> canonical name
ALIASES: dict[str, str] = {
    "reactjs": "React", "react.js": "React", "react js": "React", "react": "React",
    "nodejs": "Node.js", "node.js": "Node.js", "node js": "Node.js", "node": "Node.js",
    "nextjs": "Next.js", "next.js": "Next.js", "next js": "Next.js",
    "vuejs": "Vue.js", "vue.js": "Vue.js", "vue": "Vue.js",
    "angularjs": "Angular", "angular.js": "Angular",
    "expressjs": "Express", "express.js": "Express",
    "js": "JavaScript", "javascript": "JavaScript", "es6": "JavaScript",
    "ts": "TypeScript", "typescript": "TypeScript",
    "py": "Python", "python3": "Python", "python 3": "Python", "python": "Python",
    "golang": "Go",
    "postgres": "PostgreSQL", "postgresql": "PostgreSQL", "postgre sql": "PostgreSQL", "psql": "PostgreSQL",
    "mysql": "MySQL", "mongo": "MongoDB", "mongodb": "MongoDB", "mssql": "SQL Server", "ms sql": "SQL Server",
    "sql server": "SQL Server", "ms sql server": "SQL Server",
    "k8s": "Kubernetes", "kubernetes": "Kubernetes",
    "amazon web services": "AWS", "aws": "AWS", "aws cloud": "AWS",
    "google cloud": "GCP", "google cloud platform": "GCP", "gcp": "GCP",
    "microsoft azure": "Azure", "azure": "Azure",
    "ms excel": "Excel", "microsoft excel": "Excel", "advanced excel": "Excel", "excel": "Excel",
    "ms word": "Word", "microsoft word": "Word", "ms office": "MS Office", "microsoft office": "MS Office",
    "powerbi": "Power BI", "power bi": "Power BI", "ms power bi": "Power BI",
    "tailwind": "Tailwind CSS", "tailwindcss": "Tailwind CSS", "tailwind css": "Tailwind CSS",
    "html5": "HTML", "html": "HTML", "css3": "CSS", "css": "CSS",
    "c plus plus": "C++", "cpp": "C++", "c sharp": "C#", "csharp": "C#",
    "dotnet": ".NET", ".net": ".NET", "asp.net": "ASP.NET",
    "scikit learn": "scikit-learn", "sklearn": "scikit-learn", "scikit-learn": "scikit-learn",
    "tensorflow": "TensorFlow", "pytorch": "PyTorch", "pandas": "pandas", "numpy": "NumPy",
    "fastapi": "FastAPI", "django": "Django", "flask": "Flask", "spring boot": "Spring Boot", "springboot": "Spring Boot",
    "rest": "REST APIs", "rest api": "REST APIs", "rest apis": "REST APIs", "restful apis": "REST APIs", "restful api": "REST APIs",
    "graphql": "GraphQL", "docker": "Docker", "git": "Git", "github": "GitHub", "jira": "Jira",
    "ci/cd": "CI/CD", "cicd": "CI/CD", "ci cd": "CI/CD",
    "ml": "Machine Learning", "machine learning": "Machine Learning", "dl": "Deep Learning", "deep learning": "Deep Learning",
    "nlp": "NLP", "natural language processing": "NLP",
    "adobe xd": "Adobe XD", "xd": "Adobe XD", "figma": "Figma",
    "ui/ux": "UI/UX", "ux/ui": "UI/UX",
    "salesforce crm": "Salesforce", "sfdc": "Salesforce",
}


def _key(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def normalize_skill(value: str) -> str:
    """One skill, canonical spelling, or "" when it is not a skill-like item (a sentence, a heading, a number)."""
    v = re.sub(r"\s+", " ", str(value or "")).strip(" .,;:-–—•*")
    if not v:
        return ""
    base = re.sub(r"\s*\([^)]*\)\s*$", "", v).strip()  # "Excel (pivot tables)" -> "Excel"
    if base:
        v = base
    if len(v) > 40 or len(v.split()) > MAX_SKILL_WORDS:
        return ""
    if re.fullmatch(r"[\d\s.%+/-]+", v) or not re.search(r"[A-Za-z]", v):
        return ""
    known = ALIASES.get(_key(v))
    if known:
        return known
    if v.isupper() and len(v) > 5 and " " in v:
        v = v.title()
    return v


def parenthetical_skills(value: str) -> list[str]:
    """'SQL (PostgreSQL, SQL Server)' -> ['PostgreSQL', 'SQL Server'] (only items that are written like names)."""
    m = re.search(r"\(([^)]*)\)\s*$", str(value or ""))
    if not m:
        return []
    out = []
    for part in re.split(r"\s*[,/;]\s*", m.group(1)):
        part = part.strip()
        if part and re.match(r"^[A-Z]", part) and len(part.split()) <= 3:
            n = normalize_skill(part)
            if n:
                out.append(n)
    return out


def normalize_skill_list(values: list[str], limit: int = MAX_SKILLS) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values or []:
        for item in [normalize_skill(str(raw))] + parenthetical_skills(str(raw)):
            k = _key(item)
            if item and k not in seen:
                seen.add(k)
                out.append(item)
            if len(out) >= limit:
                return out
    return out
