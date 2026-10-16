import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
import { extractResumeText, parseResumeFile } from '../lib/resumeParser'
import {
  getEmployerApplicants,
  type EmployerApplicant,
  type InterviewResult,
} from '../lib/store'
import { loadAdminCandidates, type AdminCandidate } from '../lib/adminAts'
import { fadeUp, staggerContainer } from '../motion/variants'
import { getUser } from '../lib/store'
import { ensureApiSession } from '../lib/apiSession'
import { searchTalent, type TalentSearchHit } from '../lib/vendorApi'
import { HrIcon } from '../components/HrIcon'
import styles from './ResumeDatabasePage.module.css'

export type StoredResumeCandidate = {
  id: string
  name: string
  email: string
  phone: string
  currentRole: string
  experienceYears: string
  location: string
  skills: string[]
  resumeName: string
  resumeText: string
  summary: string
  interviewScore?: number
  interviewResult?: InterviewResult
  status: 'New' | 'Screening' | 'Shortlisted' | 'Technical' | 'Hired' | 'Rejected'
  source: string
  createdAt: string
}

const VAULT_STORAGE_KEY = 'hireright.talentVault'

const INITIAL_DEMO_VAULT: StoredResumeCandidate[] = [
  {
    id: 'vault-1',
    name: 'Sneha Iyer',
    email: 'sneha.iyer@example.com',
    phone: '+91 98765 43210',
    currentRole: 'Senior Frontend Developer',
    experienceYears: '5 years',
    location: 'Hyderabad, India',
    skills: ['React', 'TypeScript', 'Next.js', 'Redux', 'TailwindCSS', 'REST APIs'],
    resumeName: 'sneha_iyer_resume.pdf',
    resumeText: `SNEHA IYER
Senior Frontend Developer · Hyderabad, India
Email: sneha.iyer@example.com · Phone: +91 98765 43210

PROFESSIONAL SUMMARY
Senior Frontend Engineer with 5+ years of experience building high-performance web applications using React, TypeScript, Next.js, and modern state management. Led UI architecture for enterprise SaaS dashboards with 100K+ monthly active users.

WORK EXPERIENCE
Senior Frontend Developer — TechCita Solutions (2022 – Present)
• Architected scalable component library in TypeScript & React, improving development speed by 35%.
• Optimized bundle size by 42% using Vite and code-splitting techniques.
• Mentored 6 junior and mid-level developers in testing and design patterns.

Frontend Engineer — Infosys (2019 – 2022)
• Developed responsive client portals in React and Redux Toolkit.
• Integrated GraphQL and REST endpoints with optimistic UI updates.

EDUCATION
B.Tech in Computer Science — JNTU Hyderabad (2015 – 2019)`,
    summary: 'Senior Frontend Engineer with 5+ years building React & TypeScript enterprise web applications.',
    interviewScore: 92,
    interviewResult: {
      role: 'Frontend Developer',
      level: 'Senior',
      date: new Date().toISOString(),
      overall: 92,
      resumeFitScore: 95,
      agent: 'Ava (OpenRouter AI)',
      categories: [
        { label: 'Technical Depth', score: 94 },
        { label: 'Communication', score: 90 },
        { label: 'Problem Solving', score: 91 },
        { label: 'System Design', score: 93 },
      ],
      strengths: [
        'Exceptional depth in React performance optimization and TypeScript.',
        'Clear structured STAR communication during architecture questions.',
      ],
      improvements: ['Could elaborate on micro-frontend boundary isolation.'],
      answers: [],
      integrity: {
        faceViolations: 0,
        singlePersonOk: true,
        maxFacesSeen: 1,
      },
    },
    status: 'Shortlisted',
    source: 'Employer Application',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'vault-2',
    name: 'Rahul Kapoor',
    email: 'rahul.k@example.com',
    phone: '+91 91234 56789',
    currentRole: 'Backend Systems Engineer',
    experienceYears: '4 years',
    location: 'Bangalore, India',
    skills: ['Node.js', 'Python', 'FastAPI', 'PostgreSQL', 'Docker', 'Redis', 'AWS'],
    resumeName: 'rahul_kapoor_backend.pdf',
    resumeText: `RAHUL KAPOOR
Backend Systems Engineer · Bangalore, India
Email: rahul.k@example.com · Phone: +91 91234 56789

PROFESSIONAL SUMMARY
Backend Developer with 4 years building microservices, high-throughput asynchronous APIs, and real-time WebSocket infrastructure in Node.js and Python.

WORK EXPERIENCE
Backend Developer — CloudScale Systems (2021 – Present)
• Designed and maintained distributed microservices handling 15M requests/day in FastAPI & PostgreSQL.
• Implemented caching layers in Redis reducing database query latency by 60%.

EDUCATION
B.E. in Information Technology — RVCE Bangalore`,
    summary: 'Backend Engineer experienced in distributed microservices, FastAPI, Redis, and high-throughput pipelines.',
    interviewScore: 88,
    status: 'Screening',
    source: 'Direct Ingestion',
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: 'vault-3',
    name: 'Ananya Rao',
    email: 'ananya.rao@example.com',
    phone: '+91 99887 76655',
    currentRole: 'Full Stack Engineer',
    experienceYears: '3 years',
    location: 'Remote',
    skills: ['React', 'Node.js', 'TypeScript', 'MongoDB', 'Express', 'GraphQL'],
    resumeName: 'ananya_rao_fullstack.docx',
    resumeText: `ANANYA RAO
Full Stack Developer · Remote
Email: ananya.rao@example.com

SUMMARY
Full Stack Engineer with 3 years building end-to-end web applications with React, Node.js, and TypeScript. Passionate about responsive UI and clean RESTful API design.`,
    summary: 'Full Stack Developer proficient across modern JavaScript ecosystem and cloud deployments.',
    interviewScore: 85,
    status: 'Technical',
    source: 'Profile Upload',
    createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
  },
]

