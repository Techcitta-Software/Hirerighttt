export type WizardStep = 1 | 2 | 3 | 4 | 5

export interface WorkExperience {
  id: string
  jobTitle: string
  company: string
  employmentType: string
  startDate: string
  endDate: string
  currentlyWorking: boolean
  location: string
  responsibilities: string
}

export interface PerformanceMetric {
  id: string
  metric: string
  contribution: string
  impact: string
  timePeriod: string
}

export interface Certification {
  id: string
  name: string
  organization: string
  dateEarned: string
  credentialId: string
}

export interface ProfileFormData {
  resumeFileId?: string | null
  storageProvider?: 's3' | 'supabase' | null
  resumeFile: File | null
  resumeName?: string | null
  whoAreYou: string
  whatDrivesYou: string
  keyStrengths: string
  currentRole: string
  totalExperience: string
  currentLocation: string
  noticePeriod: string
  skills: string[]
  experienceSummary: string
  workExperiences: WorkExperience[]
  /** User opted in to “no prior work experience” (not inferred from an empty job list). */
  noPriorWorkExperience: boolean
  achievements: string[]
  metrics: PerformanceMetric[]
  awards: string[]
  certifications: Certification[]
  selfRating: number
  preferredRoles: string[]
  preferredLocations: string[]
  workMode: string
  salaryExpectation: string
  interviewNotes: string
  /** Raw resume text for Ava's resume-accurate AI interview. */
  resumeText: string
  /** Supabase Storage public URL after CDN upload (optional). */
  resumeUrl?: string | null
  resumeStoragePath?: string | null
}

export const STEPS = [
  {
    id: 1 as const,
    label: 'Profile',
    sublabel: 'Tell us who you are',
  },
  {
    id: 2 as const,
    label: 'Resume',
    sublabel: 'Upload your resume',
  },
  {
    id: 3 as const,
    label: 'About You',
    sublabel: 'Your background & goals',
  },
  {
    id: 4 as const,
    label: 'Availability',
    sublabel: 'Choose interview slot',
  },
  {
    id: 5 as const,
    label: 'AI Interview',
    sublabel: 'Prepare for interview',
  },
]

export const ROLE_OPTIONS = [
  'Software Engineer',
  'Senior Software Engineer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'Product Manager',
  'UI/UX Designer',
  'Data Scientist',
  'DevOps Engineer',
  'Engineering Manager',
]

export const EXPERIENCE_OPTIONS = [
  'Fresher / 0 years',
  '0 – 1 Years',
  '1 – 2 Years',
  '2 – 3 Years',
  '3 – 5 Years',
  '5 – 8 Years',
  '8 – 12 Years',
  '12+ Years',
]

export const LOCATION_OPTIONS = [
  'Bengaluru',
  'Hyderabad',
  'Pune',
  'Mumbai',
  'Delhi NCR',
  'Chennai',
  'Remote',
  'Other',
]

export const NOTICE_OPTIONS = [
  'Immediate',
  '15 days',
  '30 days',
  '60 days',
  '90 days',
  'Serving notice',
]

export const DEFAULT_SKILLS = [
  'Python',
  'JavaScript',
  'React.js',
  'Node.js',
  'TypeScript',
  'AWS',
  'MongoDB',
  'SQL',
  'Git',
  'Docker',
  'REST APIs',
  'Agile',
]

