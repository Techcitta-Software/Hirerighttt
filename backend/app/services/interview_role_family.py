"""Job-family detection and the per-family interview data for the non-technical question model.

No LLM. `detect_role_family` decides which of 15 job families a candidate (or the job they applied to) belongs to:
- job signals (job title, then JD text) win when they are present;
- otherwise the resume decides, using the resume classifier in `interview_question_model` as the technical vs
  non-technical backbone;
- a thin or ambiguous resume defaults to `general_professional` (non-technical), never to software prompts.

`ROLE_FAMILIES` holds, for every family: display label, track, question categories, stakeholder word, competencies,
practical job-knowledge prompts, "what would you do" scenarios, STAR prompts (experienced and fresher), and the
rubric/report wording. The non-technical turn plan in `interview_llm_questions` and its deterministic fallback bank
are built from this data, so a Gemini outage never blocks a non-technical interview.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from typing import Any

TECHNICAL = "technical"
NON_TECHNICAL = "non_technical"

TECHNICAL_FAMILIES = ("software", "data", "core_engineering", "it_qa")
NON_TECHNICAL_FAMILIES = (
    "sales",
    "support",
    "hr",
    "operations",
    "finance",
    "marketing",
    "healthcare",
    "education",
    "hospitality",
    "design",
    "general_professional",
)
ALL_FAMILIES = TECHNICAL_FAMILIES + NON_TECHNICAL_FAMILIES
DEFAULT_FAMILY = "general_professional"


@dataclass(frozen=True)
class RoleFamily:
    family: str
    track: str  # "technical" | "non_technical"
    confidence: str  # "high" | "medium" | "low"
    reason: str
    source: str  # "job" | "resume" | "default"
    label: str = ""
    scores: dict[str, int] = field(default_factory=dict)

    @property
    def question_model(self) -> str:
        return self.track

    def as_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["questionModel"] = self.track
        return out


# --------------------------------------------------------------------------------------------------------------------
# Family keyword tables. Titles are matched against title fields (weight 5 for the deciding title, 3 for others) and
# against free text (weight 2). Terms are domain words found anywhere (weight 1 each). Education terms weigh 2.
# --------------------------------------------------------------------------------------------------------------------

_FAMILY_SIGNALS: dict[str, dict[str, tuple[str, ...]]] = {
    "software": {
        "titles": (
            "software engineer", "software developer", "sde", "swe", "full stack", "fullstack", "frontend developer",
            "front end developer", "backend developer", "back end developer", "web developer", "mobile developer",
            "android developer", "ios developer", "devops", "sre", "site reliability", "cloud engineer",
            "platform engineer", "programmer", "security engineer", "embedded engineer", "firmware engineer",
            "software architect", "solutions architect", "game developer", "python developer", "java developer",
            "react developer", "ui developer", "blockchain developer", "application developer",
        ),
        "terms": (
            "python", "java", "javascript", "typescript", "react", "node js", "django", "flask", "spring boot",
            "docker", "kubernetes", "aws", "azure", "gcp", "microservices", "git", "rest api", "c++", "golang",
            "html", "css", "graphql", "redis", "postgresql", "mongodb", "ci cd", "data structures", "algorithms",
        ),
        "education": ("computer science", "information technology"),
    },
    "data": {
        "titles": (
            "data analyst", "data scientist", "data engineer", "machine learning engineer", "ml engineer",
            "bi analyst", "business intelligence", "analytics engineer", "mis analyst", "research analyst",
        ),
        "terms": (
            "sql", "power bi", "tableau", "pandas", "numpy", "statistics", "machine learning", "etl",
            "data visualization", "data visualisation", "spark", "hadoop", "looker", "dashboards", "regression",
        ),
        "education": ("data science", "statistics"),
    },
    "core_engineering": {
        "titles": (
            "mechanical engineer", "civil engineer", "electrical engineer", "electronics engineer", "chemical engineer",
            "production engineer", "manufacturing engineer", "quality engineer", "maintenance engineer", "site engineer",
            "structural engineer", "process engineer", "design engineer", "project engineer", "plant engineer",
            "automobile engineer", "instrumentation engineer", "hvac engineer", "piping engineer",
        ),
        "terms": (
            "autocad", "solidworks", "catia", "ansys", "plc", "scada", "hvac", "cnc", "lean manufacturing", "piping",
            "revit", "staad", "matlab", "site supervision", "quality control", "iso 9001", "gd t", "creo",
            "fmea", "root cause analysis", "bill of quantities",
        ),
        "education": ("mechanical engineering", "civil engineering", "electrical engineering", "diploma in mechanical"),
    },
    "it_qa": {
        "titles": (
            "it support", "it helpdesk", "desktop support", "technical support", "system administrator",
            "network administrator", "qa tester", "manual tester", "software tester", "test engineer", "qa analyst",
            "qa engineer", "sdet", "it administrator", "network engineer",
        ),
        "terms": (
            "troubleshooting", "active directory", "windows server", "itil", "test cases", "manual testing",
            "regression testing", "ccna", "servicenow", "selenium", "bug tracking", "test plan",
        ),
        "education": (),
    },
    "sales": {
        "titles": (
            "sales executive", "sales manager", "sales associate", "sales representative", "sales officer",
            "account executive", "account manager", "business development", "bde", "bdm", "inside sales",
            "field sales", "territory manager", "area sales manager", "key account manager", "relationship manager",
            "medical representative", "medical rep", "pharma sales", "telecaller", "tele caller", "sales consultant",
            "sales head", "channel sales", "regional sales",
        ),
        "terms": (
            "lead generation", "cold calling", "negotiation", "quota", "pipeline", "salesforce", "hubspot", "zoho crm",
            "crm", "closing deals", "revenue target", "sales target", "prospecting", "upselling", "cross selling",
            "doctor calls", "territory", "channel partners", "distributors", "b2b sales",
        ),
        "education": (),
    },
    "support": {
        "titles": (
            "customer support", "customer service", "customer success", "client success", "call center",
            "call centre", "contact center", "contact centre", "support specialist", "support executive",
            "customer care", "customer care executive", "chat support", "voice process", "helpdesk", "help desk",
            "client servicing", "service desk",
        ),
        "terms": (
            "zendesk", "freshdesk", "intercom", "ticketing", "sla", "csat", "nps", "escalation", "de escalation",
            "chat process", "customer satisfaction", "first call resolution", "aht", "bpo", "complaint handling",
        ),
        "education": (),
    },
    "hr": {
        "titles": (
            "recruiter", "talent acquisition", "human resources", "hr executive", "hr manager", "hr generalist",
            "hr business partner", "hrbp", "hr intern", "people operations", "hr coordinator", "hr associate",
            "payroll executive", "hr admin", "talent partner",
        ),
        "terms": (
            "recruitment", "sourcing", "onboarding", "employee engagement", "payroll", "hris", "labour law",
            "labor law", "performance appraisal", "naukri", "linkedin recruiter", "exit interviews", "grievance",
            "background verification", "induction", "compensation and benefits", "statutory compliance",
        ),
        "education": ("mba hr", "human resource management"),
    },
    "operations": {
        "titles": (
            "operations executive", "operations manager", "operations associate", "admin executive", "administrator",
            "office manager", "supply chain", "logistics", "warehouse", "procurement", "purchase executive",
            "purchase manager", "inventory", "store keeper", "storekeeper", "fleet", "dispatch", "project coordinator",
            "back office", "office administrator", "facility manager", "facilities", "shift supervisor",
        ),
        "terms": (
            "vendor management", "inventory management", "procurement", "logistics", "sap mm", "supply chain",
            "warehouse", "dispatch", "mis reports", "purchase orders", "stock", "shipment", "process improvement",
            "sop", "fleet",
        ),
        "education": (),
    },
    "finance": {
        "titles": (
            "accountant", "finance executive", "finance manager", "financial analyst", "accounts payable",
            "accounts receivable", "accounts executive", "auditor", "chartered accountant", "tax consultant",
            "credit analyst", "accounts assistant", "bookkeeper", "finance associate", "accounts manager",
            "bank teller", "loan officer", "treasury",
        ),
        "terms": (
            "tally", "quickbooks", "reconciliation", "gst", "tds", "bookkeeping", "financial statements",
            "month end close", "invoicing", "budgeting", "sap fico", "audit", "ifrs", "ledger", "accounts payable",
            "accounts receivable", "collections", "balance sheet", "cash flow",
        ),
        "education": ("bcom", "b com", "mcom", "m com", "chartered accountancy", "cma", "acca"),
    },
    "marketing": {
        "titles": (
            "marketing executive", "marketing manager", "digital marketing", "content writer", "social media",
            "seo executive", "seo analyst", "brand manager", "copywriter", "communications manager",
            "marketing associate", "growth marketer", "performance marketing", "content strategist", "pr executive",
        ),
        "terms": (
            "seo", "sem", "google ads", "facebook ads", "meta ads", "content marketing", "campaign", "campaigns",
            "email marketing", "google analytics", "brand", "social media marketing", "influencer", "ctr",
            "conversion rate", "content calendar",
        ),
        "education": ("mass communication", "journalism"),
    },
    "healthcare": {
        "titles": (
            "nurse", "staff nurse", "registered nurse", "icu nurse", "nursing officer", "nursing", "pharmacist",
            "lab technician", "medical officer", "doctor", "physician", "physiotherapist", "caregiver",
            "healthcare assistant", "medical assistant", "dental", "dentist", "radiographer", "ward", "midwife",
            "clinical", "patient care", "dietitian", "optometrist",
        ),
        "terms": (
            "patient care", "triage", "vital signs", "medication administration", "infection control", "bls", "acls",
            "wound care", "icu", "opd", "emr", "patient safety", "iv cannulation", "catheter", "ward", "hospital",
            "patients", "nicu", "operation theatre", "clinical",
        ),
        "education": ("nursing", "b sc nursing", "bsc nursing", "gnm", "anm", "b pharm", "bpharm", "mbbs", "bds",
                      "pharmacy", "physiotherapy", "bpt"),
    },
    "education": {
        "titles": (
            "teacher", "lecturer", "professor", "tutor", "faculty", "educator", "trainer", "principal",
            "teaching assistant", "academic counselor", "admissions counselor", "school counselor", "instructor",
            "assistant professor", "pgt", "tgt", "prt",
        ),
        "terms": (
            "lesson planning", "classroom management", "curriculum", "cbse", "icse", "students", "pedagogy",
            "lesson plans", "parent teacher", "teaching", "school", "syllabus", "grading",
        ),
        "education": ("b ed", "bed", "m ed", "d el ed", "teacher training"),
    },
    "hospitality": {
        "titles": (
            "chef", "sous chef", "commis", "cook", "head chef", "kitchen", "restaurant", "waiter", "waitress",
            "barista", "bartender", "hotel", "front office", "front desk", "housekeeping", "f b", "steward",
            "cashier", "retail associate", "store manager", "guest relations", "banquet", "restaurant manager",
            "store associate", "floor manager", "concierge",
        ),
        "terms": (
            "food safety", "haccp", "menu planning", "guest relations", "pos", "hotel management", "banquet",
            "fine dining", "food preparation", "kitchen", "guests", "hygiene", "retail store", "visual merchandising",
            "food cost",
        ),
        "education": ("hotel management", "culinary", "catering"),
    },
    "design": {
        "titles": (
            "graphic designer", "ui ux designer", "ui designer", "ux designer", "product designer", "visual designer",
            "interior designer", "fashion designer", "illustrator", "animator", "video editor", "photographer",
            "art director", "motion designer", "creative designer", "ui ux",
        ),
        "terms": (
            "figma", "photoshop", "adobe illustrator", "adobe xd", "sketch", "canva", "after effects", "premiere pro",
            "coreldraw", "typography", "wireframing", "wireframes", "prototyping", "user research", "branding",
            "indesign", "autocad interior",
        ),
        "education": ("fine arts", "bfa", "design", "nift", "fashion design"),
    },
    "general_professional": {
        "titles": (
            "executive assistant", "personal assistant", "data entry", "coordinator", "secretary", "clerk",
            "receptionist", "management trainee",
        ),
        "terms": (),
        "education": ("mba", "bba", "ba", "b a"),
    },
}


# --------------------------------------------------------------------------------------------------------------------
# Family specs: question data. Every text is <= 45 words, one question, family vocabulary only.
# knowledge: (anchor keyword, practical "how do you" question)
# scenarios: (anchor keyword, "what would you do" case)
# competencies: dict(key, name, keyword, star, fresher_star, fresher_keyword)
# --------------------------------------------------------------------------------------------------------------------


def _comp(key: str, name: str, keyword: str, star: str, fresher_star: str, fresher_keyword: str = "") -> dict[str, str]:
    return {
        "key": key,
        "name": name,
        "keyword": keyword,
        "star": star,
        "fresherStar": fresher_star,
        "fresherKeyword": fresher_keyword or keyword,
    }


_NONTECH_CATS = ("Situational Judgment", "Behavioural", "Experience & Results")

ROLE_FAMILIES: dict[str, dict[str, Any]] = {
    "software": {
        "label": "Software engineering",
        "track": TECHNICAL,
        "categories": ("Technical", "Problem Solving", "Experience", "Communication"),
        "stakeholder": "product owner",
        "competencies": ("concepts", "design", "debugging", "testing", "performance", "ownership"),
    },
    "data": {
        "label": "Data & analytics",
        "track": TECHNICAL,
        "categories": ("Technical", "Analysis", "Experience", "Communication"),
        "stakeholder": "business stakeholder",
        "competencies": ("SQL and modelling", "metric design", "data quality", "storytelling"),
    },
    "core_engineering": {
        "label": "Core engineering",
        "track": TECHNICAL,
        "categories": ("Engineering Knowledge", "Problem Solving", "Safety & Quality", "Experience"),
        "stakeholder": "site or plant manager",
        "competencies": ("design calculations", "standards and codes", "safety", "root cause", "tools"),
    },
    "it_qa": {
        "label": "IT support & QA",
        "track": TECHNICAL,
        "categories": ("Troubleshooting", "Process", "Customer Handling", "Experience"),
        "stakeholder": "user",
        "competencies": ("troubleshooting steps", "ticket triage", "test cases", "documentation"),
    },
    "sales": {
        "label": "Sales & business development",
        "track": NON_TECHNICAL,
        "categories": ("Sales Knowledge",) + _NONTECH_CATS,
        "stakeholder": "buyer",
        "knowledge": (
            ("pipeline", "How do you decide which deals in your pipeline get your time in the last two weeks of a quarter?"),
            ("qualif", "How do you qualify a new lead before you spend real time on it? What do you check first?"),
            ("forecast", "How do you build your sales forecast for the month, and how do you tell which deals are real?"),
        ),
        "scenarios": (
            ("price", "On the final call, a buyer says your price is 30% higher than a competitor's. What would you do first?"),
            ("renewal", "A key account tells you two weeks before renewal that they are talking to another vendor. What would you do?"),
            ("discount", "Your manager wants this deal closed this week, but the buyer asks for a discount above your approval limit. What would you do?"),
        ),
        "competencies": (
            _comp("objection", "objection handling", "objection",
                  "Tell me about a time a buyer raised a serious objection late in a deal. What did you say, and how did it end?",
                  "Tell me about a time in college, an internship or a part-time job when someone raised an objection to your idea or offer. How did you handle it?"),
            _comp("negotiation", "negotiation", "negotiat",
                  "Tell me about a negotiation where you had to protect your margin. What did you give, what did you hold, and what was the result?",
                  "Tell me about a time you had to negotiate something in college, an internship or a part-time job. What did you ask for, and what did you agree?"),
            _comp("target", "pipeline and target pressure", "target",
                  "Tell me about a month or quarter when you were behind target. What did you change, and where did you finish?",
                  "Tell me about a time you were behind on a target or deadline in college or an internship. What did you change?"),
            _comp("recovery", "account recovery", "unhappy",
                  "Tell me about a time you won back an unhappy client. What did you do first, and what changed?",
                  "Tell me about a time you dealt with an unhappy customer in an internship, part-time job or college event. What did you do?"),
        ),
    },
    "support": {
        "label": "Customer support & success",
        "track": NON_TECHNICAL,
        "categories": ("Support Knowledge",) + _NONTECH_CATS,
        "stakeholder": "customer",
        "knowledge": (
            ("priorit", "How do you prioritise your ticket queue when many customers are waiting and two tickets are close to breaching the SLA?"),
            ("escalat", "How do you decide when to escalate a customer issue instead of solving it yourself, and what do you include when you escalate?"),
            ("csat", "What do you do on a call or chat to keep your CSAT high, and how do you check that it is working?"),
        ),
        "scenarios": (
            ("angry", "An angry customer has contacted you three times about the same refund and threatens a bad review. What would you do on this call?"),
            ("outage", "During a service outage, fifty customers message at once and you have no fix time yet. What would you tell them first?"),
            ("refund", "A long-time customer asks for a refund that the policy does not allow. What would you do?"),
        ),
        "competencies": (
            _comp("deescalation", "de-escalation", "upset",
                  "Tell me about a time you had to calm down a very upset customer. What did you say, and how did it end?",
                  "Tell me about a time you had to calm down an upset person in college, an internship or a part-time job. What did you say?"),
            _comp("ownership", "ownership to resolution", "follow",
                  "Tell me about a time you followed a customer issue through to the end even though it was not your team's problem. What did you do?",
                  "Tell me about a time you followed a problem through to the end for someone in college or an internship. What did you do?"),
            _comp("feedback", "customer feedback loop", "feedback",
                  "Tell me about a time customer feedback you collected changed how your team or product worked. What did you do with it?",
                  "Tell me about a time you used feedback from others to change something you ran in college or an internship. What changed?"),
            _comp("pressure", "working under volume pressure", "pressure",
                  "Tell me about a shift when volume was far above normal. How did you handle the pressure, and what happened to your queue?",
                  "Tell me about a time you worked under heavy pressure in college, an internship or a part-time job. How did you handle it?"),
        ),
    },
    "hr": {
        "label": "HR & recruiting",
        "track": NON_TECHNICAL,
        "categories": ("HR Knowledge",) + _NONTECH_CATS,
        "stakeholder": "hiring manager",
        "knowledge": (
            ("screen", "How do you screen two hundred applications for one role? What do you check first, and what makes you reject a profile?"),
            ("onboard", "How do you plan the first week of onboarding for a new joiner so they settle in and become productive quickly?"),
            ("panel", "How do you prepare an interview panel so that every candidate for a role is assessed fairly and consistently?"),
        ),
        "scenarios": (
            ("offer", "A strong candidate accepts your offer, then says a week before joining that a competitor offered 20% more. What would you do?"),
            ("complaint", "An employee brings you a harassment complaint against their manager. What would you do in the first 24 hours?"),
            ("hiring manager", "A hiring manager rejects every candidate you send but cannot say what is missing. What would you do?"),
        ),
        "competencies": (
            _comp("conflict", "conflict resolution", "conflict",
                  "Tell me about a time you handled a conflict between two employees, or between an employee and their manager. What did you do, and how did it end?",
                  "Tell me about a time you helped settle a conflict between people in college, an internship or a part-time job. What did you do?"),
            _comp("hiring", "hiring judgement", "hire",
                  "Tell me about a time you pushed back on a hire, or pushed for one, against someone else's opinion. What did you see, and what happened?",
                  "Tell me about a time you had to pick people for a team, club or event in college. How did you decide, and did it work?", "pick"),
            _comp("confidentiality", "confidentiality and compliance", "confidential",
                  "Tell me about a time you had to protect confidential employee information while someone senior pressed you for it. What did you do?",
                  "Tell me about a time someone trusted you with confidential information in college or an internship. How did you handle it?"),
            _comp("engagement", "engagement and retention", "morale",
                  "Tell me about a time you noticed low morale or rising attrition in a team. What did you do about it, and what changed?",
                  "Tell me about a time you noticed low morale in a team, club or class group. What did you do?"),
        ),
    },
    "operations": {
        "label": "Operations, admin & supply chain",
        "track": NON_TECHNICAL,
        "categories": ("Operations Knowledge",) + _NONTECH_CATS,
        "stakeholder": "vendor",
        "knowledge": (
            ("inventory", "How do you set reorder levels for your inventory so you neither run out nor hold too much stock?"),
            ("vendor", "How do you compare two vendors for the same supply? What do you check beyond the price?"),
            ("process", "How do you find the slowest step in a daily process you run, and how do you measure it?"),
        ),
        "scenarios": (
            ("shipment", "A critical shipment is delayed by three days and a customer order depends on it. What would you do first?"),
            ("deadline", "Two departments need the same team on the same day, and both say their deadline cannot move. What would you do?"),
            ("stock", "A stock count shows a big gap between your records and what is on the shelves. What would you do first?"),
        ),
        "competencies": (
            _comp("improvement", "process improvement", "improv",
                  "Tell me about a time you improved a process that everyone had accepted as normal. What did you change, and what was the result?",
                  "Tell me about a time you improved how something was done in college, an internship or a part-time job. What did you change?"),
            _comp("escalation", "escalation", "escalat",
                  "Tell me about a time you had to escalate a problem to senior management. How did you decide to escalate, and what happened?",
                  "Tell me about a time you had to escalate a problem to a teacher, manager or organiser. Why, and what happened?"),
            _comp("vendor", "vendor management", "let you down",
                  "Tell me about a time a vendor let you down on a commitment. What did you do, and how did it end?",
                  "Tell me about a time a supplier or partner let you down on a college event or project. What did you do?"),
            _comp("planning", "planning under change", "plan",
                  "Tell me about a time your plan fell apart on the day. How did you re-plan, and what was the outcome?",
                  "Tell me about a time your plan for an event or project fell apart. How did you re-plan?"),
        ),
    },
    "finance": {
        "label": "Finance & accounting",
        "track": NON_TECHNICAL,
        "categories": ("Finance Knowledge",) + _NONTECH_CATS,
        "stakeholder": "vendor",
        "knowledge": (
            ("reconcil", "How do you reconcile a bank statement with the books when the balances do not match? Where do you look first?"),
            ("close", "How do you organise your month-end close so nothing is missed and the deadline holds?"),
            ("invoice", "How do you check a vendor invoice before you approve it for payment, and what makes you hold it?"),
        ),
        "scenarios": (
            ("payment", "A vendor calls, angry that their payment is 45 days late, but the invoice is still waiting for approval. What would you do?"),
            ("error", "Two days before the audit, you find an error in last quarter's figures that you posted. What would you do?"),
            ("expense", "A senior manager asks you to book an expense today without the supporting documents. What would you do?"),
        ),
        "competencies": (
            _comp("accuracy", "accuracy under deadline", "deadline",
                  "Tell me about a time you had to deliver accurate numbers under a tight deadline. How did you make sure nothing was wrong?",
                  "Tell me about a time you had to deliver accurate work under a tight deadline in college or an internship. How did you check it?"),
            _comp("controls", "controls and compliance", "control",
                  "Tell me about a time you spotted a gap in a financial control or approval process. What did you do about it?",
                  "Tell me about a time you spotted a mistake in money or records that others had missed, in college, an internship or a part-time job. What did you do?",
                  "mistake"),
            _comp("pushback", "pushing back on seniors", "push back",
                  "Tell me about a time you had to push back on a senior person over a number or a payment. What happened?",
                  "Tell me about a time you had to push back on someone senior in college or an internship. What happened?"),
            _comp("discrepancy", "tracing discrepancies", "discrepanc",
                  "Tell me about a time you traced a discrepancy that took days to explain. How did you find it, and what changed afterwards?",
                  "Tell me about a time you traced a discrepancy in accounts or records in college or an internship. How did you find it?"),
        ),
    },
    "marketing": {
        "label": "Marketing & content",
        "track": NON_TECHNICAL,
        "categories": ("Marketing Knowledge",) + _NONTECH_CATS,
        "stakeholder": "campaign owner",
        "knowledge": (
            ("campaign", "How do you plan a campaign from a brief? What do you decide first: audience, channel or budget, and why?"),
            ("metric", "Which metrics do you look at to decide whether a campaign is working in its first week?"),
            ("audience", "How do you find out what your target audience actually cares about before you write the content?"),
        ),
        "scenarios": (
            ("budget", "Halfway through the month, your paid campaign has spent 70% of its budget with half the expected leads. What would you do?"),
            ("negative", "A post from your brand spreads for the wrong reasons and the comments turn negative. What would you do in the first hour?"),
            ("leads", "Sales says your launch leads are poor quality, but your own numbers look good. What would you do?"),
        ),
        "competencies": (
            _comp("failure", "learning from a failed campaign", "fail",
                  "Tell me about a campaign that failed. What did the numbers tell you, and what did you change next time?",
                  "Tell me about a time something you promoted in college, like an event or a club, failed to get the response you wanted. What did you change?"),
            _comp("budget", "budget trade-offs", "budget",
                  "Tell me about a time you had to cut a marketing budget. What did you keep, what did you drop, and why?",
                  "Tell me about a time you had to run something on a very small budget in college. How did you decide where to spend it?"),
            _comp("alignment", "stakeholder alignment", "disagree",
                  "Tell me about a time you disagreed with sales or leadership on a campaign. How did you resolve it?",
                  "Tell me about a time you disagreed with a team or faculty member about how to promote something. How did you resolve it?"),
            _comp("speed", "quality at short notice", "short notice",
                  "Tell me about a time you had to produce a campaign or content piece at very short notice. How did you keep the quality up?",
                  "Tell me about a time you had to produce content or a poster at very short notice in college. How did you manage?"),
        ),
    },
    "healthcare": {
        "label": "Healthcare, nursing & pharma",
        "track": NON_TECHNICAL,
        "categories": ("Clinical Knowledge", "Situational Judgment", "Behavioural", "Patient Care & Results"),
        "stakeholder": "patient",
        "knowledge": (
            ("priorit", "How do you prioritise when two of your patients deteriorate at the same time on a shift?"),
            ("handover", "What do you include in a shift handover so the next person caring for the patient misses nothing important?"),
            ("infection", "Which infection control steps do you never skip, and how do you make sure others on the ward follow them too?"),
        ),
        "scenarios": (
            ("family", "A patient's family is upset because no doctor has updated them in six hours. What would you do?"),
            ("dose", "A prescribed dose looks much higher than usual, and the doctor who wrote it is in surgery. What would you do?"),
            ("refus", "A patient refuses their medication and says they want to go home now. What would you do?"),
        ),
        "competencies": (
            _comp("safety", "patient safety", "safety",
                  "Tell me about a time you noticed a patient safety risk that others had missed. What did you do, and what happened?",
                  "Tell me about a time during your clinical posting or internship when you noticed a patient safety risk. What did you do?"),
            _comp("prioritisation", "prioritisation", "busy",
                  "Tell me about a very busy shift when you could not do everything at once. How did you decide what came first?",
                  "Tell me about a very busy day in your clinical posting or internship. How did you decide what came first?"),
            _comp("escalation", "escalation", "escalat",
                  "Tell me about a time you had to escalate a concern about a patient to a senior doctor. How did you raise it, and what happened?",
                  "Tell me about a time in your training when you escalated a concern about a patient to a senior. What happened?"),
            _comp("family", "communication with patients and families", "explain",
                  "Tell me about a time you had to explain a delay or difficult news to a patient's family. What did you say, and how did they respond?",
                  "Tell me about a time you had to explain something difficult to a patient or their family during your training. What did you say?"),
        ),
    },
    "education": {
        "label": "Education & training",
        "track": NON_TECHNICAL,
        "categories": ("Teaching Knowledge",) + _NONTECH_CATS,
        "stakeholder": "student",
        "knowledge": (
            ("lesson", "How do you plan a lesson for a class where some students are far ahead and others are behind?"),
            ("understood", "How do you check during a lesson whether students have understood, without waiting for the test?"),
            ("classroom", "Which rules and routines do you set in the first week to manage your classroom?"),
        ),
        "scenarios": (
            ("parent", "A parent emails angrily that their child's low marks are your fault. What would you do?"),
            ("disrupt", "One student keeps disrupting the class, and others have started copying him. What would you do in the next lesson?"),
            ("identical", "You find that two students' assignments are nearly identical. What would you do?"),
        ),
        "competencies": (
            _comp("classroom", "classroom management", "difficult",
                  "Tell me about a time you turned around a difficult class or student. What did you change, and how did you know it worked?",
                  "Tell me about a time during teaching practice, tutoring or college when you handled a difficult group or student. What did you do?"),
            _comp("parents", "parent communication", "parent",
                  "Tell me about a time a conversation with a parent went badly. What did you do next, and how did it end?",
                  "Tell me about a time you had to explain a problem to a parent or guardian during teaching practice or tutoring. How did it go?"),
            _comp("assessment", "assessment and results", "improv",
                  "Tell me about a time your class's results did not improve as you expected. What did you change?",
                  "Tell me about a time students you tutored or taught were not improving. What did you change?"),
            _comp("adapting", "adapting a lesson", "adapt",
                  "Tell me about a time a lesson was not working halfway through. How did you adapt it on the spot?",
                  "Tell me about a time a session you were teaching or presenting was not working. How did you adapt?"),
        ),
    },
    "hospitality": {
        "label": "Hospitality, food & retail",
        "track": NON_TECHNICAL,
        "categories": ("Service Knowledge",) + _NONTECH_CATS,
        "stakeholder": "guest",
        "knowledge": (
            ("rush", "How do you prepare your station or floor before a rush so guests are not kept waiting?"),
            ("hygiene", "Which food safety or hygiene checks do you do every shift, and what would make you stop service?"),
            ("upgrade", "How do you suggest an upgrade or an extra item to a guest without sounding pushy?"),
        ),
        "scenarios": (
            ("complain", "A guest complains loudly that their order is wrong and they have waited forty minutes. What would you do?"),
            ("sick", "Two staff call in sick just before a fully booked evening. What would you do?"),
            ("allerg", "A guest mentions a severe nut allergy after their dish has already been prepared. What would you do?"),
        ),
        "competencies": (
            _comp("recovery", "service recovery", "complaint",
                  "Tell me about a time you turned a guest complaint into a good experience. What did you do?",
                  "Tell me about a time you handled a customer complaint in a part-time job, internship or college event. What did you do?"),
            _comp("pressure", "rush-hour prioritisation", "busier",
                  "Tell me about a time service was far busier than planned. How did you decide what came first, and how did it go?",
                  "Tell me about a time a part-time job or college event was far busier than planned. How did you cope?"),
            _comp("safety", "hygiene and safety", "safety",
                  "Tell me about a time you stopped something because of a safety or hygiene risk. What did you do, and how did others react?",
                  "Tell me about a time you raised a safety or hygiene concern at work, in college or at an event. What happened?"),
            _comp("teamwork", "covering for the team", "team",
                  "Tell me about a time you had to cover for a team member during service. How did you reorganise the work?",
                  "Tell me about a time you had to step in for a team member in a part-time job or college event. What did you do?"),
        ),
    },
    "design": {
        "label": "Design & creative",
        "track": NON_TECHNICAL,
        "categories": ("Design Craft", "Situational Judgment", "Behavioural", "Experience & Results"),
        "stakeholder": "client",
        "knowledge": (
            ("brief", "How do you turn a vague client brief into a clear direction before you start designing?"),
            ("feedback", "How do you decide which feedback to act on when the client, your lead and users disagree?"),
            ("users", "How do you check that a design works for real users before you call it final?"),
        ),
        "scenarios": (
            ("deadline", "The client asks for a major change two days before the deadline. What would you do?"),
            ("brand", "A client insists on a colour and layout that break their own brand guidelines. What would you do?"),
            ("approved", "The final files go out tomorrow, and you spot an error in a design the client already approved. What would you do?"),
        ),
        "competencies": (
            _comp("critique", "taking critique", "critic",
                  "Tell me about a time your work got harsh criticism. What did you change, and what did you defend?",
                  "Tell me about a time your college or internship work got harsh criticism. What did you change?"),
            _comp("conflicting", "prioritising feedback", "conflicting",
                  "Tell me about a time you got conflicting feedback from two people. How did you decide, and what happened?",
                  "Tell me about a time in college or an internship when you got conflicting feedback from two people. How did you decide?"),
            _comp("results", "design results", "result",
                  "Tell me about a design you are proud of because of its result, not its looks. How did you measure the result?",
                  "Tell me about a college or internship project where your design changed a result. How did you know?"),
            _comp("collaboration", "collaboration", "collaborat",
                  "Tell me about a time you had to collaborate closely with people who saw the design differently. How did it go?",
                  "Tell me about a time you collaborated on a design project with people who saw it differently. How did it go?"),
        ),
    },
    "general_professional": {
        "label": "General professional",
        "track": NON_TECHNICAL,
        "categories": ("Role Knowledge",) + _NONTECH_CATS,
        "stakeholder": "the person you were helping",
        "knowledge": (
            ("priorit", "How do you plan and prioritise your work when everything on your list looks urgent?"),
            ("check", "How do you check your own work before it goes to your manager or a client?"),
            ("learn", "How do you learn a new task or tool quickly when nobody has time to train you?"),
        ),
        "scenarios": (
            ("deadline", "Your manager gives you an urgent new task while you are already at risk of missing another deadline. What would you do?"),
            ("mistake", "You realise you made a mistake in work that was already sent to a client. What would you do?"),
            ("teammate", "A teammate keeps missing their part of a shared task, and the deadline is close. What would you do?"),
        ),
        "competencies": (
            _comp("ownership", "ownership", "ownership",
                  "Tell me about a time you took ownership of a problem that was not strictly your job. What did you do, and what happened?",
                  "Tell me about a time you took ownership of a problem in college, an internship or a part-time job. What did you do?"),
            _comp("prioritisation", "prioritisation", "priorit",
                  "Tell me about a time you had too much to do and had to prioritise. What did you drop, and how did it turn out?",
                  "Tell me about a time in college or an internship when you had too much to do and had to prioritise. What did you drop?"),
            _comp("communication", "clear communication", "explain",
                  "Tell me about a time you had to explain something complicated to someone who was confused or upset. How did you do it?",
                  "Tell me about a time you had to explain something complicated to a classmate, customer or colleague. How did you do it?"),
            _comp("learning", "learning fast", "learn",
                  "Tell me about a time you had to learn something new very quickly for work. How did you go about it, and how did it go?",
                  "Tell me about a time you had to learn something new very quickly in college or an internship. How did you go about it?"),
        ),
    },
}

# Generic frames (family-agnostic, filled with resume anchors). Three variants per question type.
OPENING_FRAMES = (
    "At {place}, what did you personally own{as_title}, and what changed because of your work?",
    "Walk me through a typical week at {place}{as_title}. Which part of it was fully your responsibility?",
    "At {place}, which of your responsibilities{as_title} mattered most to the business, and how did you handle it?",
)
OPENING_ACTIVITY_FRAMES = (
    "In {activity}, what did you personally take charge of, and what came out of it?",
    "Walk me through your role in {activity}. Which part was fully your responsibility?",
    "What is one thing you organised or delivered in {activity}, and how did it turn out?",
)
OPENING_BARE_FRAMES = (
    "Which piece of work on your resume was most fully your own, and what came out of it?",
    "Walk me through the most recent work or project on your resume. Which part were you personally responsible for?",
    "Pick one responsibility from your resume that you handled end to end. How did you handle it, and how did it turn out?",
)
RESULT_METRIC_FRAMES = (
    "Your resume mentions {metric}. What was your own part in that, and how did you know it had worked?",
    "You list {metric}. What did you personally change to make that happen, and what got in the way?",
    "Take {metric}. Which of your own actions moved that number most, and what would you do differently now?",
)
RESULT_PLACE_FRAMES = (
    "At {place}, what is one result you can point to from your own work, and how did you measure it?",
    "What changed at {place} because of something you did, and how did you know it had changed?",
    "Think of your best result at {place}. What exactly did you do to get it?",
)
RESULT_BARE_FRAMES = (
    "What is one result from your work or studies that you can measure, and what did you do to get it?",
    "Which outcome on your resume are you proudest of, and what was your own part in it?",
    "Tell me about a result you delivered recently. What did you do, and how did you know it had worked?",
)
FOLLOWUP_FRAMES: dict[str, tuple[str, ...]] = {
    "no_result": (
        "You mentioned {hook}. What was the final result, and how did you know?",
        "Going back to {hook}: how did it end, and what changed because of what you did?",
        "On {hook}, what happened in the end, and is there a number or outcome you can point to?",
    ),
    "no_own_action": (
        "You mentioned {hook}. What did you personally do there, step by step?",
        "On {hook}, which decision was yours alone, and why did you make it?",
        "Going back to {hook}: if I asked your manager, what would they say you did?",
    ),
    "hypothetical": (
        "You described what you would do about {hook}. Has that actually happened to you? What did you do then?",
        "On {hook}, you answered in general terms. Can you give me one real case and what you did?",
        "Going back to {hook}: when did you last face that for real, and how did it go?",
    ),
    "shallow": (
        "Let me come back to {hook}. Can you walk me through what happened, what you did, and the result?",
        "Going back to {hook}, can you give me one concrete example with the outcome?",
        "On {hook}, what exactly did you do first, and what happened next?",
    ),
    "ok": (
        "On {hook}, looking back, what would you do differently next time, and why?",
        "Going back to {hook}: who disagreed with your approach, and how did you bring them round?",
        "On {hook}, what was the hardest part, and how did you get past it?",
    ),
}

# Words that must never appear in a non-technical question (the T4 leak: "architectural differences", "debug those
# process gaps", "Technical Trade-offs").
_ENGINEERING_VOCAB_RE = re.compile(
    r"\barchitect\w*|\bdebug\w*|\btechnical\w*|\btech stack\b|\btechnology stack\b|\bfull[- ]stack\b|\bsoftware stack\b"
    r"|\bscalab\w*|\bscaling\b|\bdeploy\w*|\bAPIs?\b|\bcodebase\b|\bcoding\b|\bsource code\b|\bsystem design\b"
    r"|\blatency\b|\brefactor\w*|\balgorithm\w*|\bmicroservices?\b|\bbackend\b|\bfrontend\b|\bdatabase\w*"
    r"|\bSQL\b|\bquery\b|\bqueries\b|\bframeworks?\b|\bprogramming\b|\brepository\b|\bgit\b|\bbug\b|\bbugs\b"
    r"|\bserver\b|\bservers\b|\bstack\b|\bthroughput\b|\bimplementation details\b",
    re.I,
)
# "code" is banned, but "dress code", "code of conduct", "promo code", "postal code", "billing code" are ordinary words.
_CODE_RE = re.compile(r"\bcode[sd]?\b", re.I)
_CODE_OK_BEFORE = ("dress", "postal", "zip", "promo", "discount", "coupon", "billing", "icd", "hsn", "tax", "colour",
                   "color", "bar", "qr", "pin", "area", "emergency", "blue", "red", "booking")


def banned_engineering_terms(text: str, family: str = "") -> list[str]:
    """Engineering words found in a question meant for a non-technical family. Empty for technical families."""
    if family in TECHNICAL_FAMILIES:
        return []
    raw = str(text or "")
    found = [m.group(0) for m in _ENGINEERING_VOCAB_RE.finditer(raw)]
    if family == "design":
        # Designers may hear "stack" ("design stack") rarely; keep the rest of the list.
        found = [f for f in found if f.lower() != "stack"]
    for m in _CODE_RE.finditer(raw):
        before = raw[: m.start()].strip().split()
        after = raw[m.end():].strip().lower()
        prev = before[-1].lower().strip(",.;:") if before else ""
        if prev in _CODE_OK_BEFORE or after.startswith("of conduct") or after.startswith("of ethics"):
            continue
        found.append(m.group(0))
    return found


STAR_OPENER_RE = re.compile(
    r"^\s*(?:(?:so|okay|ok|now|next|great|thanks)[,.]?\s+)?(?:can you\s+|could you\s+|please\s+)?"
    r"(?:tell me about (?:a|an|one|the last|your) |describe (?:a|an|one|the last) |give me (?:an|one) example"
    r"|walk me through (?:a|an|one) (?:time|situation|case|moment)|share (?:a|an|one) |think (?:of|about) (?:a|an|one) "
    r"|recall (?:a|an|one) )",
    re.I,
)
HYPOTHETICAL_RE = re.compile(
    r"\bwhat would you\b|\bhow would you\b|\bwhat will you\b|\bwhat do you do\b|\bwhat would be your\b|\bwhere would you\b"
    r"|\bwhat would your first\b|\bwhich would you\b|\bwhat should you\b",
    re.I,
)
DEFINITION_RE = re.compile(r"^\s*(?:what is|what are|what's|define|what does .{1,40} mean|explain the (?:concept|meaning))\b", re.I)


# --------------------------------------------------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------------------------------------------------


def _qm():
    from app.services import interview_question_model as qm

    return qm


def _compile_tables() -> dict[str, dict[str, list[str]]]:
    qm = _qm()
    out: dict[str, dict[str, list[str]]] = {}
    for fam, sig in _FAMILY_SIGNALS.items():
        out[fam] = {k: qm._phrases(tuple(v)) for k, v in sig.items()}
    return out


_TABLES: dict[str, dict[str, list[str]]] | None = None


def _tables() -> dict[str, dict[str, list[str]]]:
    global _TABLES
    if _TABLES is None:
        _TABLES = _compile_tables()
    return _TABLES


def _title_families(raw_title: str) -> dict[str, int]:
    """Family -> length of the longest title phrase matched in one title (longest phrase wins across families)."""
    qm = _qm()
    norm = qm.normalize_evidence(raw_title)
    if not norm:
        return {}
    stripped = qm._strip_seniority(norm)
    best: dict[str, int] = {}
    for fam, tab in _tables().items():
        for phrase in tab["titles"]:
            if qm._has_phrase(norm, phrase) or qm._has_phrase(stripped, phrase):
                best[fam] = max(best.get(fam, 0), len(phrase))
                break
    if not best:
        return {}
    top = max(best.values())
    # Keep only the families whose match is as specific as the best one ("system administrator" beats "administrator").
    return {fam: n for fam, n in best.items() if n == top}


def _score_text(norm_text: str, scores: dict[str, int], *, title_weight: int, term_weight: int, edu: bool = False) -> None:
    qm = _qm()
    if not norm_text:
        return
    for fam, tab in _tables().items():
        if title_weight:
            hits = qm._find_phrases(norm_text, tab["titles"])
            scores[fam] = scores.get(fam, 0) + title_weight * min(len(hits), 2)
        if term_weight:
            hits = qm._find_phrases(norm_text, tab["terms"])
            scores[fam] = scores.get(fam, 0) + term_weight * min(len(hits), 6)
        if edu:
            hits = qm._find_phrases(norm_text, tab["education"])
            scores[fam] = scores.get(fam, 0) + 2 * min(len(hits), 2)


def _ranked(scores: dict[str, int]) -> list[tuple[str, int]]:
    return sorted(((f, s) for f, s in scores.items() if s > 0), key=lambda x: (-x[1], ALL_FAMILIES.index(x[0])))


def _resume_scores(profile: dict, resume_text: str) -> tuple[dict[str, int], set[str]]:
    """Scores per family from resume evidence, and the families that matched a title field."""
    qm = _qm()
    scores: dict[str, int] = {}
    titled: set[str] = set()
    deciding = qm.deciding_title(profile)
    seen_titles: list[str] = []
    if deciding:
        seen_titles.append(deciding)
        for fam in _title_families(deciding):
            scores[fam] = scores.get(fam, 0) + 5
            titled.add(fam)
    for raw in qm._title_strings(profile):
        if raw in seen_titles:
            continue
        seen_titles.append(raw)
        for fam in _title_families(raw):
            scores[fam] = scores.get(fam, 0) + 3
            titled.add(fam)
    for job in qm._jobs(profile):
        title = qm._job_title(job)
        if title and title not in seen_titles and qm._is_internship(job):
            for fam in _title_families(title):
                scores[fam] = scores.get(fam, 0) + 2
                titled.add(fam)
    blob_parts = [qm._flatten(s) for s in (profile.get("skills") or [])]
    for job in qm._jobs(profile):
        blob_parts.append(qm._flatten(job.get("responsibilities") or job.get("description")))
    blob_parts.append(qm._flatten(profile.get("achievements")))
    blob_parts.append(qm._flatten(profile.get("summary")))
    text = " ".join([*blob_parts, str(resume_text or "")[:8000], str(profile.get("resumeText") or "")[:8000]])
    norm = qm.normalize_evidence(text)
    _score_text(norm, scores, title_weight=2, term_weight=1)
    edu = qm.normalize_evidence(qm._education_blob(profile) + " " + str(profile.get("resumeText") or "")[:3000] + " " + str(resume_text or "")[:3000])
    _score_text(edu, scores, title_weight=0, term_weight=0, edu=True)
    return scores, titled


def _job_scores(job_title: str, jd_text: str) -> tuple[dict[str, int], set[str]]:
    qm = _qm()
    scores: dict[str, int] = {}
    titled: set[str] = set()
    if job_title:
        for fam in _title_families(job_title):
            scores[fam] = scores.get(fam, 0) + 6
            titled.add(fam)
    if jd_text:
        norm = qm.normalize_evidence(str(jd_text)[:6000])
        _score_text(norm, scores, title_weight=2, term_weight=1)
    return scores, titled


def _make(family: str, confidence: str, reason: str, source: str, scores: dict[str, int], track: str | None = None) -> RoleFamily:
    spec = ROLE_FAMILIES.get(family) or ROLE_FAMILIES[DEFAULT_FAMILY]
    return RoleFamily(
        family=family,
        track=track or spec["track"],
        confidence=confidence,
        reason=reason[:80],
        source=source,
        label=spec["label"],
        scores={k: v for k, v in scores.items() if v > 0},
    )


def _best_in_track(ranked: list[tuple[str, int]], track: str) -> tuple[str, int] | None:
    for fam, score in ranked:
        if ROLE_FAMILIES[fam]["track"] == track and fam != DEFAULT_FAMILY:
            return fam, score
    return None


def _resume_family(profile: dict, resume_text: str) -> RoleFamily:
    qm = _qm()
    scores, titled = _resume_scores(profile, resume_text)
    ranked = _ranked(scores)
    base = qm._classify_resume_core({**profile, "resumeText": profile.get("resumeText") or resume_text or ""})
    base_track = base["questionModel"]
    base_conf = base["questionModelConfidence"]
    top = ranked[0] if ranked else None

    if base_conf in ("high", "medium"):
        # The resume classifier is confident about technical vs not; pick the best family on that side.
        pick = _best_in_track(ranked, base_track)
        if base_track == NON_TECHNICAL and base["questionModelReason"] in ("mixed_designer",) and "design" in scores:
            pick = ("design", scores["design"])
        if pick and pick[1] >= 2:
            conf = "high" if pick[0] in titled and base_conf == "high" else "medium"
            return _make(pick[0], conf, f"resume_{pick[0]}_{base['questionModelReason']}", "resume", scores, base_track)
        if base_track == TECHNICAL:
            return _make("software", base_conf, f"resume_software_{base['questionModelReason']}", "resume", scores, TECHNICAL)
        return _make(DEFAULT_FAMILY, base_conf, f"resume_general_{base['questionModelReason']}", "resume", scores, NON_TECHNICAL)

    # Low-confidence / thin resume: the family tables decide; ambiguity means general_professional (non-technical).
    if not top or top[1] < 3:
        if base_track == NON_TECHNICAL:
            return _make(DEFAULT_FAMILY, "low", base["questionModelReason"], "default", scores)
        return _make(DEFAULT_FAMILY, "low", "thin_default_general", "default", scores)
    second = ranked[1][1] if len(ranked) > 1 else 0
    if top[0] not in titled and top[1] - second < 2:
        return _make(DEFAULT_FAMILY, "low", "ambiguous_default_general", "default", scores)
    conf = "medium" if top[0] in titled or top[1] >= 5 else "low"
    return _make(top[0], conf, f"resume_family_{top[0]}", "resume", scores)


def detect_role_family(
    resume_text: str = "",
    profile: dict | None = None,
    job_title: str | None = None,
    jd_text: str | None = None,
) -> RoleFamily:
    """Which job family this interview is for.

    Job signals (job title, then the JD) win when present; the resume only breaks a tie on an ambiguous job. Without a
    job, the resume decides. Thin or ambiguous evidence gives general_professional (non-technical)."""
    profile = profile if isinstance(profile, dict) else {}
    profile = {
        k: v
        for k, v in profile.items()
        if k not in {"questionModel", "questionModelConfidence", "questionModelReason", "roleTrack", "jobDescription", "jobTitle", "roleFamily"}
    }
    job_title = str(job_title or "").strip()
    jd_text = str(jd_text or "").strip()
    if job_title or jd_text:
        jscores, jtitled = _job_scores(job_title, jd_text)
        jranked = _ranked(jscores)
        if jranked:
            top_f, top_s = jranked[0]
            second_s = jranked[1][1] if len(jranked) > 1 else 0
            if top_f in jtitled and (len(jtitled) == 1 or top_s - second_s >= 2):
                return _make(top_f, "high", f"job_title_{top_f}", "job", jscores)
            if top_s >= 4 and top_s - second_s >= 2:
                return _make(top_f, "medium", f"job_description_{top_f}", "job", jscores)
            # Ambiguous job: the resume breaks the tie among the job's leading families.
            rscores, _ = _resume_scores(profile, resume_text)
            contenders = [f for f, s in jranked if s >= top_s - 1][:3]
            if top_s >= 2:
                pick = max(contenders, key=lambda f: (rscores.get(f, 0), jscores.get(f, 0)))
                merged = {f: jscores.get(f, 0) for f in contenders}
                return _make(pick, "low", f"job_ambiguous_resume_tiebreak_{pick}", "job", merged)
    return _resume_family(profile, resume_text)


def choose_question_model(
    profile: dict | None,
    *,
    job_title: str | None = None,
    job_description: str | None = None,
    resume_text: str = "",
) -> dict[str, Any]:
    """Drop-in for `classify_question_model` at interview start, with the job allowed to vote.

    Returns questionModel / questionModelConfidence / questionModelReason (same keys as today) plus roleFamily,
    roleFamilyLabel and roleFamilySource. Pass job_title / job_description only for job-linked interviews."""
    fam = detect_role_family(resume_text, profile, job_title=job_title, jd_text=job_description)
    return {
        "questionModel": fam.track,
        "questionModelConfidence": fam.confidence,
        "questionModelReason": fam.reason[:80],
        "roleFamily": fam.family,
        "roleFamilyLabel": fam.label,
        "roleFamilySource": fam.source,
    }


# --------------------------------------------------------------------------------------------------------------------
# Spec accessors
# --------------------------------------------------------------------------------------------------------------------


def family_spec(family: str | None) -> dict[str, Any]:
    fam = family if family in ROLE_FAMILIES else DEFAULT_FAMILY
    spec = ROLE_FAMILIES[fam]
    if spec["track"] == TECHNICAL:
        # The non-technical model never runs with a technical family; borrow the general data for safety.
        merged = dict(ROLE_FAMILIES[DEFAULT_FAMILY])
        merged.update({k: v for k, v in spec.items() if k in ("label", "track", "categories", "stakeholder")})
        merged["key"] = fam
        return merged
    return {**spec, "key": fam}


def family_categories(family: str | None) -> tuple[str, ...]:
    return tuple(ROLE_FAMILIES.get(family or "", ROLE_FAMILIES[DEFAULT_FAMILY])["categories"])


def seed_index(*parts: Any) -> int:
    digest = hashlib.sha1("|".join(str(p or "") for p in parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def pick_competencies(family: str | None, seed: Any = "", n: int = 2) -> list[dict[str, str]]:
    """n distinct competencies, drawn without replacement and seeded so a retake can get a different pair."""
    comps = list(family_spec(family)["competencies"])
    if not comps:
        return []
    start = seed_index("comp", family, seed) % len(comps)
    step = 1 if len(comps) < 3 else (1 + seed_index("step", seed) % (len(comps) - 1))
    picked: list[dict[str, str]] = []
    i = start
    while len(picked) < min(n, len(comps)):
        c = comps[i % len(comps)]
        if c not in picked:
            picked.append(c)
        else:
            i += 1
            continue
        i += step
    return picked


def pick_item(items: tuple | list, seed: Any, salt: str) -> int:
    return seed_index(salt, seed) % len(items) if items else 0


# --------------------------------------------------------------------------------------------------------------------
# Deterministic follow-up gap analysis over earlier answers (offline; used by the live follow-up turn).
# --------------------------------------------------------------------------------------------------------------------

_OWN_ACTION_RE = re.compile(
    r"\bI\s+(?:\w+ed|told|took|made|sent|met|wrote|spoke|ran|led|built|gave|went|set|got|put|kept|chose|found|drove|"
    r"called|asked|checked|handled|decided|escalated|negotiated|explained|trained|planned|organised|organized)\b",
    re.I,
)
_RESULT_RE = re.compile(
    r"\d|\b(result|resulted|outcome|in the end|finally|ended|closed|signed|saved|reduced|increased|improved|won|lost|"
    r"missed|achieved|delivered|recovered|resolved|renewed|retained|hired|stabilised|stabilized|discharged|passed)\b",
    re.I,
)
_HYPO_RE = re.compile(r"\bI would\b|\bI'd\b|\bI will\b|\bwe would\b|\bgenerally\b|\busually I\b|\bI always\b", re.I)
_STOP = frozenset(
    "the a an and or but so to of in on at for with from by as is was were are be been it this that these those i my me "
    "we our you your they them their he she his her what which who when how why then there here very really just also "
    "about would could should will can did do does done have has had not no yes".split()
)
_GAP_PRIORITY = {"empty": 0, "hypothetical": 1, "no_own_action": 2, "no_result": 3, "shallow": 4, "ok": 9}


def _hook(answer: str, question: str) -> str:
    """A short noun phrase from the answer to point back at ('the Acme renewal'); falls back to the question topic."""
    words = re.findall(r"[A-Za-z][A-Za-z'&-]+", answer or "")
    caps = [w for i, w in enumerate(words) if w[0].isupper() and i > 0 and w.lower() not in _STOP and len(w) > 2]
    if caps:
        return caps[0]
    content = [w for w in words if w.lower() not in _STOP and len(w) > 4]
    if content:
        return " ".join(content[:2]).lower()
    q_words = [w for w in re.findall(r"[A-Za-z]+", question or "") if w.lower() not in _STOP and len(w) > 4]
    return " ".join(q_words[:2]).lower() or "that example"


def answer_gap(question_text: str, answer: str) -> dict[str, str]:
    text = str(answer or "").strip()
    n = len(text.split())
    if n == 0:
        gap = "empty"
    elif _HYPO_RE.search(text) and not _OWN_ACTION_RE.search(text):
        gap = "hypothetical"
    elif not _OWN_ACTION_RE.search(text):
        gap = "no_own_action"
    elif not _RESULT_RE.search(text):
        gap = "no_result"
    elif n < 30:
        gap = "shallow"
    else:
        gap = "ok"
    return {"gap": gap, "hook": _hook(text, question_text)}


def biggest_gap(history: list | None) -> dict[str, Any] | None:
    """The answered turn with the most serious gap (ties: the most recent). Skips opening and closing turns."""
    best: dict[str, Any] | None = None
    for idx, item in enumerate(history or []):
        if not isinstance(item, dict):
            continue
        q = item.get("question")
        q_text = str((q or {}).get("text") if isinstance(q, dict) else q or "")
        focus = str((q or {}).get("focus") or "") if isinstance(q, dict) else ""
        if "closing" in focus or "opening" in focus or not q_text:
            continue
        info = answer_gap(q_text, str(item.get("answer") or ""))
        rank = _GAP_PRIORITY.get(info["gap"], 9)
        if best is None or rank <= best["rank"]:
            best = {"turn": idx + 1, "question": q_text, "rank": rank, **info}
    return best


# --------------------------------------------------------------------------------------------------------------------
# Scoring / report wording for non-technical interviews (consumed by the report generator; no technical wording).
# --------------------------------------------------------------------------------------------------------------------

NONTECH_SCORING_DIMENSIONS = (
    {"id": "jobKnowledge", "label": "Job knowledge", "rubric": "correctness", "kinds": ("knowledge",)},
    {"id": "situationHandling", "label": "Situation handling", "rubric": "correctness", "kinds": ("scenario", "star", "followup", "opening", "result")},
    {"id": "ownershipResult", "label": "Ownership & result", "rubric": "depth", "kinds": ()},
    {"id": "communication", "label": "Communication", "rubric": "communication", "kinds": ()},
)


def nontech_rubric_labels(question_kind: str = "") -> dict[str, str]:
    """Rubric id -> display label for one non-technical question. `correctness` reads as Job knowledge on a
    job-knowledge turn and as Situation handling elsewhere; there is never a "technical accuracy" label."""
    kind = str(question_kind or "").lower()
    return {
        "correctness": "Job knowledge" if kind == "knowledge" else "Situation handling",
        "depth": "Ownership & result",
        "communication": "Communication",
        "roleSkillsFit": "Job knowledge",
    }


def nontech_dimension_summary(per_question: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Average the per-question rubric scores into the four non-technical dimensions.

    per_question items: {"questionKind": str, "rubrics": {"correctness": int, "depth": int, "communication": int}}.
    A dimension with no evidence is returned with score None so the report can hide it instead of showing 0."""
    buckets: dict[str, list[float]] = {d["id"]: [] for d in NONTECH_SCORING_DIMENSIONS}
    for item in per_question or []:
        kind = str(item.get("questionKind") or "").lower()
        rubrics = item.get("rubrics") or {}
        corr = rubrics.get("correctness")
        if isinstance(corr, (int, float)):
            buckets["jobKnowledge" if kind == "knowledge" else "situationHandling"].append(float(corr))
        if isinstance(rubrics.get("depth"), (int, float)):
            buckets["ownershipResult"].append(float(rubrics["depth"]))
        if isinstance(rubrics.get("communication"), (int, float)):
            buckets["communication"].append(float(rubrics["communication"]))
    out = []
    for d in NONTECH_SCORING_DIMENSIONS:
        vals = buckets[d["id"]]
        out.append({"id": d["id"], "label": d["label"], "score": round(sum(vals) / len(vals)) if vals else None})
    return out