function loadStoredVault(): StoredResumeCandidate[] {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY)
    if (!raw) {
      // Merge initial demo + any employer applicants + admin candidates
      const empApplicants = getEmployerApplicants()
      const adminCandidates = loadAdminCandidates()

      const merged: StoredResumeCandidate[] = [...INITIAL_DEMO_VAULT]

      empApplicants.forEach((app: EmployerApplicant) => {
        if (!merged.some((m) => m.email === app.candidateEmail)) {
          merged.push({
            id: `vault-app-${app.id}`,
            name: app.candidateName,
            email: app.candidateEmail,
            phone: app.candidatePhone,
            currentRole: app.jobTitle,
            experienceYears: app.experienceYears,
            location: app.company ? `${app.company} Track` : 'Remote',
            skills: ['React', 'JavaScript', 'Node.js'],
            resumeName: app.resumeName || 'candidate_resume.pdf',
            resumeText: app.resumeText || '',
            summary: app.resumeText ? app.resumeText.slice(0, 160) : 'Applicant via shareable employer link.',
            interviewScore: app.interviewResult?.overall,
            interviewResult: app.interviewResult,
            status: app.status === 'Shortlisted' ? 'Shortlisted' : 'New',
            source: 'Job Assessment Link',
            createdAt: app.appliedAt,
          })
        }
      })

      adminCandidates.forEach((admin: AdminCandidate) => {
        if (!merged.some((m) => m.email === admin.email)) {
          merged.push({
            id: `vault-admin-${admin.id}`,
            name: admin.name,
            email: admin.email,
            phone: admin.phone,
            currentRole: admin.currentTitle,
            experienceYears: `${admin.totalExperienceYears} years`,
            location: admin.location,
            skills: admin.skills,
            resumeName: `${admin.name.toLowerCase().replace(/\s+/g, '_')}_resume.pdf`,
            resumeText: admin.aiSummary,
            summary: admin.aiSummary,
            interviewScore: admin.interviewScore,
            status: admin.stage === 'Shortlisted' ? 'Shortlisted' : 'Screening',
            source: admin.source,
            createdAt: admin.createdAt,
          })
        }
      })

      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(merged))
      return merged
    }
    return JSON.parse(raw) as StoredResumeCandidate[]
  } catch {
    return INITIAL_DEMO_VAULT
  }
}

