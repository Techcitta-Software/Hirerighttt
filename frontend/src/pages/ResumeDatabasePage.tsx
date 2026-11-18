import { useEffect, useState, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
import { extractResumeText, parseResumeFile } from '../lib/resumeParser'
import { getUser, type InterviewResult } from '../lib/store'
import { ensureApiSession } from '../lib/apiSession'
import { filterJobSeekerCandidates } from '../lib/employerCandidateUtils'
import { fetchOrganizationCandidates } from '../lib/vendorApi'
import type { OrgCandidateRecord } from '../lib/vendorApi'
import { fadeUp, staggerContainer } from '../motion/variants'
import { HrIcon } from '../components/HrIcon'
import ui from './EmployerDashboard.module.css'
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

function orgRecordToVault(c: OrgCandidateRecord): StoredResumeCandidate {
  const interviewResult = c.interviewResult as InterviewResult | undefined
  return {
    id: c.id,
    name: c.candidateName || c.candidateEmail,
    email: c.candidateEmail,
    phone: c.candidatePhone || '',
    currentRole: c.candidateRole || c.jobTitle || '',
    experienceYears: c.experienceYears || '',
    location: c.company || '—',
    skills: c.primarySkills || [],
    resumeName: c.resumeName || 'resume',
    resumeText: c.resumeText || '',
    summary: c.resumeText ? c.resumeText.slice(0, 200) : '',
    interviewScore: interviewResult?.overall,
    interviewResult,
    status: 'New',
    source: c.source || 'Database',
    createdAt: c.appliedAt,
  }
}


function loadStoredVault(): StoredResumeCandidate[] {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as StoredResumeCandidate[]
  } catch {
    return []
  }
}