export const SUGGESTED_SKILLS = [
  'Data Structures',
  'System Design',
  'PostgreSQL',
  'AI / ML',
  'Kubernetes',
  'CI/CD',
  'Express.js',
  'Next.js',
  'Vue.js',
  'Angular',
  'Java',
  'Spring Boot',
  'C++',
  'C#',
  '.NET Core',
  'Go (Golang)',
  'Rust',
  'Swift',
  'Kotlin',
  'Flutter',
  'React Native',
  'HTML5 & CSS3',
  'TailwindCSS',
  'Redux',
  'GraphQL',
  'MySQL',
  'Redis',
  'Elasticsearch',
  'DynamoDB',
  'Google Cloud (GCP)',
  'Microsoft Azure',
  'Terraform',
  'GitHub Actions',
  'Jenkins',
  'Linux',
  'Bash / Shell',
  'Microservices',
  'Distributed Systems',
  'PyTorch',
  'TensorFlow',
  'Scikit-Learn',
  'NLP',
  'LLMs',
  'Prompt Engineering',
  'Data Engineering',
  'Apache Spark',
  'Kafka',
  'Hadoop',
  'Pandas',
  'NumPy',
  'Figma',
  'UI/UX Design',
  'User Research',
  'Product Management',
  'Product Strategy',
  'Agile / Scrum',
  'Jira',
  'Unit Testing',
  'Jest',
  'Cypress',
  'Playwright',
  'Cybersecurity',
  'Ethical Hacking',
  'OAuth / JWT',
  'Webpack',
  'Vite',
  'WebSockets',
]

export const SKILL_OPTIONS = Array.from(
  new Set([...DEFAULT_SKILLS, ...SUGGESTED_SKILLS, 'Communication', 'Leadership'])
)

export const EMPLOYMENT_TYPE_OPTIONS = [
  'Full-time',
  'Part-time',
  'Contract',
  'Internship',
  'Freelance',
]

export const TIME_PERIOD_OPTIONS = [
  'Jan 2024 - Dec 2024',
  'Jan 2023 - Dec 2023',
  'Last 6 months',
  'Last 12 months',
  'Q1 2024',
  'Q2 2024',
  'Q3 2024',
  'Q4 2024',
  'Ongoing',
]

export const WORK_MODE_OPTIONS = [
  'Remote',
  'Hybrid',
  'On-site',
  'Flexible',
]

export const SALARY_OPTIONS = [
  '4–8 LPA',
  '8–12 LPA',
  '12–18 LPA',
  '18–25 LPA',
  '25–40 LPA',
  '40+ LPA',
]

export function createEmptyExperience(): WorkExperience {
  return {
    id: crypto.randomUUID(),
    jobTitle: '',
    company: '',
    employmentType: 'Full-time',
    startDate: '',
    endDate: '',
    currentlyWorking: false,
    location: '',
    responsibilities: '',
  }
}

export function createEmptyMetric(): PerformanceMetric {
  return {
    id: crypto.randomUUID(),
    metric: '',
    contribution: '',
    impact: '',
    timePeriod: '',
  }
}

/** Legacy onboarding demo rows — treat as empty when loading saved profiles. */
export function isDemoMetrics(metrics: PerformanceMetric[] | undefined): boolean {
  if (!metrics?.length || metrics.length !== 2) return false
  return metrics.every(
    (m) =>
      (m.id === 'metric-1' || m.id === 'metric-2') &&
      (m.metric === 'Increased Application Speed' ||
        m.metric === 'Reduced Bug Reports'),
  )
}

export function normalizeMetrics(
  metrics: PerformanceMetric[] | undefined,
): PerformanceMetric[] {
  if (!metrics?.length || isDemoMetrics(metrics)) return [createEmptyMetric()]
  return metrics
}

export function createEmptyCertification(): Certification {
  return {
    id: crypto.randomUUID(),
    name: '',
    organization: '',
    dateEarned: '',
    credentialId: '',
  }
}

export const initialFormData: ProfileFormData = {
  resumeFile: null,
  resumeName: null,
  whoAreYou: '',
  whatDrivesYou: '',
  keyStrengths: '',
  currentRole: '',
  totalExperience: 'Fresher / 0 years',
  currentLocation: '',
  noticePeriod: '',
  skills: [...DEFAULT_SKILLS],
  experienceSummary: '',
  workExperiences: [],
  noPriorWorkExperience: false,
  achievements: [''],
  metrics: [createEmptyMetric()],
  awards: [''],
  certifications: [createEmptyCertification()],
  selfRating: 0,
  preferredRoles: [],
  preferredLocations: [],
  workMode: '',
  salaryExpectation: '',
  interviewNotes: '',
  resumeText: '',
}
