export type JobRoleGroup = { label: string; roles: string[] }

export const JOB_ROLE_GROUPS: JobRoleGroup[] = [
  {
    label: 'Software Engineering',
    roles: [
      'Software Engineer',
      'Frontend Developer',
      'Backend Engineer',
      'Full Stack Engineer',
      'Mobile Developer (iOS/Android)',
      'Embedded / Firmware Engineer',
      'Game Developer',
    ],
  },
  {
    label: 'AI, ML & Data',
    roles: [
      'AI Engineer',
      'Machine Learning Engineer',
      'Generative AI / LLM Engineer',
      'Data Scientist',
      'Data Engineer',
      'Data Analyst',
      'MLOps Engineer',
      'Computer Vision Engineer',
      'NLP Engineer',
    ],
  },
  {
    label: 'Cloud, Infra & Security',
    roles: [
      'DevOps Engineer',
      'Site Reliability Engineer',
      'Cloud Engineer',
      'Platform Engineer',
      'Security Engineer',
      'Network Engineer',
      'Database Administrator',
    ],
  },
  {
    label: 'Quality',
    roles: ['QA Engineer', 'SDET / Automation Engineer'],
  },
  {
    label: 'Product & Design',
    roles: [
      'Product Manager',
      'Technical Program Manager',
      'UI/UX Designer',
      'Product Designer',
    ],
  },
  {
    label: 'Business & Operations',
    roles: [
      'Business Analyst',
      'Sales / Account Executive',
      'Customer Success Manager',
      'Marketing Manager',
      'HR / Talent Acquisition',
      'Operations Manager',
      'Finance Analyst',
    ],
  },
  {
    label: 'Other',
    roles: ['Other (use job title)'],
  },
]

export const ALL_JOB_ROLES: string[] = JOB_ROLE_GROUPS.flatMap((g) => g.roles)

export const DEFAULT_JOB_ROLE = 'Software Engineer'

const TITLE_ROLE_RULES: { pattern: RegExp; role: string }[] = [
  { pattern: /\bai engineer\b/i, role: 'AI Engineer' },
  { pattern: /\bml engineer\b|\bmachine learning engineer\b/i, role: 'Machine Learning Engineer' },
  { pattern: /\bllm\b|\bgenerative ai\b/i, role: 'Generative AI / LLM Engineer' },
  { pattern: /\bdata scientist\b/i, role: 'Data Scientist' },
  { pattern: /\bdata engineer\b/i, role: 'Data Engineer' },
  { pattern: /\bdata analyst\b/i, role: 'Data Analyst' },
  { pattern: /\bmlops\b/i, role: 'MLOps Engineer' },
  { pattern: /\bfrontend\b|\bfront-end\b|\breact\b/i, role: 'Frontend Developer' },
  { pattern: /\bfull stack\b|\bfullstack\b/i, role: 'Full Stack Engineer' },
  { pattern: /\bbackend\b|\bback-end\b/i, role: 'Backend Engineer' },
  { pattern: /\bdevops\b/i, role: 'DevOps Engineer' },
  { pattern: /\bsre\b|\bsite reliability\b/i, role: 'Site Reliability Engineer' },
  { pattern: /\bproduct manager\b|\bpm\b/i, role: 'Product Manager' },
  { pattern: /\bsales\b|\baccount executive\b/i, role: 'Sales / Account Executive' },
  { pattern: /\bqa\b|\bquality assurance\b|\btest engineer\b/i, role: 'QA Engineer' },
]

export function suggestRoleFromTitle(title: string): string | null {
  const t = title.trim()
  if (!t) return null
  for (const rule of TITLE_ROLE_RULES) {
    if (rule.pattern.test(t)) return rule.role
  }
  return null
}