_FAMILY_KNOWLEDGE_NOUN = {
    "sales": "sales process",
    "support": "support process",
    "hr": "HR practice",
    "operations": "operations practice",
    "finance": "accounting practice",
    "marketing": "marketing practice",
    "healthcare": "clinical practice",
    "education": "teaching practice",
    "hospitality": "service standards",
    "design": "design process",
    "general_professional": "day-to-day work",
}


def family_report_phrases(family: str | None) -> dict[str, Any]:
    """Report and coaching wording for a non-technical family. No "technical accuracy", no "tech stack"."""
    spec = family_spec(family)
    fam = spec["key"]
    noun = _FAMILY_KNOWLEDGE_NOUN.get(fam, "day-to-day work")
    stakeholder = spec.get("stakeholder") or "the people you work with"
    return {
        "family": fam,
        "familyLabel": spec["label"],
        "interviewTitle": f"{spec['label']} interview",
        "dimensionLabels": {d["id"]: d["label"] for d in NONTECH_SCORING_DIMENSIONS},
        "rubricLabels": nontech_rubric_labels(),
        "improvements": {
            "jobKnowledge": f"Show how you actually do the job: name the steps, checks and rules you follow in {noun}.",
            "situationHandling": "Answer the exact situation asked: say what you would do first, and why.",
            "ownershipResult": "Say what YOU did (\"I called…\", \"I decided…\") and finish with the result or number.",
            "communication": "Use a clear order: the situation, what you did, and how it ended.",
        },
        "strengths": {
            "jobKnowledge": f"Clear, practical grasp of {noun}.",
            "situationHandling": f"Handled the situations calmly, with the {stakeholder} in mind.",
            "ownershipResult": "Took ownership and backed answers with concrete results.",
            "communication": "Structured, easy-to-follow answers.",
        },
    }
