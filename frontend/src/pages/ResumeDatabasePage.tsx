import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
import { Score } from '../components/Score'
import { useDialog } from '../components/useDialog'
import { extractResumeText, parseResumeFile } from '../lib/resumeParser'
import { getUser, type InterviewResult } from '../lib/store'
import { ensureApiSession } from '../lib/apiSession'
import { filterJobSeekerCandidates } from '../lib/employerCandidateUtils'
import { fetchOrganizationCandidates } from '../lib/vendorApi'
import { resumeHeadline } from '../lib/applicantSearch'
import type { OrgCandidateRecord } from '../lib/vendorApi'
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

/** Before: one key for every account in this browser, holding the server's candidates (contact details included). */
const LEGACY_VAULT_STORAGE_KEY = 'hireright.talentVault'
/** Per account: only the resumes uploaded in this browser, and the recruiter's status for server candidates. */
const vaultStorageKey = (email: string | undefined) => `hireright.talentVault.${(email || 'anon').toLowerCase()}`
const vaultStatusKey = (email: string | undefined) => `hireright.talentVault.status.${(email || 'anon').toLowerCase()}`

type VaultStatus = StoredResumeCandidate['status']
const VAULT_STATUSES: VaultStatus[] = ['New', 'Screening', 'Shortlisted', 'Technical', 'Hired', 'Rejected']

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the change still applies for this visit */
  }
}

/** The application's own status where it maps onto the vault's list; anything else starts as New. */
function vaultStatusFromServer(status: string | undefined): VaultStatus {
  const s = String(status || '').toLowerCase()
  if (s === 'shortlisted') return 'Shortlisted'
  if (s === 'rejected') return 'Rejected'
  if (s === 'hired') return 'Hired'
  return 'New'
}
/** Cards or rows rendered at once; "Show more" adds another page. */
const VAULT_PAGE_SIZE = 24

function orgRecordToVault(c: OrgCandidateRecord, statusOverrides: Record<string, VaultStatus> = {}): StoredResumeCandidate {
  const interviewResult = c.interviewResult as InterviewResult | undefined
  return {
    id: c.id,
    name: c.candidateName || c.candidateEmail,
    email: c.candidateEmail,
    phone: c.candidatePhone || '',
    currentRole: c.candidateRole || c.jobTitle || '',
    experienceYears: c.experienceYears || '',
    // The location the resume states (c.company is this organisation's own name, not where the candidate is).
    location: resumeHeadline(c.resumeText).location,
    skills: c.primarySkills || [],
    resumeName: (c.resumeName || 'resume').replace(/^HireRight profile$/, 'HireRighttt profile'),
    resumeText: c.resumeText || '',
    summary: c.resumeText ? c.resumeText.slice(0, 200) : '',
    interviewScore: interviewResult?.overall,
    interviewResult,
    status: VAULT_STATUSES.includes(statusOverrides[c.id]) ? statusOverrides[c.id] : vaultStatusFromServer(c.status),
    source: c.source || 'Database',
    createdAt: c.appliedAt,
  }
}


function loadStoredVault(email: string | undefined): StoredResumeCandidate[] {
  try {
    // The old shared key could hold another account's candidates: never read it, and remove it.
    localStorage.removeItem(LEGACY_VAULT_STORAGE_KEY)
  } catch {
    /* storage blocked */
  }
  const rows = readJson<StoredResumeCandidate[]>(vaultStorageKey(email), [])
  return Array.isArray(rows) ? rows.filter(isLocalUpload) : []
}

/** Resumes uploaded in this browser are not on the server, so they are kept when the API list arrives. */
function isLocalUpload(c: StoredResumeCandidate) {
  return c.id.startsWith('vault-upload-')
}

