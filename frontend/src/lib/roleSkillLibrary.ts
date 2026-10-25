/** Role-family → core skills (aligned with backend/node/interviewQuestionPlan.mjs). */
export type RoleSkillEntry = { test: RegExp; skills: string[] }

export const ROLE_SKILL_LIBRARY: RoleSkillEntry[] = [
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
]

export function skillsMatchingRoleText(text: string): string[] {
  const blob = String(text ?? '').trim()
  if (!blob) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of ROLE_SKILL_LIBRARY) {
    if (!entry.test.test(blob)) continue
    for (const skill of entry.skills) {
      const key = skill.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(skill)
    }
  }
  return out
}
