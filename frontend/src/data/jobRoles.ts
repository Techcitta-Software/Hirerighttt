export type JobRoleGroup = { label: string; roles: string[] }

/** Role track values stored on jobs as `roleTrack` (Neon `jobs.role_track`, max 120 chars). */
export const JOB_ROLE_GROUPS: JobRoleGroup[] = [
  {
    label: 'Software Engineering',
    roles: [
      'Software Engineer',
      'Frontend Developer',
      'Backend Engineer',
      'Full Stack Engineer',
      'API / Integration Engineer',
      'Systems Software Engineer',
      'Mobile Developer (iOS/Android)',
      'iOS Developer',
      'Android Developer',
      'Cross-Platform Mobile Developer',
      'Embedded / Firmware Engineer',
      'Game Developer',
      'Blockchain Developer',
      'AR / VR Developer',
      'IoT Engineer',
    ],
  },
  {
    label: 'Architecture & Leadership',
    roles: [
      'Technical Lead',
      'Staff Software Engineer',
      'Principal Software Engineer',
      'Software Architect',
      'Solutions Architect',
      'Enterprise Architect',
      'Engineering Manager',
      'Director of Engineering',
      'VP of Engineering',
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
      'Analytics Engineer',
      'Data Analyst',
      'Business Intelligence Developer',
      'MLOps Engineer',
      'Computer Vision Engineer',
      'NLP Engineer',
      'Research Scientist (ML)',
    ],
  },
  {
    label: 'Cloud, Infra & Security',
    roles: [
      'DevOps Engineer',
      'Site Reliability Engineer',
      'Cloud Engineer',
      'Platform Engineer',
      'Infrastructure Engineer',
      'Kubernetes / Container Engineer',
      'Security Engineer',
      'Application Security Engineer',
      'Network Engineer',
      'Database Administrator',
      'Database Reliability Engineer',
    ],
  },
  {
    label: 'Quality & Performance',
    roles: [
      'QA Engineer',
      'SDET / Automation Engineer',
      'Performance Engineer',
      'Test Lead',
    ],
  },
  {
    label: 'Product & Design',
    roles: [
      'Product Manager',
      'Technical Product Manager',
      'Technical Program Manager',
      'UI/UX Designer',
      'Product Designer',
      'UX Researcher',
      'Design Systems Engineer',
    ],
  },
  {
    label: 'Business & Operations',
    roles: [
      'Business Analyst',
      'Technical Writer',
      'Developer Advocate',
      'Sales Engineer',
      'Sales / Account Executive',
      'Customer Success Manager',
      'Marketing Manager',
      'HR / Talent Acquisition',
      'Operations Manager',
      'Finance Analyst',
      'Scrum Master',
      'Agile Coach',
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
  { pattern: /\bdata engineer\b|\banalytics engineer\b/i, role: 'Data Engineer' },
  { pattern: /\bdata analyst\b|\bbi developer\b/i, role: 'Data Analyst' },
  { pattern: /\bmlops\b/i, role: 'MLOps Engineer' },
  { pattern: /\bfrontend\b|\bfront-end\b|\breact\b|\bvue\b|\bangular\b/i, role: 'Frontend Developer' },
  { pattern: /\bfull stack\b|\bfullstack\b/i, role: 'Full Stack Engineer' },
  { pattern: /\bbackend\b|\bback-end\b|\bjava developer\b|\bgo developer\b/i, role: 'Backend Engineer' },
  { pattern: /\bdevops\b/i, role: 'DevOps Engineer' },
  { pattern: /\bsre\b|\bsite reliability\b/i, role: 'Site Reliability Engineer' },
  { pattern: /\bplatform engineer\b/i, role: 'Platform Engineer' },
  { pattern: /\bsecurity engineer\b|\bappsec\b/i, role: 'Security Engineer' },
  { pattern: /\bproduct manager\b|\bproduct owner\b/i, role: 'Product Manager' },
  { pattern: /\btpm\b|\btechnical program manager\b/i, role: 'Technical Program Manager' },
  { pattern: /\bux designer\b|\bui\/ux\b/i, role: 'UI/UX Designer' },
  { pattern: /\bsales engineer\b|\bsolutions consultant\b/i, role: 'Sales Engineer' },
  { pattern: /\bsales\b|\baccount executive\b/i, role: 'Sales / Account Executive' },
  { pattern: /\bqa\b|\bquality assurance\b|\btest engineer\b|\bsdet\b/i, role: 'SDET / Automation Engineer' },
  { pattern: /\bsoftware architect\b|\bsolutions architect\b/i, role: 'Software Architect' },
  { pattern: /\bengineering manager\b|\beng manager\b/i, role: 'Engineering Manager' },
  { pattern: /\bstaff engineer\b|\bprincipal engineer\b/i, role: 'Staff Software Engineer' },
  { pattern: /\bios developer\b|\bswift developer\b/i, role: 'iOS Developer' },
  { pattern: /\bandroid developer\b|\bkotlin developer\b/i, role: 'Android Developer' },
  { pattern: /\bdistributed systems\b|\bplatform engineer\b/i, role: 'Backend Engineer' },
]

export function suggestRoleFromTitle(title: string): string | null {
  const t = title.trim()
  if (!t) return null
  for (const rule of TITLE_ROLE_RULES) {
    if (rule.pattern.test(t)) return rule.role
  }
  return null
}
