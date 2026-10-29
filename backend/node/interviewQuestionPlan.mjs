import { projectTechnicalQuestion } from './projectInterview.mjs'
import { getSkillsForRole } from './roleSkillStore.mjs'
import { selectFresherConcept, selectFresherSkills } from './fresherConcepts.mjs'
const clean = (s) => String(s ?? '').trim();
const unique = (values) => [...new Set(values.filter(Boolean))];
const spokenLead = (first, text) => first && first !== 'there' ? `${first}, ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
export const FRESHER_INTERVIEW_TURN_COUNT = 6;
export const MAX_ROLE_SKILLS = 3;
export const EXPERIENCE_PROJECT_TURNS = 2;
export const EXPERIENCED_FALLBACK_TURNS = 1;
export const EXPERIENCED_CLOSING_TURNS = 1;
export const EXPERIENCED_INTERVIEW_TURN_COUNT =
    1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS + EXPERIENCED_FALLBACK_TURNS + EXPERIENCED_CLOSING_TURNS;
const OPENING_GREETINGS = [
    'Thanks for joining today — I am Ava, and I will guide you through this interview.',
    'Good to meet you — I am Ava. We will keep this focused on your real work experience.',
    'Hello — I am Ava, your interviewer for this session. Let us begin with your background.',
    'Welcome — I am Ava. I will ask about your experience and skills in a conversational way.',
];
const CLOSING_LINES = [
    (role) => `Thank you for your time today — it was helpful hearing about your path toward ${role}. We will wrap up here; wishing you the best with your next steps.`,
    (role) => `I appreciate the detail you shared in this session. That is all from my side for this ${role} conversation — take care and good luck.`,
    (role) => `Thanks for walking me through your experience. We are done with questions for this ${role} interview — hope the rest of your day goes well.`,
    (role) => `Great speaking with you. This concludes our ${role} interview — thank you again for your thoughtful answers.`,
];
function hashString(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
const ROLE_SKILL_LIBRARY = [
    { test: /python.*(?:developer|engineer)|django|fastapi/i, skills: ['Python', 'SQL'] },
    { test: /java\b.*(?:developer|engineer)|spring/i, skills: ['Java', 'SQL'] },
    { test: /data analyst|business analyst/i, skills: ['SQL', 'Statistics'] },
    { test: /nurs|healthcare/i, skills: ['Patient assessment', 'Infection prevention'] },
    { test: /accountant|finance/i, skills: ['Financial accounting', 'Financial analysis'] },
    { test: /sales|business development/i, skills: ['Customer discovery', 'Negotiation'] },
    { test: /recruit|human resources|talent acquisition/i, skills: ['Candidate assessment', 'Structured interviewing'] },
    { test: /mechanical|manufacturing/i, skills: ['Engineering mechanics', 'Quality control'] },
    { test: /civil|construction/i, skills: ['Structural mechanics', 'Construction materials'] },
    { test: /design|ux|ui\b/i, skills: ['User research', 'Interaction design'] },
    {
        test: /\bfull[\s-]?stack|mern|mean\b/i,
        skills: ['React.js', 'Node.js', 'TypeScript', 'REST APIs', 'SQL', 'MongoDB', 'System Design', 'Git'],
    },
    {
        test: /\bfront[\s-]?end|frontend\b/i,
        skills: ['React.js', 'TypeScript', 'JavaScript', 'HTML5 & CSS3', 'TailwindCSS', 'Next.js', 'Redux', 'REST APIs'],
    },
    {
        test: /\bback[\s-]?end|backend\b/i,
        skills: ['Node.js', 'Python', 'Java', 'PostgreSQL', 'REST APIs', 'System Design', 'Docker', 'Redis'],
    },
    {
        test: /\bsoftware engineer|software developer\b/i,
        skills: ['JavaScript', 'Python', 'Git', 'SQL', 'REST APIs', 'System Design', 'Agile', 'Problem Solving'],
    },
    {
        test: /\bdata scientist|machine learning|ml engineer|ai engineer\b/i,
        skills: ['Python', 'AI / ML', 'SQL', 'Statistics', 'Data Structures', 'TensorFlow', 'Pandas', 'Communication'],
    },
    {
        test: /\bdevops|sre|platform engineer\b/i,
        skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD', 'Linux', 'Terraform', 'Monitoring', 'Git'],
    },
    {
        test: /\bmobile|android|ios|flutter\b/i,
        skills: ['Flutter', 'React Native', 'Kotlin', 'Swift', 'REST APIs', 'Git', 'UI/UX', 'Firebase'],
    },
    {
        test: /\bqa|quality assurance|test engineer\b/i,
        skills: ['Selenium', 'Test Automation', 'API Testing', 'Agile', 'Git', 'SQL', 'Communication', 'Problem Solving'],
    },
    {
        test: /\bproduct manager|product owner\b/i,
        skills: ['Agile', 'Communication', 'Leadership', 'Analytics', 'Roadmapping', 'Stakeholder Management', 'SQL', 'Problem Solving'],
    },
];
export function resolveExactInterviewRole(profile, roleOverride = '') {
    return clean(profile?.currentRole) || clean(profile?.workExperiences?.find(w => w.jobTitle)?.jobTitle) || clean(roleOverride) || 'Software Engineer';
}
export function isPlanFresher(profile, ctx, level = '') {
    const experience = clean(profile?.totalExperience) || clean(level);
    if (/fresher|student|no (?:work )?experience|^0(?:\s*(?:years?|months?))?$|less than 1/i.test(experience))
        return true;
    if ((ctx.jobs || []).length || profile?.workExperiences?.some(w => w.company || w.jobTitle))
        return false;
    const years = Number.parseFloat(experience);
    return !Number.isFinite(years) || years === 0;
}
const ROLE_RESUME_SKILL_PATTERNS = [
    { role: /data engineer|big data engineer|analytics engineer/i, skill: /pyspark|spark|airflow|kafka|dbt|snowflake|python|^sql$|etl|pipeline|warehouse/i },
    { role: /machine learning|ml engineer|data scientist|ai engineer|mlops/i, skill: /python|tensorflow|pytorch|sklearn|scikit|pandas|sql|feature|model|mlops|docker/i },
    { role: /devops|sre|platform engineer|cloud engineer/i, skill: /docker|kubernetes|terraform|aws|azure|gcp|ci\/cd|linux|monitoring/i },
    { role: /frontend|react|ui developer|web developer/i, skill: /react|typescript|javascript|css|html|next|redux|vue|angular/i },
    { role: /backend|api developer|java developer|python developer/i, skill: /node|python|java|postgres|mysql|rest|api|spring|django|redis/i },
];
function skillMatchesPattern(skill, pattern) {
    return pattern.test(clean(skill));
}
function resumeSkillsRelevantToRole(exactRole, ctx) {
    const role = clean(exactRole);
    const entry = ROLE_RESUME_SKILL_PATTERNS.find((e) => e.role.test(role));
    if (!entry)
        return [];
    return unique((ctx.skills || []).map(clean).filter((s) => s && skillMatchesPattern(s, entry.skill)));
}
export function parseExperienceYears(level = '', profile = null) {
    const raw = clean(profile?.totalExperience) || clean(level)
  if (/fresher|student|no (?:work )?experience|less than 1/i.test(raw)) return 0
  const band = raw.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/)
  if (band) return (Number(band[1]) + Number(band[2])) / 2 / (/month/i.test(raw) ? 12 : 1)
  const years = raw.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i)
  const months = raw.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)/i)
  if (years || months) return Number(years?.[1] || 0) + Number(months?.[1] || 0) / 12
  const n = Number.parseFloat(raw)
  if (Number.isFinite(n)) return Math.max(0, n)
  if (/senior|lead|principal|architect/i.test(raw)) return 8
  return 0
}
export function experienceTierFromYears(years, _level = '') {
    if (years >= 5)
        return 'senior';
    if (years >= 2)
        return 'mid';
    return 'junior';
}
export function jsonRoleSkillsForInterview(exactRole, roleSkillsFromStore = null) {
    const fromStore = Array.isArray(roleSkillsFromStore) ? roleSkillsFromStore.map(clean).filter(Boolean) : [];
    if (fromStore.length)
        return fromStore.slice(0, MAX_ROLE_SKILLS);
    const fromLibrary = getSkillsForRole(exactRole);
    if (fromLibrary?.length)
        return fromLibrary.slice(0, MAX_ROLE_SKILLS);
    return [`${exactRole} fundamentals`, `${exactRole} quality and risk principles`, 'Problem Solving'];
}
export function recommendTopSkillsForRole(exactRole, ctx, roleSkillsFromStore = null, options = {}) {
    const jsonOnly = options.jsonOnly === true;
    const fromStore = Array.isArray(roleSkillsFromStore) ? roleSkillsFromStore.map(clean).filter(Boolean) : [];
    if (fromStore.length && jsonOnly)
        return fromStore.slice(0, MAX_ROLE_SKILLS);
    const defaults = fromStore.length
        ? fromStore
        : ROLE_SKILL_LIBRARY.find(entry => entry.test.test(exactRole))?.skills;
    if (!defaults?.length)
        return [`${exactRole} fundamentals`, `${exactRole} quality and risk principles`, 'Problem Solving'];
    const canonical = (value) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '');
    const evidence = (ctx.skills || []).map(canonical);
    const known = defaults.filter(skill => evidence.includes(canonical(skill)));
    const fromResume = resumeSkillsRelevantToRole(exactRole, ctx);
    return unique([...fromResume, ...known, ...defaults]).slice(0, MAX_ROLE_SKILLS);
}
export function resolveInterviewTurnCount(profile, ctx, level = '', roleSkillsFromStore = null) {
    const exactRole = resolveExactInterviewRole(profile, ctx?.role || '');
    const plan = structuredPlanSummary(exactRole, ctx, profile, level, roleSkillsFromStore);
    return plan.totalTurns;
}
function resolveMostRecentJob(profile, ctx) {
    const we = profile?.workExperiences?.[0];
    if (we?.jobTitle || we?.company) {
        return {
            label: `${clean(we.jobTitle) || 'Role'} at ${clean(we.company) || 'Company'}`.replace(/ at Company$/, ''),
            responsibilities: clean(we.responsibilities || we.description),
        };
    }
    const line = clean(ctx.jobs?.[0]);
    if (!line)
        return { label: 'your most recent role', responsibilities: '' };
    return { label: line.split(':')[0].slice(0, 160), responsibilities: line.includes(':') ? line.split(':').slice(1).join(':').trim() : '' };
}
function splitResumeBullets(text) {
    return String(text ?? '')
        .split(/\r?\n|•|·|▪|\u2022|(?<=[.!?])\s+/)
        .map(clean)
        .filter((s) => s.length >= 20 && s.length <= 320);
}
function scoreProjectLine(line, exactRole, ctx) {
    const lower = line.toLowerCase();
    let score = 0;
    if (/project|built|develop|implement|design|deliver|migrat|pipeline|platform|system|application|product|architect|led|owned|launch/i.test(lower))
        score += 2;
    const roleTokens = clean(exactRole)
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3);
    if (roleTokens.some((t) => lower.includes(t)))
        score += 2;
    for (const skill of (ctx.skills || []).map(clean).filter(Boolean)) {
        const s = skill.toLowerCase().replace(/\.js\b/, '');
        if (s.length >= 2 && lower.includes(s))
            score += 1;
    }
    return score;
}
/** Rank résumé / profile evidence into interview-ready project anchors. */
export function extractResumeProjects(profile, ctx, exactRole = '') {
    const role = clean(exactRole) || clean(ctx?.role) || resolveExactInterviewRole(profile, '');
    /** @type {{ label: string, summary: string, employer: string, source: string, score: number }[]} */
    const projects = [];
  const explicitProjects = profile && 'projects' in profile && Array.isArray(profile.projects) ? profile.projects : [];
  for (const item of explicitProjects) {
    const entry = typeof item === 'string' ? { name: item } : item;
    if (!entry || typeof entry !== 'object') continue;
    const label = clean(entry.name || entry.title);
    const summary = [label, entry.description, entry.contribution, ...(Array.isArray(entry.technologies) ? entry.technologies : []), ...(Array.isArray(entry.tools) ? entry.tools : [])].filter(v => typeof v === 'string').join('. ');
    if (!label || !summary) continue;
    projects.push({label: label.slice(0, 110), summary: summary.slice(0, 500), employer: clean(entry.company || entry.employer), source: 'project', score: scoreProjectLine(summary, role, ctx) + 3});
  }

    for (const ach of (ctx.achievements || []).map(clean).filter(Boolean)) {
    if (!/project|built|develop|implement|design|deliver|migrat|pipeline|platform|application|launch/i.test(ach)) continue;
        projects.push({
            label: ach.slice(0, 110),
            summary: ach.slice(0, 240),
            employer: '',
            source: 'achievement',
            score: scoreProjectLine(ach, role, ctx) + 1,
        });
    }
    for (const we of profile?.workExperiences || []) {
        const employer = `${clean(we.jobTitle) || 'Role'} at ${clean(we.company) || 'Company'}`.replace(/ at Company$/, '');
        const blob = [we.description, we.responsibilities].filter(Boolean).join('\n');
        for (const line of splitResumeBullets(blob)) {
    if (!/project|built|develop|implement|design|deliver|migrat|pipeline|platform|application|launch/i.test(line)) continue;
            projects.push({
                label: line.slice(0, 110),
                summary: line.slice(0, 240),
                employer,
                source: 'experience',
                score: scoreProjectLine(line, role, ctx),
            });
        }
    }
    const snippet = clean(profile?.resumeText || ctx.resumeSnippet);
    if (snippet) {
        for (const line of splitResumeBullets(snippet)) {
            if (!/project|built|develop|implement|design|deliver|pipeline|platform|system|application|architect|migrat/i.test(line))
                continue;
            projects.push({
                label: line.slice(0, 110),
                summary: line.slice(0, 240),
                employer: '',
                source: 'resume',
                score: scoreProjectLine(line, role, ctx),
            });
        }
    }
    const seen = new Set();
    return projects
        .sort((a, b) => b.score - a.score)
        .filter((p) => {
            const key = p.label.slice(0, 48).toLowerCase();
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        })
        .slice(0, 8);
}
function pickProjectAnchor(projects, _slot, varietySeed) {
  if (!projects.length) return null;
  const best = projects.filter(p => p.score >= projects[0].score - 1);
  return best[hashString(varietySeed + '|project') % best.length];
}

export function isTheoryTurnForPlan(plan, turn) {
    if (plan.fresher)
        return turn <= 2;
    const skillStart = 2;
    const skillEnd = 1 + MAX_ROLE_SKILLS;
    return turn >= skillStart && turn <= skillEnd;
}
export function analyzeOpeningAnswerAlignment(answer, roleSkills, ctx = {}) {
    void ctx;
    const jsonSkills = jsonRoleSkillsForInterview(null, roleSkills);
    const canonical = (value) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '');
    const lower = clean(answer).toLowerCase();
    if (!lower) {
        return {
            matched: [],
            unmatched: [...jsonSkills],
            orderedSkills: [...jsonSkills],
            matchRatio: 0,
            skillsFromJsonFallback: true,
        };
    }
    const blob = lower.replace(/[^a-z0-9\s]/g, ' ');
    const matched = [];
    const unmatched = [];
    for (const skill of jsonSkills) {
        const s = clean(skill);
        if (!s)
            continue;
        const c = canonical(s);
        let hit = lower.includes(s.toLowerCase()) || (c.length >= 3 && blob.replace(/\s/g, '').includes(c));
        if (!hit && /spark|pyspark/i.test(s) && /spark|pyspark/i.test(lower))
            hit = true;
        if (hit)
            matched.push(s);
        else
            unmatched.push(s);
    }
    if (!matched.length) {
        return {
            matched: [],
            unmatched: [...jsonSkills],
            orderedSkills: [...jsonSkills],
            matchRatio: 0,
            skillsFromJsonFallback: true,
        };
    }
    const orderedSkills = unique([...matched, ...unmatched]).slice(0, MAX_ROLE_SKILLS);
    return {
        matched: unique(matched),
        unmatched: unique(unmatched),
        orderedSkills,
        matchRatio: jsonSkills.length ? matched.length / jsonSkills.length : 0,
        skillsFromJsonFallback: false,
    };
}
export function experiencedTurnSlot(turn) {
    if (turn === 1)
        return 'opening';
    if (turn >= 2 && turn <= 1 + MAX_ROLE_SKILLS)
        return 'skill';
    if (turn >= 2 + MAX_ROLE_SKILLS && turn <= 1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS)
        return 'project';
    if (turn === 1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS + 1)
        return 'fallback';
    if (turn === EXPERIENCED_INTERVIEW_TURN_COUNT)
        return 'closing';
    return 'unknown';
}
const THEORY_TOPICS = [
    [/^sql$|postgres|mysql/i, 'how INNER JOIN differs from LEFT JOIN, including what happens when there is no matching row', 'how transaction isolation keeps updates from interfering with each other'],
    [/react/i, 'how props and state differ and when a component re-renders', 'how React uses keys to keep track of items when a list changes'],
    [/node/i, 'how the event loop handles asynchronous I/O', 'how you would handle a stream that receives data faster than it can process it'],
    [/javascript|typescript/i, 'how lexical scope and closures work', 'how the event loop orders microtasks and tasks and why that order matters'],
    [/python/i, 'how mutable and immutable objects differ and what that means for function arguments', 'how generators save memory compared with lists'],
    [/^java$/i, 'how interfaces differ from abstract classes', 'how you would safely update shared data from several threads'],
    [/^c\+\+$|^c#$/i, 'how value and reference semantics differ', 'how resource ownership and object lifetime affect memory safety'],
    [/docker/i, 'how an image differs from a container', 'how layered filesystems and multi-stage builds affect reproducibility and image size'],
    [/kubernetes/i, 'how a deployment differs from a service', 'how readiness and liveness probes affect rollout safety and availability'],
    [/statistics/i, 'how correlation differs from causation', 'how selection bias and confounding affect causal interpretation'],
    [/ai \/ ml/i, 'how overfitting differs from underfitting', 'how data leakage affects model validation and how to prevent it'],
    [/financial accounting/i, 'how accrual accounting differs from cash accounting', 'how revenue recognition and matching principles affect financial statements'],
    [/patient assessment/i, 'how subjective and objective assessment findings differ', 'how assessment priorities change when multiple clinical risks are present'],
    [/infection prevention/i, 'how standard precautions differ from transmission-based precautions', 'how the hierarchy of controls reduces infection transmission risk'],
    [/customer discovery/i, 'how an open question differs from a leading question when identifying customer needs', 'how confirmation bias affects qualification and how to reduce it'],
    [/negotiation/i, 'what BATNA means and why it matters', 'how reservation value and bargaining zones affect negotiation strategy'],
];
const ALT_GENERIC_CONCEPTS = [
    'a core concept practitioners often misunderstand',
    'how you would debug a subtle issue in production',
    'a design choice you would make differently for scale versus simplicity',
    'how you would explain this topic to a teammate new to the stack',
];
/** Role-practical prompts: what people in the job actually use (junior / mid / senior). */
const SKILL_INTERVIEW_PROMPTS = [
    [/pyspark|apache spark|^spark$/i, {
        junior: 'what a Spark DataFrame is and how it differs from working row-by-row in plain Python for data processing',
        mid: 'why PySpark waits to run transformations until an action is called',
        senior: 'how you would handle data skew when some Spark tasks take much longer than others',
    }],
    [/^etl$|extract transform load|data pipeline/i, {
        junior: 'the basic stages of an ETL pipeline and what can go wrong at each stage',
        mid: 'how you would rerun an ETL job without creating duplicate data',
        senior: 'how you design backfills, late-arriving data, and failure recovery without corrupting downstream tables',
    }],
    [/airflow|prefect|dag\b/i, {
        junior: 'what a DAG represents in workflow orchestration and why task dependencies matter',
        mid: 'how you would structure retries, SLAs, and sensors in a production pipeline',
        senior: 'trade-offs between dynamic DAG generation, resource pools, and isolating failure blast radius',
    }],
    [/kafka|event stream|streaming/i, {
        junior: 'the difference between a topic, partition, and consumer group in event streaming',
        mid: 'how you handle at-least-once delivery and offset commits in a stream consumer',
        senior: 'how you would reason about ordering, replay, and schema evolution in a high-volume Kafka pipeline',
    }],
    [/dbt\b|data build tool/i, {
        junior: 'what dbt models and tests are meant to guarantee in a warehouse project',
        mid: 'how incremental models and snapshots change how you ship warehouse changes safely',
        senior: 'how you govern exposures, contracts, and performance in a multi-team dbt project',
    }],
    [/snowflake|bigquery|redshift|warehouse/i, {
        junior: 'how loading and querying differ in a cloud warehouse versus a transactional database',
        mid: 'how clustering, partitioning, or warehouse sizing affects cost and query latency',
        senior: 'how you design layers (raw, staging, mart) and access patterns for governed analytics',
    }],
    [/power bi|tableau|looker|data visualization/i, {
        junior: 'how a metric definition should be consistent between a chart and the underlying SQL',
        mid: 'how you validate dashboard performance and avoid misleading aggregations',
        senior: 'how you balance self-serve analytics with certified datasets and row-level security',
    }],
];
function resolveSkillConcept(skill, tier, varietySeed, turn) {
    const rolePrompt = SKILL_INTERVIEW_PROMPTS.find(([pattern]) => pattern.test(skill));
    if (rolePrompt) {
        const prompts = rolePrompt[1];
        if (tier === 'senior')
            return prompts.senior;
        if (tier === 'mid')
            return prompts.mid;
        return prompts.junior;
    }
    const topics = THEORY_TOPICS.find(([pattern]) => pattern.test(skill));
    if (topics) {
        return tier === 'senior' ? topics[2] : tier === 'mid' ? `${topics[1]} and when you would use it` : topics[1];
    }
    const alt = ALT_GENERIC_CONCEPTS[hashString(`${varietySeed}|${skill}|${turn}`) % ALT_GENERIC_CONCEPTS.length];
    if (tier === 'senior')
        return `how you would compare two ways to solve a problem using ${skill}`;
    if (tier === 'mid')
        return alt.replace('this topic', skill);
    return `one basic idea in ${skill} and why it is useful`;
}
function buildSkillQuestion(first, skill, level, turn, fresher, varietySeed = '', options = {}) {
    const exactRole = clean(options.exactRole) || 'this role';
    const years = parseExperienceYears(level, options.profile);
    const tier = experienceTierFromYears(years);
    const concept = fresher ? selectFresherConcept(skill, varietySeed, turn, options.priorTexts || []) : resolveSkillConcept(skill, tier, varietySeed, turn);
    return {
        text: spokenLead(first, skill === 'a skill you know'
            ? `explain ${concept}, using a skill you have learned.`
            : fresher ? `explain ${concept} in ${skill}.` : `for ${skill} in ${exactRole}, explain ${concept}.`),
        category: 'Technical',
        keywords: [skill.toLowerCase(), exactRole.toLowerCase(), tier],
        hint: 'Explain the concept directly for this role and experience level. No résumé story required.',
        topic: skill,
        focus: `structured-theory-${turn}`,
        scoringProfile: 'technical',
    };
}
function buildOpeningWorkQuestion(first, profile, ctx, exactRole, varietySeed = '') {
    const job = resolveMostRecentJob(profile, ctx);
    const greeting = OPENING_GREETINGS[hashString(varietySeed || 'open') % OPENING_GREETINGS.length];
    const lead = first && first !== 'there' ? `${greeting} ${first},` : greeting;
    return {
        text: `${lead} what were your main responsibilities in ${job.label}?`.replace(/\s+/g, ' ').trim(),
        category: 'Experience',
        keywords: ['responsibilities', 'experience', 'exposure', 'role'],
        hint: 'Describe your main tasks in simple words.',
        topic: 'Opening — prior employer',
        resumeAnchor: job.label,
        focus: 'structured-opening-generic',
        scoringProfile: 'opening_generic',
    };
}
function buildFallbackRecentQuestion(first, profile, ctx, level, varietySeed = '', lastAnswer = '') {
    const job = resolveMostRecentJob(profile, ctx);
    const variant = hashString(`${varietySeed}|fallback`) % 3;
    const snippets = [
        `following up on your earlier answers about ${job.label}, pick one responsibility you mentioned and go deeper — what was hardest, and how did you handle it?`,
        `thinking about ${job.label}, how would you decide which task to work on first?`,
        `thinking about ${job.label}, how would you decide whether a task is complete?`,
    ];
    let text = snippets[variant];
    if (clean(lastAnswer).length > 40 && variant === 0) {
        text = `as a follow-up, what would you change about the approach in your last answer?`;
    }
    return {
        text: spokenLead(first, text),
        category: 'Problem Solving',
        keywords: ['follow-up', 'decision', 'outcome'],
        hint: 'Explain your approach; a hypothetical example is fine.',
        topic: 'Recent work follow-up',
        resumeAnchor: job.label,
        focus: 'structured-fallback-recent',
        scoringProfile: 'project',
    };
}
function buildClosingQuestion(first, exactRole, varietySeed = '') {
    const line = CLOSING_LINES[hashString(`${varietySeed}|close`) % CLOSING_LINES.length](exactRole);
    return {
        text: first && first !== 'there' ? `${first}, ${line}` : line,
        category: 'Communication',
        keywords: ['closing', 'thanks'],
        hint: 'A brief, professional sign-off is fine.',
        topic: 'Closing',
        focus: 'structured-closing',
        scoringProfile: 'behavioral',
    };
}
function lastExperienceProjectQuestion(first, profile, ctx, slot, level, varietySeed = '', exactRole = '', options = {}) {
  const role = clean(exactRole) || resolveExactInterviewRole(profile, ctx?.role);
  const years = parseExperienceYears(level, profile);
  const anchor = pickProjectAnchor(extractResumeProjects(profile, ctx, role), 1, varietySeed);
  return {
    text: spokenLead(first, projectTechnicalQuestion(anchor?.label || '', anchor?.summary || '', role, years, slot, varietySeed, options.lastAnswer || '')),
    category: slot === 1 ? 'Experience' : 'Problem Solving',
    keywords: ['project', slot === 1 ? 'contribution' : 'validation', role.toLowerCase()],
    hint: 'Explain what you personally did. Use the tools and decisions from your real project.',
    topic: slot === 1 ? 'Recent work project' : 'Recent work problem solving',
    resumeAnchor: anchor?.label, focus: `structured-recent-project-${slot}`, scoringProfile: 'project',
  };
}
function projectQuestion(first, profile, ctx, turn, exactRole = '', varietySeed = '', lastAnswer = '') {
  const role = clean(exactRole) || clean(ctx.role) || 'this role';
  const anchor = pickProjectAnchor(extractResumeProjects(profile, ctx, role), 1, varietySeed);
  return {
    text: spokenLead(first, projectTechnicalQuestion(anchor?.label || '', anchor?.summary || '', role, 0, turn === 3 ? 1 : 2, varietySeed, lastAnswer)),
    category: turn === 3 ? 'Experience' : 'Problem Solving',
    keywords: ['project', turn === 3 ? 'contribution' : 'testing', role.toLowerCase()],
    hint: 'Explain your own part in a real academic, personal, or practice project. Employment is not required.',
    topic: turn === 3 ? 'Project contribution' : 'Project validation',
    resumeAnchor: anchor?.label, focus: `structured-project-${turn}`, scoringProfile: 'project',
  };
}
export function buildStructuredTurnQuestion(options) {
    const { turnNumber: turn, first, level, profile, ctx } = options;
    const role = resolveExactInterviewRole(profile, options.roleOverride || ctx.role);
    const fresh = isPlanFresher(profile, ctx, level);
    const plan = options.planSummary || structuredPlanSummary(role, ctx, profile, level, options.roleSkills, null, options.varietySeed);
    const maxTurn = plan.totalTurns || FRESHER_INTERVIEW_TURN_COUNT;
    if (turn < 1 || turn > maxTurn)
        return null;
    const expLevel = clean(profile?.totalExperience) || level;
    const varietySeed = clean(options.varietySeed);
    if (fresh) {
        const skills = plan.recommendedSkills;
        if (turn <= 2)
            return buildSkillQuestion(first, skills[turn - 1], expLevel, turn, true, varietySeed, { exactRole: role, priorTexts: (options.history || []).map(h => typeof h.question === 'string' ? h.question : h.question.text || '') });
        if (turn <= 4)
            return projectQuestion(first, profile, ctx, turn, role, varietySeed, options.lastAnswer || '');
    if (turn === 5) {
        const cert = clean(ctx.certs?.[0] || profile?.certifications?.[0]?.name);
            return { text: spokenLead(first, cert ? `what is one important concept you learned in ${cert}, and how would you apply it to a task?` : 'what would you improve in your project next, and why would that improvement matter?'),
            category: 'Problem Solving', keywords: [cert || 'project', 'learning'], hint: 'Discuss a real project or certification; do not invent a credential.', topic: cert || 'Project reflection', focus: cert ? 'structured-cert' : 'structured-project' };
    }
    return { text: spokenLead(first, `last question: what interests you about working as a ${role}, and what would you like to learn next?`), category: 'Communication', keywords: ['motivation', 'learning'], hint: 'Share your motivation and learning goals.', topic: 'Closing', focus: 'structured-closing' };
}
    const openingAnalysis = options.openingAnalysis;
    const jsonSkills = jsonRoleSkillsForInterview(role, options.roleSkills || plan.recommendedSkills);
    const skills =
        openingAnalysis?.matched?.length && !openingAnalysis.skillsFromJsonFallback
            ? openingAnalysis.orderedSkills
            : jsonSkills;
    const slot = experiencedTurnSlot(turn);
    if (slot === 'opening')
        return buildOpeningWorkQuestion(first, profile, ctx, role, varietySeed);
    if (slot === 'skill') {
        const skillIndex = turn - 2;
        const skill = skills[skillIndex];
        const matched = openingAnalysis?.matched?.some((m) => clean(m).toLowerCase() === clean(skill).toLowerCase());
        return buildSkillQuestion(first, skill, expLevel, turn, false, varietySeed, {
            skillMatchedInOpening: matched,
            exactRole: role,
            profile,
        });
    }
    if (slot === 'project')
        return lastExperienceProjectQuestion(first, profile, ctx, turn - (1 + MAX_ROLE_SKILLS), expLevel, varietySeed, role, {
            openingAnalysis,
            lastAnswer: options.lastAnswer || '',
            lastOpeningAnswer: options.history?.[0]?.answer || '',
        });
    if (slot === 'fallback')
        return buildFallbackRecentQuestion(first, profile, ctx, expLevel, varietySeed, options.lastAnswer || '');
    if (slot === 'closing')
        return buildClosingQuestion(first, role, varietySeed);
    return null;
}
export function structuredPlanSummary(exactRole, ctx, profile = null, level = '', roleSkillsFromStore = null, openingAnalysis = null, varietySeed = '') {
    const fresher = isPlanFresher(profile, ctx, level);
    const topRoleSkills = jsonRoleSkillsForInterview(exactRole, roleSkillsFromStore);
    const baseSkills = fresher
        ? selectFresherSkills(topRoleSkills, '', topRoleSkills, varietySeed)
        : jsonRoleSkillsForInterview(exactRole, roleSkillsFromStore);
    const skills =
        !fresher && openingAnalysis?.matched?.length && !openingAnalysis.skillsFromJsonFallback
            ? openingAnalysis.orderedSkills
            : baseSkills;
    if (fresher) {
        return {
            exactRole,
            fresher,
            recommendedSkills: skills,
            topRoleSkills,
            experienceYears: parseExperienceYears(level, profile),
            difficulty: experienceTierFromYears(parseExperienceYears(level, profile)),
            totalTurns: FRESHER_INTERVIEW_TURN_COUNT,
            turnPlan: [
                `Q1 theory: ${skills[0]} fundamentals; no past-work or résumé question`,
                `Q2 theory: ${skills[1]} fundamentals; a different concept from Q1; no past-work or résumé question`,
                'Q3: how the candidate implemented part of a real academic/personal project; do not assume employment',
                'Q4: technical follow-up on the same project: testing or debugging; use the last answer',
                'Q5: certification learning, or project improvement if no certification exists',
                'Q6: general motivation or learning goals',
            ],
        };
    }
    const turnPlan = [
        `Q1: greet; roles, responsibilities, experience and exposure at most recent employer; relates to ${exactRole}`,
        ...skills.map((skill, i) => `Q${i + 2} technical: ${skill}; difficulty from experience; conceptual, not résumé story`),
        `Q${2 + MAX_ROLE_SKILLS}: real résumé project — how it was implemented for ${exactRole}; use only evidenced tools`,
        `Q${3 + MAX_ROLE_SKILLS}: technical follow-up on the same project — testing, debugging or design choices; depth from experience`,
        `Q${4 + MAX_ROLE_SKILLS}: fallback follow-up on recent work / prior answers`,
        `Q${EXPERIENCED_INTERVIEW_TURN_COUNT}: varied closing thanks (not identical every session)`,
    ];
    return {
        exactRole,
        fresher,
        recommendedSkills: skills,
            topRoleSkills,
            experienceYears: parseExperienceYears(level, profile),
            difficulty: experienceTierFromYears(parseExperienceYears(level, profile)),
        totalTurns: EXPERIENCED_INTERVIEW_TURN_COUNT,
        turnPlan,
        openingAnalysis: openingAnalysis || null,
    };
}
/** Reject obvious slot drift; caller retries the same model then uses the slot-specific fallback. */
export function questionMatchesPlan(question, plan, turn) {
    const text = clean(question.text)
  if (/\b(?:prove|proof)\b|\byou (?:claim|claimed|say|said|mentioned|have worked|worked|have been working)\b|\byou['’]ve worked\b|\b(?:verify|justify) (?:your|that you)\b|\bevidence (?:of|that)\b/i.test(text)) return false;
    if (!plan.fresher && turn === 1)
        return /responsibilit|experience|exposure|role|walk me through|begin/i.test(text);
    if (!plan.fresher && turn === EXPERIENCED_INTERVIEW_TURN_COUNT)
        return /thank|appreciat|conclud|wrap|wish|good luck|best/i.test(text);
    if (!plan.fresher && experiencedTurnSlot(turn) === 'fallback')
        return /follow|deeper|expand|decision|decide|handle|metric|outcome|mentioned/i.test(text);
    const theory = isTheoryTurnForPlan(plan, turn);
    if (theory) {
        const skillIndex = plan.fresher ? turn - 1 : turn - 2;
        const skill = plan.recommendedSkills[skillIndex];
        if (question.resumeAnchor || /résumé|resume|your (?:project|experience|work|background)|you (?:used|built|implemented|worked|applied)|tell me about a time|describe a (?:time|situation|challenge)|you have|you've/i.test(text))
            return false;
        const normalized = (value) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '');
        if (skill !== 'a skill you know' && !normalized(text).includes(normalized(skill)))
            return false;
        return /explain|what|how|why|compare|difference|define/i.test(text);
    }
    if (plan.fresher && turn === FRESHER_INTERVIEW_TURN_COUNT)
        return /motivat|interest|learn|goal|strength|next step|why|aspir/i.test(text);
    if (plan.fresher && turn <= 4)
        return /project|academic|practice|coursework|assignment/i.test(text) && !/your (?:employer|company|job)|at work/i.test(text);
    if (plan.fresher && turn === 5)
        return /project|certif|credential|course|learned|improv/i.test(text);
    if (!plan.fresher && experiencedTurnSlot(turn) === 'project')
        return /project|deliver|initiative|work|role|contribut|problem|decision|challenge|valid|fix|bug|release/i.test(text);
    return /work|responsibilit|role|contribut|problem|decision|challenge/i.test(text);
}

export function selectProjectForInterview(profile, ctx, role, varietySeed = '') {
  return pickProjectAnchor(extractResumeProjects(profile, ctx, role), 1, varietySeed);
}