export function ResumeDatabasePage() {
  const accountEmail = getUser()?.email
  const [candidates, setCandidates] = useState<StoredResumeCandidate[]>(() => loadStoredVault(accountEmail))
  const [loading, setLoading] = useState(() => getUser()?.role === 'employer')
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const user = getUser()
    if (user?.role !== 'employer') return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    void (async () => {
      try {
        await ensureApiSession()
        const { candidates: rows } = await fetchOrganizationCandidates()
        if (cancelled) return
        const overrides = readJson<Record<string, VaultStatus>>(vaultStatusKey(user.email), {})
        const remote = filterJobSeekerCandidates(rows).map((c) => orgRecordToVault(c, overrides))
        setCandidates((prev) => [...prev.filter(isLocalUpload), ...remote])
      } catch (err) {
        if (cancelled) return
        console.warn('[talent-vault] load failed', err)
        setLoadError('We could not load your talent vault. Check your connection and try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [selectedCandidate, setSelectedCandidate] = useState<StoredResumeCandidate | null>(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const closeDossier = useCallback(() => setSelectedCandidate(null), [])
  const closeUpload = useCallback(() => {
    if (!uploading) setShowUploadModal(false)
  }, [uploading])
  const dossier = useDialog(Boolean(selectedCandidate), closeDossier)
  const upload = useDialog(showUploadModal, closeUpload)
  const [uploadError, setUploadError] = useState('')
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function saveVault(updated: StoredResumeCandidate[]) {
    setCandidates(updated)
    // Only this browser's uploads are stored; the server's candidates (with contact details) are never cached.
    writeJson(vaultStorageKey(accountEmail), updated.filter(isLocalUpload))
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

  const [visibleCount, setVisibleCount] = useState(VAULT_PAGE_SIZE)
  // A new search or filter starts again from the first page.
  useEffect(() => {
    setVisibleCount(VAULT_PAGE_SIZE)
  }, [filtered])
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  // KPIs
  const totalResumes = candidates.length
  const parsedCount = candidates.filter((c) => c.resumeText.trim()).length
  const scoredCount = candidates.filter((c) => typeof c.interviewScore === 'number').length
  const showSkeleton = loading && candidates.length === 0
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
        // Only what the parser found: missing fields stay empty instead of being invented.
        email: '',
        phone: '',
        currentRole: parsed.currentRole || '',
        experienceYears: parsed.totalExperience || '',
        location: parsed.currentLocation || '',
        skills: parsed.skills ?? [],
        resumeName: file.name,
        resumeText: rawText,
        summary: parsed.experienceSummary || parsed.whoAreYou || '',
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
    // Server candidates: keep the recruiter's status across reloads (it was lost on the next load).
    if (!id.startsWith('vault-upload-')) {
      const overrides = readJson<Record<string, VaultStatus>>(vaultStatusKey(accountEmail), {})
      writeJson(vaultStatusKey(accountEmail), { ...overrides, [id]: nextStatus })
    }
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
        <header className={ui.pageHeader}>
          <div>
            <h1 className={ui.pageTitle}>Talent vault</h1>
            <p className={ui.pageSub}>
              Every candidate’s resume, skills, contact details and proctored AI interview scores in one place.
            </p>
          </div>

          <div className={ui.pageActions}>
            <button type="button" className={ui.btnSecondary} onClick={exportToJson}>
              <HrIcon name="download" size={16} /> Export JSON
            </button>
            <button type="button" className={ui.btnPrimary} onClick={() => setShowUploadModal(true)}>
              <HrIcon name="upload" size={16} /> Upload resume
            </button>
          </div>
        </header>

        {loadError ? (
          <div className={`ds-alert ds-alert--error ${styles.loadError}`} role="alert">
            <span>{loadError}</span>
            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </button>
          </div>
        ) : null}

        <section className={styles.kpiGrid} aria-label="Vault numbers">
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Total candidates</span>
            <strong className={styles.kpiValue}>{totalResumes}</strong>
            <small className={styles.kpiHelp}>Across applications and onboarding</small>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Resumes parsed</span>
            <strong className={styles.kpiValue}>{parsedCount}</strong>
            <small className={styles.kpiHelp}>PDF and DOCX text extracted</small>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>AI interviewed</span>
            <strong className={styles.kpiValue}>{scoredCount}</strong>
            <small className={styles.kpiHelp}>{Math.round((scoredCount / (totalResumes || 1)) * 100)}% completion rate</small>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Average score</span>
            <strong className={styles.kpiValue}>
              {scoredCount ? (
                <>
                  {avgScore}
                  <span className={styles.kpiUnit}>/100</span>
                </>
              ) : (
                '—'
              )}
            </strong>
            <small className={styles.kpiHelp}>Proctored AI interview</small>
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
                Table
              </button>
            </div>
          </div>
        </section>

        <p className={styles.resultCount} role="status">
          {showSkeleton ? (
            'Loading candidates…'
          ) : (
            <>
              Showing <strong>{filtered.length}</strong> of {candidates.length} candidates
            </>
          )}
        </p>

        <h2 className="ds-sr-only">Applicants</h2>

        {showSkeleton ? (
          <div className={styles.candidateGrid} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`${styles.candidateCard} ${styles.cardSkeleton}`}>
                <span className={`ds-skeleton ds-skeleton-line ${styles.skW55}`} />
                <span className={`ds-skeleton ds-skeleton-line ${styles.skW35}`} />
                <span className={`ds-skeleton ds-skeleton-line ${styles.skW90}`} />
                <span className={`ds-skeleton ds-skeleton-line ${styles.skW70}`} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? null : viewMode === 'grid' ? (
          <div className={styles.candidateGrid}>
            {visible.map((c) => {
              const initials = c.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()

              return (
                <article key={c.id} className={styles.candidateCard}>
                  <div className={styles.cardTop}>
                    <div className={styles.avatarBox}>
                      <div className={styles.avatar} aria-hidden="true">{initials}</div>
                      <div className={styles.nameBlock}>
                        <h3 className={styles.candidateName}>{c.name}</h3>
                        <p className={styles.candidateRole}>{c.currentRole || 'Role not listed'}</p>
                      </div>
                    </div>

                    {typeof c.interviewScore === 'number' ? (
                      <Score value={c.interviewScore} />
                    ) : (
                      <span className={ui.pill}>Pending</span>
                    )}
                  </div>

                  <div className={styles.candidateMeta}>
                    {c.location && c.location !== '—' ? (
                      <span>
                        <HrIcon name="map-pin" size={14} /> {c.location}
                      </span>
                    ) : null}
                    {c.experienceYears ? (
                      <span>
                        <HrIcon name="calendar" size={14} /> {c.experienceYears}
                      </span>
                    ) : null}
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
                      onClick={() => setSelectedCandidate(c)}
                      aria-label={`View dossier for ${c.name}`}
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
                  <th scope="col" className={styles.num}>
                    Score
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ds-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className={ui.candidateName}>{c.name}</div>
                      <div className={ui.candidateContact}>{c.email}</div>
                    </td>
                    <td data-label="Role">
                      <div>{c.currentRole}</div>
                      <div className={ui.candidateContact}>{c.experienceYears}</div>
                    </td>
                    <td data-label="Location">{c.location || '—'}</td>
                    <td data-label="Skills">
                      <div className={styles.skillPills}>
                        {c.skills.slice(0, 3).map((s) => (
                          <span key={s} className={styles.skillPill}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Score" className={styles.num}>
                      {typeof c.interviewScore === 'number' ? (
                        <Score value={c.interviewScore} />
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

        {!showSkeleton && filtered.length > visible.length ? (
          <div className={styles.showMore}>
            <span>
              Showing {visible.length} of {filtered.length}
            </span>
            <button
              type="button"
              className={`${ui.btnSecondary} ${ui.btnSm}`}
              onClick={() => setVisibleCount((n) => n + VAULT_PAGE_SIZE)}
            >
              Show {Math.min(VAULT_PAGE_SIZE, filtered.length - visible.length)} more
            </button>
          </div>
        ) : null}

        {filtered.length === 0 &&
          !showSkeleton &&
          !(loadError && candidates.length === 0) &&
          (candidates.length === 0 ? (
            <div className="ds-empty">
              <span className="ds-empty__icon" aria-hidden="true">
                <HrIcon name="document" size={20} />
              </span>
              <h3 className="ds-empty__title">No candidates yet</h3>
              <p className="ds-empty__body">
                Upload a resume, or candidates will appear here once they apply to your jobs.
              </p>
            </div>
          ) : (
            <div className="ds-empty">
              <span className="ds-empty__icon" aria-hidden="true">
                <HrIcon name="search" size={20} />
              </span>
              <h3 className="ds-empty__title">No results match these filters</h3>
              <p className="ds-empty__body">Try a different search term, role or status.</p>
            </div>
          ))}
      </div>

      {/* Candidate dossier */}
      {selectedCandidate && (
          <div
            className={ui.modalOverlay}
            onClick={closeDossier}
            onKeyDown={dossier.onKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dossier-title"
          >
            <div
              ref={dossier.ref}
              tabIndex={-1}
              className={`${ui.modal} ${ui.modalReport}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={ui.modalHeader}>
                <div>
                  <h2 id="dossier-title">{selectedCandidate.name}</h2>
                  <p className={ui.modalSub}>
                    {['Full resume and profile', selectedCandidate.currentRole, selectedCandidate.location, `Source: ${selectedCandidate.source}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  data-autofocus
                  className={ui.closeBtn}
                  aria-label="Close dossier"
                  onClick={closeDossier}
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={ui.modalBody}>
                <div className={styles.dossierGrid}>
                  <div className={ui.summaryCard}>
                    <span className={ui.summaryLabel}>AI interview score</span>
                    <span className={ui.summaryValue}>
                      {typeof selectedCandidate.interviewScore === 'number' ? (
                        <Score value={selectedCandidate.interviewScore} size="lg" />
                      ) : (
                        '—'
                      )}
                    </span>
                    {typeof selectedCandidate.interviewScore !== 'number' ? (
                      <span className={ui.modalSub}>Pending interview</span>
                    ) : null}
                  </div>

                  <div className={ui.summaryCard}>
                    <span className={`${ui.summaryLabel} ${styles.summaryLabelGap}`}>Contact</span>
                    <dl className={ui.detailList}>
                      <div>
                        <dt>Email</dt>
                        <dd>{selectedCandidate.email || '—'}</dd>
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
                      className={`${styles.filterSelect} ${styles.dossierSelect}`}
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
                    <p className={ui.modalSub}>Your own label, kept in this browser. The applicant is not notified.</p>
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
                <button type="button" className={ui.btnSecondary} onClick={closeDossier}>
                  Close dossier
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Resume upload */}
      {showUploadModal && (
          <div
            className={ui.modalOverlay}
            onClick={closeUpload}
            onKeyDown={upload.onKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
          >
            <div ref={upload.ref} tabIndex={-1} className={ui.modal} onClick={(e) => e.stopPropagation()}>
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
                  onClick={closeUpload}
                  disabled={uploading}
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
                  data-autofocus
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
                  <p className={`ds-alert ds-alert--error ${styles.uploadError}`} role="alert">
                    {uploadError}
                  </p>
                )}
              </div>

              <div className={ui.modalFooter}>
                <button type="button" className={ui.btnSecondary} onClick={closeUpload} disabled={uploading}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
    </div>
  )
}

function statusTone(status: StoredResumeCandidate['status']): string {
  if (status === 'Shortlisted' || status === 'Hired') return ui.pillSuccess
  if (status === 'Technical') return ui.pillBrand
  if (status === 'Screening') return ui.pillWarning
  if (status === 'Rejected') return ui.pillDanger
  return ''
}