export function ResumeDatabasePage() {
  const user = getUser()
  const isEmployer = user?.role === 'employer'
  const [candidates, setCandidates] = useState<StoredResumeCandidate[]>(() => loadStoredVault())
  const [query, setQuery] = useState('')
  const [experienceFilter, setExperienceFilter] = useState('')
  const [platformHits, setPlatformHits] = useState<TalentSearchHit[]>([])
  const [platformTotal, setPlatformTotal] = useState(0)
  const [platformLoading, setPlatformLoading] = useState(false)
  const [roleFilter, setRoleFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [selectedCandidate, setSelectedCandidate] = useState<StoredResumeCandidate | null>(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function saveVault(updated: StoredResumeCandidate[]) {
    setCandidates(updated)
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(updated))
  }

  useEffect(() => {
    if (!isEmployer) return
    const t = window.setTimeout(() => {
      void (async () => {
        if (!query.trim() && !experienceFilter.trim()) {
          setPlatformHits([])
          setPlatformTotal(0)
          return
        }
        setPlatformLoading(true)
        try {
          await ensureApiSession()
          const data = await searchTalent({
            q: query.trim(),
            experienceYears: experienceFilter.trim() || undefined,
            minScore: 0,
          })
          setPlatformHits(data.candidates || [])
          setPlatformTotal(data.total || 0)
        } catch {
          setPlatformHits([])
        } finally {
          setPlatformLoading(false)
        }
      })()
    }, 400)
    return () => window.clearTimeout(t)
  }, [isEmployer, query, experienceFilter])

  // Filter and search
  const filtered = useMemo(() => {
    return candidates.filter((c) => {
      const q = query.trim().toLowerCase()
      const matchesQuery =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.currentRole.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q) ||
        c.skills.some((s) => s.toLowerCase().includes(q)) ||
        c.resumeText.toLowerCase().includes(q)

      const matchesRole = roleFilter === 'All' || c.currentRole.toLowerCase().includes(roleFilter.toLowerCase())
      const matchesStatus = statusFilter === 'All' || c.status === statusFilter

      return matchesQuery && matchesRole && matchesStatus
    })
  }, [candidates, query, roleFilter, statusFilter])

  // KPIs
  const totalResumes = candidates.length
  const scoredCount = candidates.filter((c) => typeof c.interviewScore === 'number').length
  const avgScore = scoredCount
    ? Math.round(
        candidates.reduce((acc, c) => acc + (c.interviewScore || 0), 0) / scoredCount,
      )
    : 0

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const parsed = await parseResumeFile(file)
      const rawText = parsed.resumeText || (await extractResumeText(file))

      const newCandidate: StoredResumeCandidate = {
        id: `vault-upload-${Date.now()}`,
        name: parsed.fullName || file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
        email: `${(parsed.fullName || 'candidate').toLowerCase().replace(/\s+/g, '.')}@candidate.io`,
        phone: '+91 98000 12345',
        currentRole: parsed.currentRole || 'Software Engineer',
        experienceYears: parsed.totalExperience || '3 years',
        location: parsed.currentLocation || 'Remote',
        skills: parsed.skills && parsed.skills.length > 0 ? parsed.skills : ['JavaScript', 'TypeScript', 'React'],
        resumeName: file.name,
        resumeText: rawText,
        summary: parsed.experienceSummary || parsed.whoAreYou || 'Candidate parsed and ingested into Talent Vault.',
        status: 'New',
        source: 'Resume File Upload',
        createdAt: new Date().toISOString(),
      }

      const next = [newCandidate, ...candidates]
      saveVault(next)
      setShowUploadModal(false)
      setSelectedCandidate(newCandidate)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not parse resume file.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function updateCandidateStatus(id: string, nextStatus: StoredResumeCandidate['status']) {
    const next = candidates.map((c) => (c.id === id ? { ...c, status: nextStatus } : c))
    saveVault(next)
    if (selectedCandidate?.id === id) {
      setSelectedCandidate({ ...selectedCandidate, status: nextStatus })
    }
  }

  function copyResumeText(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function exportToJson() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(candidates, null, 2))
    const dlAnchor = document.createElement('a')
    dlAnchor.setAttribute('href', dataStr)
    dlAnchor.setAttribute('download', `hireright_talent_vault_${new Date().toISOString().slice(0, 10)}.json`)
    dlAnchor.click()
  }

  return (
    <div className={styles.page}>
      <SiteNav />

      <main className={styles.shell}>
        <motion.header
          className={styles.header}
          initial="hidden"
          animate="show"
          variants={staggerContainer}
        >
          <div>
            <motion.div className={styles.kicker} variants={fadeUp}>
              <HrIcon name="folder" size={18} /> TALENT & RESUME VAULT DATABASE
            </motion.div>
            <motion.h1 className={styles.title} variants={fadeUp}>
              All Candidate <em>Resumes & Profiles</em>
            </motion.h1>
            <motion.p className={styles.subtitle} variants={fadeUp}>
              Centralized repository storing every candidate's extracted resume, skills, contact dossier, and proctored AI interview scorecards.
            </motion.p>
          </div>

          <motion.div className={styles.headerActions} variants={fadeUp}>
            <button
              type="button"
              className={styles.uploadBtn}
              onClick={() => setShowUploadModal(true)}
            >
              <HrIcon name="plus" size={18} /> Ingest Resume File
            </button>
            <button
              type="button"
              className={styles.exportBtn}
              onClick={exportToJson}
            >
              <HrIcon name="download" size={18} /> Export Vault JSON
            </button>
          </motion.div>
        </motion.header>

        {/* KPI Cards */}
        <section className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <span>Total Candidates</span>
            <strong>{totalResumes}</strong>
            <small style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <HrIcon name="check" size={12} /> Unified across ATS & Onboarding
            </small>
          </div>
          <div className={styles.kpiCard}>
            <span>Resumes Parsed</span>
            <strong>{totalResumes}</strong>
            <small>PDF / DOCX extracted</small>
          </div>
          <div className={styles.kpiCard}>
            <span>AI Interviewed</span>
            <strong>{scoredCount}</strong>
            <small>{Math.round((scoredCount / (totalResumes || 1)) * 100)}% completion rate</small>
          </div>
          <div className={styles.kpiCard}>
            <span>Average Talent Score</span>
            <strong>{avgScore}%</strong>
            <small>Ava Proctored AI benchmark</small>
          </div>
        </section>

        {/* Search & Filter Toolbar */}
        <section className={styles.toolbar}>
          <div className={styles.searchBox}>
            <HrIcon name="search" size={18} />
            <input
              type="text"
              placeholder={
                isEmployer
                  ? 'Search platform talent — name, role, skills (use AND for boolean, e.g. React AND 5 years)'
                  : 'Search by candidate name, skill, email, or resume text...'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {isEmployer && (
            <div className={styles.searchBox}>
              <HrIcon name="clock" size={18} />
              <input
                type="text"
                placeholder="Years of experience filter (e.g. 5)"
                value={experienceFilter}
                onChange={(e) => setExperienceFilter(e.target.value)}
              />
            </div>
          )}

          <div className={styles.filterGroup}>
            <select
              className={styles.filterSelect}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="All">All Roles</option>
              <option value="Frontend">Frontend</option>
              <option value="Backend">Backend</option>
              <option value="Full Stack">Full Stack</option>
              <option value="Engineer">Engineering</option>
            </select>

            <select
              className={styles.filterSelect}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="New">New</option>
              <option value="Screening">Screening</option>
              <option value="Shortlisted">Shortlisted</option>
              <option value="Technical">Technical</option>
              <option value="Hired">Hired</option>
            </select>

            <div className={styles.viewToggle}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${viewMode === 'grid' ? styles.toggleActive : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grid view"
              >
                ⊞ Grid
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${viewMode === 'table' ? styles.toggleActive : ''}`}
                onClick={() => setViewMode('table')}
                title="Table view"
              >
                <HrIcon name="menu" size={16} /> Table
              </button>
            </div>
          </div>
        </section>

        {isEmployer && (query.trim() || experienceFilter.trim()) && (
          <section className={styles.toolbar} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>
              Platform talent (interviewed candidates){' '}
              {platformLoading ? '…' : `— ${platformTotal} match(es)`}
            </div>
            {platformHits.length === 0 && !platformLoading ? (
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                No indexed candidates yet. They appear after job seekers complete profiles and interviews.
              </p>
            ) : (
              <div className={styles.candidateGrid}>
                {platformHits.map((hit) => (
                  <div key={hit.userId} className={styles.candidateCard}>
                    <div className={styles.cardTop}>
                      <div>
                        <div className={styles.candidateName}>{hit.fullName}</div>
                        <div className={styles.candidateRole}>{hit.roleTitle || '—'}</div>
                        <div className={styles.candidateMeta}>
                          {hit.experienceYears || '—'} · {hit.location || '—'}
                        </div>
                        {typeof hit.interviewScore === 'number' && (
                          <div className={styles.scoreBadge}>Interview {hit.interviewScore}%</div>
                        )}
                      </div>
                    </div>
                    <p className={styles.cardSummary}>{hit.summary?.slice(0, 160) || hit.resumePreview}</p>
                    <div className={styles.skillTags}>
                      {(hit.skills || []).slice(0, 6).map((s) => (
                        <span key={s} className={styles.skillTag}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Candidate List Display */}
        {viewMode === 'grid' ? (
          <div className={styles.candidateGrid}>
            {filtered.map((c) => {
              const initials = c.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()

              return (
                <div
                  key={c.id}
                  className={styles.candidateCard}
                  onClick={() => setSelectedCandidate(c)}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.avatarBox}>
                      <div className={styles.avatar}>{initials}</div>
                      <div>
                        <h3 className={styles.candidateName}>{c.name}</h3>
                        <p className={styles.candidateRole}>{c.currentRole}</p>
                      </div>
                    </div>

                    {typeof c.interviewScore === 'number' ? (
                      <span
                        className={`${styles.scorePill} ${c.interviewScore >= 80 ? styles.scoreHigh : styles.scoreMed}`}
                      >
                        <HrIcon name="zap" size={14} /> {c.interviewScore}%
                      </span>
                    ) : (
                      <span className={`${styles.scorePill} styles.scorePending`}>
                        Pending
                      </span>
                    )}
                  </div>

                  <div className={styles.candidateMeta}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <HrIcon name="map-pin" size={14} /> {c.location}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <HrIcon name="calendar" size={14} /> {c.experienceYears}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <HrIcon name="tag" size={14} /> {c.status}
                    </span>
                  </div>

                  {c.summary && <div className={styles.resumeSnippet}>"{c.summary}"</div>}

                  <div className={styles.skillPills}>
                    {c.skills.slice(0, 5).map((s) => (
                      <span key={s} className={styles.skillPill}>
                        {s}
                      </span>
                    ))}
                    {c.skills.length > 5 && (
                      <span className={styles.skillPill}>+{c.skills.length - 5}</span>
                    )}
                  </div>

                  <div className={styles.cardFooter}>
                    <span className={styles.resumeFileBadge}>
                      <HrIcon name="document" size={14} /> {c.resumeName || 'Resume PDF'}
                    </span>
                    <button
                      type="button"
                      className={styles.viewDossierBtn}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedCandidate(c)
                      }}
                    >
                      View Dossier →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Role & Experience</th>
                  <th>Location</th>
                  <th>Skills</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong style={{ color: '#ffffff' }}>{c.name}</strong>
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{c.email}</div>
                    </td>
                    <td>
                      <div>{c.currentRole}</div>
                      <small style={{ color: '#94a3b8' }}>{c.experienceYears}</small>
                    </td>
                    <td>{c.location}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {c.skills.slice(0, 3).map((s) => (
                          <span key={s} className={styles.skillPill}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {typeof c.interviewScore === 'number' ? (
                        <span style={{ fontWeight: 800, color: '#38bdf8' }}>
                          {c.interviewScore}%
                        </span>
                      ) : (
                        <span style={{ color: '#64748b' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={styles.skillPill} style={{ background: '#0284c7', color: '#fff' }}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.viewDossierBtn}
                        onClick={() => setSelectedCandidate(c)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <div style={{ marginBottom: '12px', color: '#64748b' }}>
              <HrIcon name="search" size={40} />
            </div>
            <h3>No candidates found</h3>
            <p>Try adjusting your search query or filter criteria.</p>
          </div>
        )}
      </main>

      {/* Candidate Dossier & Resume Viewer Modal */}
      <AnimatePresence>
        {selectedCandidate && (
          <div
            className={styles.modalBackdrop}
            onClick={() => setSelectedCandidate(null)}
          >
            <motion.div
              className={styles.modal}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <div>
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <HrIcon name="document" size={22} /> {selectedCandidate.name} — Full Resume &
                    Profile Dossier
                  </h2>
                  <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                    {selectedCandidate.currentRole} · {selectedCandidate.location} · Source: {selectedCandidate.source}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setSelectedCandidate(null)}
                >
                  <HrIcon name="close" size={18} />
                </button>
              </div>

              <div className={styles.modalBody}>
                {/* Contact and Score Bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#131b2e', padding: '14px', borderRadius: '12px', border: '1px solid #1e293b' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>EMAIL & CONTACT</div>
                    <div style={{ fontWeight: 700, color: '#f8fafc', marginTop: '2px', fontSize: '0.9rem' }}>{selectedCandidate.email}</div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{selectedCandidate.phone}</div>
                  </div>

                  <div style={{ background: '#131b2e', padding: '14px', borderRadius: '12px', border: '1px solid #1e293b' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>AI INTERVIEW SCORE</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#38bdf8', marginTop: '2px' }}>
                      {selectedCandidate.interviewScore ? `${selectedCandidate.interviewScore}%` : 'Pending Interview'}
                    </div>
                  </div>

                  <div style={{ background: '#131b2e', padding: '14px', borderRadius: '12px', border: '1px solid #1e293b' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>CANDIDATE STATUS</div>
                    <select
                      className={styles.filterSelect}
                      style={{ marginTop: '6px', width: '100%' }}
                      value={selectedCandidate.status}
                      onChange={(e) =>
                        updateCandidateStatus(
                          selectedCandidate.id,
                          e.target.value as StoredResumeCandidate['status'],
                        )
                      }
                    >
                      <option value="New">New</option>
                      <option value="Screening">Screening</option>
                      <option value="Shortlisted">Shortlisted</option>
                      <option value="Technical">Technical</option>
                      <option value="Hired">Hired</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                  </div>
                </div>

                {/* Skills section */}
                <div>
                  <h4 style={{ color: '#f8fafc', marginBottom: '8px', fontSize: '0.9rem' }}>Extracted Skills</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {selectedCandidate.skills.map((s) => (
                      <span key={s} className={styles.skillPill} style={{ background: '#2563eb', padding: '4px 10px', fontSize: '0.8rem' }}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Full Extracted Resume Text Box */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 style={{ color: '#f8fafc', margin: 0, fontSize: '0.9rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <HrIcon name="document" size={18} /> Extracted Resume Content (
                        {selectedCandidate.resumeName})
                      </span>
                    </h4>
                    <button
                      type="button"
                      style={{
                        background: '#1e293b',
                        color: copied ? '#10b981' : '#38bdf8',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      onClick={() => copyResumeText(selectedCandidate.resumeText)}
                    >
                      {copied ? (
                        <>
                          <HrIcon name="check" size={14} /> Copied!
                        </>
                      ) : (
                        <>
                          <HrIcon name="clipboard" size={14} /> Copy Resume Text
                        </>
                      )}
                    </button>
                  </div>
                  <div className={styles.resumeFullBox}>
                    {selectedCandidate.resumeText || 'No raw text extracted.'}
                  </div>
                </div>

                {/* Proctored Video Timeline if interview was taken */}
                {selectedCandidate.interviewResult && (
                  <div>
                    <VideoProctorTimeline
                      logs={selectedCandidate.interviewResult.integrity?.logs}
                    />
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelModalBtn}
                  onClick={() => setSelectedCandidate(null)}
                >
                  Close Dossier
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Resume File Ingestion Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <div
            className={styles.modalBackdrop}
            onClick={() => setShowUploadModal(false)}
          >
            <motion.div
              className={styles.modal}
              style={{ maxWidth: '520px' }}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HrIcon name="document" size={22} /> Ingest Resume File
                </h2>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setShowUploadModal(false)}
                  aria-label="Close"
                >
                  <HrIcon name="close" size={18} />
                </button>
              </div>

              <div className={styles.modalBody}>
                <p style={{ color: '#94a3b8', fontSize: '0.88rem', margin: 0 }}>
                  Upload a candidate resume in PDF or DOCX format. The parser will automatically extract the name, skills, contact info, and full text, saving it into the Talent Vault.
                </p>

                <div
                  style={{
                    border: '2px dashed #3b82f6',
                    borderRadius: '14px',
                    padding: '36px 20px',
                    textAlign: 'center',
                    background: 'rgba(37, 99, 235, 0.05)',
                    cursor: 'pointer',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                  <div style={{ marginBottom: '8px', color: '#e11d48' }}>
                    <HrIcon name="folder" size={40} />
                  </div>
                  <strong style={{ color: '#ffffff', fontSize: '0.95rem' }}>
                    {uploading ? 'Extracting & Parsing Resume...' : 'Click to browse or drop PDF / DOCX'}
                  </strong>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>
                    Supports native PDF (pdfjs-dist) & DOCX (mammoth)
                  </div>
                </div>

                {uploadError && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', padding: '10px 14px', borderRadius: '10px', fontSize: '0.85rem' }}>
                    {uploadError}
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelModalBtn}
                  onClick={() => setShowUploadModal(false)}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SiteFooter />
    </div>
  )
}