export function ResumeDatabasePage() {
  const [candidates, setCandidates] = useState<StoredResumeCandidate[]>(() => loadStoredVault())
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const user = getUser()
    if (user?.role !== 'employer') return
    void (async () => {
      try {
        await ensureApiSession()
        const { candidates: rows } = await fetchOrganizationCandidates()
        setCandidates(filterJobSeekerCandidates(rows).map(orgRecordToVault))
        setLoadError('')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Could not load talent vault from API.')
      }
    })()
  }, [])
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [selectedCandidate, setSelectedCandidate] = useState<StoredResumeCandidate | null>(null)
  const dossierCloseRef = useRef<HTMLButtonElement | null>(null)

  // Dossier modal: Escape closes it, and focus moves into it when it opens.
  useEffect(() => {
    if (!selectedCandidate) return
    dossierCloseRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedCandidate(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedCandidate])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function saveVault(updated: StoredResumeCandidate[]) {
    setCandidates(updated)
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(updated))
  }

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
    <div className={ui.pageBleed}>
    <div className={ui.page}>
      <div className={ui.shell}>
        <motion.header
          className={ui.pageHeader}
          initial="hidden"
          animate="show"
          variants={staggerContainer}
        >
          <div>
            <motion.h1 className={ui.pageTitle} variants={fadeUp}>
              Talent vault
            </motion.h1>
            <motion.p className={ui.pageSub} variants={fadeUp}>
              Every candidate’s resume, skills, contact details and proctored AI interview scores in one place.
            </motion.p>
          </div>

          <motion.div className={ui.pageActions} variants={fadeUp}>
            <button type="button" className={ui.btnSecondary} onClick={exportToJson}>
              <HrIcon name="download" size={16} /> Export JSON
            </button>
            <button type="button" className={ui.btnPrimary} onClick={() => setShowUploadModal(true)}>
              <HrIcon name="upload" size={16} /> Upload resume
            </button>
          </motion.div>
        </motion.header>

        {loadError ? (
          <p className={`ds-alert ds-alert--error ${styles.loadError}`} role="alert">
            {loadError}
          </p>
        ) : null}

        <section className={styles.kpiGrid} aria-label="Vault numbers">
          <div className={styles.kpiCard}>
            <span>Total candidates</span>
            <strong>{totalResumes}</strong>
            <small>Unified across ATS and onboarding</small>
          </div>
          <div className={styles.kpiCard}>
            <span>Resumes parsed</span>
            <strong>{totalResumes}</strong>
            <small>PDF / DOCX extracted</small>
          </div>
          <div className={styles.kpiCard}>
            <span>AI interviewed</span>
            <strong>{scoredCount}</strong>
            <small>{Math.round((scoredCount / (totalResumes || 1)) * 100)}% completion rate</small>
          </div>
          <div className={styles.kpiCard}>
            <span>Average score</span>
            <strong>{avgScore}%</strong>
            <small>Proctored AI interview</small>
          </div>
        </section>

        <section className={styles.toolbar} aria-label="Search and filter">
          <label className={styles.searchBox}>
            <HrIcon name="search" size={16} />
            <span className="ds-sr-only">Search candidates</span>
            <input
              type="search"
              placeholder="Search name, skill, email or resume text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <div className={styles.filterGroup}>
            <select
              className={styles.filterSelect}
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="All">All roles</option>
              <option value="Frontend">Frontend</option>
              <option value="Backend">Backend</option>
              <option value="Full Stack">Full Stack</option>
              <option value="Engineer">Engineering</option>
            </select>

            <select
              className={styles.filterSelect}
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All statuses</option>
              <option value="New">New</option>
              <option value="Screening">Screening</option>
              <option value="Shortlisted">Shortlisted</option>
              <option value="Technical">Technical</option>
              <option value="Hired">Hired</option>
            </select>

            <div className={styles.viewToggle} role="group" aria-label="View">
              <button
                type="button"
                className={`${styles.toggleBtn} ${viewMode === 'grid' ? styles.toggleActive : ''}`}
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                title="Grid view"
              >
                Grid
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${viewMode === 'table' ? styles.toggleActive : ''}`}
                onClick={() => setViewMode('table')}
                aria-pressed={viewMode === 'table'}
                title="Table view"
              >
                <HrIcon name="menu" size={14} /> Table
              </button>
            </div>
          </div>
        </section>

        <p className={styles.resultCount} role="status">
          Showing <strong>{filtered.length}</strong> of {candidates.length} candidates
        </p>

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
                <article
                  key={c.id}
                  className={styles.candidateCard}
                  onClick={() => setSelectedCandidate(c)}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.avatarBox}>
                      <div className={styles.avatar} aria-hidden="true">{initials}</div>
                      <div style={{ minWidth: 0 }}>
                        <h3 className={styles.candidateName}>{c.name}</h3>
                        <p className={styles.candidateRole}>{c.currentRole}</p>
                      </div>
                    </div>

                    {typeof c.interviewScore === 'number' ? (
                      <ScoreValue value={c.interviewScore} />
                    ) : (
                      <span className={ui.pill}>Pending</span>
                    )}
                  </div>

                  <div className={styles.candidateMeta}>
                    <span>
                      <HrIcon name="map-pin" size={14} /> {c.location}
                    </span>
                    <span>
                      <HrIcon name="calendar" size={14} /> {c.experienceYears}
                    </span>
                    <span>
                      <HrIcon name="tag" size={14} /> {c.status}
                    </span>
                  </div>

                  {c.summary && <p className={styles.resumeSnippet}>{c.summary}</p>}

                  <div className={styles.skillPills}>
                    {c.skills.slice(0, 5).map((s) => (
                      <span key={s} className={styles.skillPill}>
                        {s}
                      </span>
                    ))}
                    {c.skills.length > 5 && <span className={styles.skillMore}>+{c.skills.length - 5}</span>}
                  </div>

                  <div className={styles.cardFooter}>
                    <span className={styles.resumeFileBadge}>
                      <HrIcon name="document" size={14} /> <span>{c.resumeName || 'Resume PDF'}</span>
                    </span>
                    <button
                      type="button"
                      className={`${ui.btnSecondary} ${ui.btnSm}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedCandidate(c)
                      }}
                    >
                      View dossier
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className={`${ui.panel} ${ui.tableScroll}`}>
            <table className={`${ui.dataTable} ${styles.table} ${ui.stackOnPhone}`}>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Role and experience</th>
                  <th scope="col">Location</th>
                  <th scope="col">Skills</th>
                  <th scope="col">Score</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ds-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className={ui.candidateName}>{c.name}</div>
                      <div className={ui.candidateContact}>{c.email}</div>
                    </td>
                    <td data-label="Role">
                      <div>{c.currentRole}</div>
                      <div className={ui.candidateContact}>{c.experienceYears}</div>
                    </td>
                    <td data-label="Location">{c.location}</td>
                    <td data-label="Skills">
                      <div className={styles.skillPills}>
                        {c.skills.slice(0, 3).map((s) => (
                          <span key={s} className={styles.skillPill}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Score">
                      {typeof c.interviewScore === 'number' ? (
                        <ScoreValue value={c.interviewScore} />
                      ) : (
                        <span className={ui.docMuted}>—</span>
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={`${ui.pill} ${statusTone(c.status)}`}>{c.status}</span>
                    </td>
                    <td className={ui.rowActions}>
                      <button
                        type="button"
                        className={`${ui.btnSecondary} ${ui.btnSm}`}
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
          <div className={`ds-empty ${styles.emptyBlock}`}>
            <span className="ds-empty__icon" aria-hidden="true">
              <HrIcon name="search" size={20} />
            </span>
            <h3 className="ds-empty__title">No candidates found</h3>
            <p className="ds-empty__body">Try adjusting your search query or filter criteria.</p>
          </div>
        )}
      </div>

      {/* Candidate dossier */}
      <AnimatePresence>
        {selectedCandidate && (
          <div className={ui.modalOverlay} onClick={() => setSelectedCandidate(null)}>
            <motion.div
              className={`${ui.modal} ${ui.modalReport}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="dossier-title"
            >
              <div className={ui.modalHeader}>
                <div>
                  <h2 id="dossier-title">{selectedCandidate.name}</h2>
                  <p className={ui.modalSub}>
                    Full resume and profile · {selectedCandidate.currentRole} · {selectedCandidate.location} · Source:{' '}
                    {selectedCandidate.source}
                  </p>
                </div>
                <button
                  type="button"
                  ref={dossierCloseRef}
                  className={ui.closeBtn}
                  aria-label="Close dossier"
                  onClick={() => setSelectedCandidate(null)}
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={ui.modalBody}>
                <div className={styles.dossierGrid}>
                  <div className={ui.summaryCard}>
                    <span className={ui.summaryLabel}>AI interview score</span>
                    <span className={ui.summaryValue}>
                      {selectedCandidate.interviewScore ? `${selectedCandidate.interviewScore}%` : '—'}
                    </span>
                    {!selectedCandidate.interviewScore ? (
                      <span className={ui.modalSub}>Pending interview</span>
                    ) : null}
                  </div>

                  <div className={ui.summaryCard}>
                    <span className={ui.summaryLabel} style={{ marginBottom: 10 }}>
                      Contact
                    </span>
                    <dl className={ui.detailList}>
                      <div>
                        <dt>Email</dt>
                        <dd>{selectedCandidate.email}</dd>
                      </div>
                      <div>
                        <dt>Phone</dt>
                        <dd>{selectedCandidate.phone || '—'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className={ui.summaryCard}>
                    <label className={ui.summaryLabel} htmlFor="dossier-status">
                      Candidate status
                    </label>
                    <select
                      id="dossier-status"
                      className={styles.filterSelect}
                      style={{ marginTop: 8, width: '100%' }}
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

                <section className={ui.reportSection} aria-labelledby="dossier-skills">
                  <h3 id="dossier-skills" className={ui.reportSectionTitle}>
                    Extracted skills
                  </h3>
                  <div className={styles.skillPills}>
                    {selectedCandidate.skills.map((s) => (
                      <span key={s} className={styles.skillPill}>
                        {s}
                      </span>
                    ))}
                  </div>
                </section>

                <section className={ui.reportSection} aria-labelledby="dossier-resume">
                  <h3 id="dossier-resume" className={ui.reportSectionTitle}>
                    <span>
                      Extracted resume content{' '}
                      <span className={ui.reportSectionMeta}>({selectedCandidate.resumeName})</span>
                    </span>
                    <button
                      type="button"
                      className={`${ui.btnSecondary} ${ui.btnSm} ${copied ? styles.copiedBtn : ''}`}
                      onClick={() => copyResumeText(selectedCandidate.resumeText)}
                    >
                      {copied ? (
                        <>
                          <HrIcon name="check" size={14} /> Copied
                        </>
                      ) : (
                        <>
                          <HrIcon name="clipboard" size={14} /> Copy resume text
                        </>
                      )}
                    </button>
                  </h3>
                  <div className={styles.resumeFullBox}>
                    {selectedCandidate.resumeText || 'No raw text extracted.'}
                  </div>
                </section>

                {selectedCandidate.interviewResult && (
                  <section className={ui.reportSection}>
                    <VideoProctorTimeline
                      sessionId={selectedCandidate.interviewResult.sessionId}
                      candidateEmail={selectedCandidate.email}
                      logs={selectedCandidate.interviewResult.integrity?.logs}
                      proctoring={selectedCandidate.interviewResult.integrity?.proctoring}
                    />
                  </section>
                )}
              </div>

              <div className={ui.modalFooter}>
                <button type="button" className={ui.btnSecondary} onClick={() => setSelectedCandidate(null)}>
                  Close dossier
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Resume upload */}
      <AnimatePresence>
        {showUploadModal && (
          <div className={ui.modalOverlay} onClick={() => setShowUploadModal(false)}>
            <motion.div
              className={ui.modal}
              style={{ maxWidth: '520px' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="upload-title"
            >
              <div className={ui.modalHeader}>
                <div>
                  <h2 id="upload-title">Upload resume</h2>
                  <p className={ui.modalSub}>
                    PDF or DOCX. We extract the name, skills, contact details and full text and save it to the vault.
                  </p>
                </div>
                <button
                  type="button"
                  className={ui.closeBtn}
                  onClick={() => setShowUploadModal(false)}
                  aria-label="Close"
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={ui.modalBody}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  className={styles.dropzone}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  aria-busy={uploading}
                >
                  <span className={styles.dropzoneIcon} aria-hidden="true">
                    <HrIcon name="upload" size={20} />
                  </span>
                  <strong>{uploading ? 'Extracting and parsing resume…' : 'Choose a PDF or DOCX file'}</strong>
                  <span>Text is read in your browser (PDF and Word supported).</span>
                </button>

                {uploadError && (
                  <p className="ds-alert ds-alert--error" role="alert" style={{ marginTop: 12 }}>
                    {uploadError}
                  </p>
                )}
              </div>

              <div className={ui.modalFooter}>
                <button type="button" className={ui.btnSecondary} onClick={() => setShowUploadModal(false)}>
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </div>
  )
}

function statusTone(status: StoredResumeCandidate['status']): string {
  if (status === 'Shortlisted' || status === 'Hired') return ui.pillSuccess
  if (status === 'Screening' || status === 'Technical') return ui.pillWarning
  if (status === 'Rejected') return ui.pillDanger
  return ui.pillBrand
}

/** Score as a number with a coloured dot: green 75+, amber 50+, red below. */
function ScoreValue({ value }: { value: number }) {
  const rounded = Math.round(value)
  const tone = rounded >= 75 ? ui.toneGood : rounded >= 50 ? ui.toneMid : ui.toneLow
  return (
    <span className={ui.score} title="AI interview score">
      <span className={`${ui.scoreDot} ${tone}`} aria-hidden="true" />
      {rounded}
      <span className={ui.scoreMax}>/100</span>
    </span>
  )
}
