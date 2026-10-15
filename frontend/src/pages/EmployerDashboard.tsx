import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
import {
  deleteEmployerJob,
  getEmployerApplicants,
  getEmployerJobs,
  getUser,
  saveEmployerJob,
  updateEmployerApplicantStatus,
  type EmployerApplicant,
  type EmployerJob,
} from '../lib/store'
import { HrIcon } from '../components/HrIcon'
import {
  createVendorJob,
  fetchJobApplicants,
  fetchVendorJobs,
  patchApplicantStatus,
  fetchApplicantReport,
  type VendorApplicant,
  type VendorAssessmentReport,
} from '../lib/vendorApi'
import { ensureApiSession } from '../lib/apiSession'
import styles from './EmployerDashboard.module.css'

function mapVendorApplicant(a: VendorApplicant): EmployerApplicant {
  const statusMap: Record<string, EmployerApplicant['status']> = {
    applied: 'New',
    interviewed: 'In Review',
    shortlisted: 'Shortlisted',
    rejected: 'Rejected',
  }
  return {
    id: a.id,
    jobId: a.jobId,
    jobTitle: a.data.jobTitle || '',
    company: a.data.company || '',
    candidateName: a.data.candidateName || a.candidateEmail,
    candidateEmail: a.candidateEmail,
    candidatePhone: '',
    experienceYears: a.data.experienceYears || '',
    resumeName: null,
    resumeText: undefined,
    interviewResult: a.data.interviewResult as EmployerApplicant['interviewResult'],
    atsScore: a.data.atsScore,
    jdMatchScore: a.data.jdMatchScore,
    primarySkills: a.data.primarySkills,
    appliedAt: a.appliedAt,
    status: statusMap[a.status] || 'New',
  }
}

export function EmployerDashboard() {
  const user = getUser()
  const [jobs, setJobs] = useState<EmployerJob[]>(() =>
    getEmployerJobs(user?.email),
  )
  const [applicants, setApplicants] = useState<EmployerApplicant[]>(() => {
    const mine = getEmployerJobs(user?.email).map((j) => j.id)
    return getEmployerApplicants().filter((a) => mine.includes(a.jobId))
  })
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedApplicant, setSelectedApplicant] = useState<EmployerApplicant | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [apiReady, setApiReady] = useState(false)
  const [vendorReport, setVendorReport] = useState<VendorAssessmentReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      const ok = await ensureApiSession()
      if (!ok) return
      try {
        const { jobs: remoteJobs } = await fetchVendorJobs()
        if (remoteJobs.length) {
          setJobs(
            remoteJobs.map((j) => ({
              id: j.id,
              title: j.title,
              company: j.company,
              roleTrack: j.roleTrack || '',
              experienceLevel: j.experienceLevel || '',
              location: j.location || '',
              jobDescription: j.jobDescription || '',
              requiredSkills: j.requiredSkills || [],
              shareableCode: j.shareableCode,
              createdByEmail: user?.email || '',
              createdAt: j.createdAt,
            })),
          )
        }
        const allApplicants: EmployerApplicant[] = []
        for (const j of remoteJobs) {
          const { applicants } = await fetchJobApplicants(j.id)
          allApplicants.push(...applicants.map(mapVendorApplicant))
        }
        if (allApplicants.length) setApplicants(allApplicants)
        setApiReady(true)
      } catch {
        // keep localStorage data
      }
    })()
  }, [user?.email])

  // Form State for New Job
  const [title, setTitle] = useState('')
  const [roleTrack, setRoleTrack] = useState('Frontend Developer')
  const [experienceLevel, setExperienceLevel] = useState('3-5 years')
  const [location, setLocation] = useState('Remote / Hybrid')
  const [jobDescription, setJobDescription] = useState('')
  const [skillsStr, setSkillsStr] = useState('React, TypeScript, Redux, Node.js')

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !jobDescription.trim()) return

    const skills = skillsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    let newJob: EmployerJob | null = null
    try {
      await ensureApiSession()
      const created = await createVendorJob({
        title: title.trim(),
        company: user?.companyName || 'TechCitta Solutions',
        roleTrack,
        experienceLevel,
        location: location.trim(),
        jobDescription: jobDescription.trim(),
        requiredSkills: skills,
      })
      newJob = {
        id: created.job.id,
        title: created.job.title,
        company: created.job.company,
        roleTrack: created.job.roleTrack || roleTrack,
        experienceLevel: created.job.experienceLevel || experienceLevel,
        location: created.job.location || location,
        jobDescription: created.job.jobDescription || jobDescription.trim(),
        requiredSkills: created.job.requiredSkills || skills,
        shareableCode: created.job.shareableCode,
        createdByEmail: user?.email || '',
        createdAt: created.job.createdAt,
      }
    } catch {
      newJob = saveEmployerJob({
        title: title.trim(),
        company: user?.companyName || 'TechCitta Solutions',
        roleTrack,
        experienceLevel,
        location: location.trim(),
        jobDescription: jobDescription.trim(),
        requiredSkills: skills,
        createdByEmail: user?.email || 'employer@hireright.com',
      })
    }

    setJobs([newJob, ...jobs])
    setApplicants(getEmployerApplicants(newJob.id).concat(applicants))
    setShowCreateModal(false)
    setTitle('')
    setJobDescription('')
    setApiReady(true)
  }

  function handleDeleteJob(id: string) {
    deleteEmployerJob(id)
    setJobs(jobs.filter((j) => j.id !== id))
  }

  async function handleCopyLink(code: string) {
    const url = `${window.location.origin}/apply/${code}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt('Copy this application link', url)
    }
    setCopiedCode(code)
    window.setTimeout(() => setCopiedCode(null), 2500)
  }

  function handleStatusChange(id: string, newStatus: EmployerApplicant['status']) {
    updateEmployerApplicantStatus(id, newStatus)
    setApplicants(
      applicants.map((a) => (a.id === id ? { ...a, status: newStatus } : a)),
    )
    if (apiReady) {
      const apiStatus =
        newStatus === 'Shortlisted'
          ? 'shortlisted'
          : newStatus === 'Rejected'
            ? 'rejected'
            : newStatus === 'In Review'
              ? 'interviewed'
              : 'applied'
      void patchApplicantStatus(id, apiStatus).catch(() => {})
    }
  }

  const filteredApplicants = selectedJobId
    ? applicants.filter((a) => a.jobId === selectedJobId)
    : applicants

  useEffect(() => {
    if (!selectedApplicant || !apiReady) {
      setVendorReport(null)
      return
    }
    setReportLoading(true)
    void fetchApplicantReport(selectedApplicant.id)
      .then(({ report }) => setVendorReport(report))
      .catch(() => setVendorReport(null))
      .finally(() => setReportLoading(false))
  }, [selectedApplicant?.id, apiReady])

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />

        {/* Hero Section */}
        <motion.div
          className={styles.hero}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className={styles.heroContent}>
            <span className={styles.heroBadge}>
              <HrIcon name="building" size={16} /> EMPLOYER & RECRUITER PORTAL ·{' '}
              {user?.companyName || 'TechCitta Solutions'}
            </span>
            <h1>Employer AI Hiring Studio</h1>
            <p>
              Create exclusive private job openings, generate unique assessment links, and inspect candidates AI interview scores & video assessments.
            </p>
          </div>

          <button
            type="button"
            className={styles.createBtn}
            onClick={() => setShowCreateModal(true)}
          >
            <HrIcon name="plus" size={18} /> Create Private Job Opening
          </button>
        </motion.div>

        {/* Stats Row */}
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Active Openings</div>
            <div className={styles.statVal}>{jobs.length}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Total Candidates</div>
            <div className={styles.statVal}>{applicants.length}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Shortlisted Candidates</div>
            <div className={styles.statVal}>
              {applicants.filter((a) => a.status === 'Shortlisted').length}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Avg AI Score</div>
            <div className={styles.statVal}>
              {applicants.length > 0
                ? Math.round(
                    applicants.reduce(
                      (acc, a) => acc + (a.interviewResult?.overall || 0),
                      0,
                    ) / applicants.length,
                  ) + '%'
                : '—'}
            </div>
          </div>
        </div>

        {/* Active Openings Section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <HrIcon name="briefcase" size={22} /> Active Private Job Openings
            </h2>
            {selectedJobId && (
              <button
                type="button"
                className={styles.copyBtn}
                onClick={() => setSelectedJobId(null)}
              >
                Showing filter. Clear filter <HrIcon name="close" size={14} />
              </button>
            )}
          </div>

          {jobs.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No job openings created yet</h3>
              <p>Click "Create Private Job Opening" to generate your first link.</p>
            </div>
          ) : (
            <div className={styles.jobsGrid}>
              {jobs.map((job) => {
                const count = applicants.filter((a) => a.jobId === job.id).length
                const isCopied = copiedCode === job.shareableCode

                return (
                  <div key={job.id} className={styles.jobCard}>
                    <div>
                      <h3 className={styles.jobTitle}>{job.title}</h3>
                      <div className={styles.jobMeta}>
                        <span className={`${styles.badge} ${styles.badgePrimary}`}>
                          {job.roleTrack}
                        </span>
                        <span className={styles.badge}>{job.experienceLevel}</span>
                        <span className={styles.badge}>{job.location}</span>
                      </div>

                      <p className={styles.jobJdSnippet}>{job.jobDescription}</p>

                      {/* Shareable Link Box */}
                      <div className={styles.linkBox}>
                        <div className={styles.linkUrl}>
                          {`${window.location.origin}/apply/${job.shareableCode}`}
                        </div>
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={() => handleCopyLink(job.shareableCode)}
                        >
                          {isCopied ? (
                            <>
                              <HrIcon name="check" size={16} /> Link Copied!
                            </>
                          ) : (
                            <>
                              <HrIcon name="clipboard" size={16} /> Copy Link
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className={styles.cardFooter}>
                      <span className={styles.appCount}>
                        <HrIcon name="users" size={16} /> {count} Applicant(s)
                      </span>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button
                          type="button"
                          className={styles.viewBtn}
                          onClick={() => setSelectedJobId(job.id)}
                        >
                          Filter Applicants
                        </button>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteJob(job.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Applicants Table Section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <HrIcon name="users" size={22} /> Candidates & AI Interview Assessment Submissions
            </h2>
          </div>

          <div className={styles.tableCard}>
            {filteredApplicants.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No candidate interview submissions yet</h3>
                <p>Share your job link with candidates to start receiving AI assessment reports.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Target Job</th>
                    <th>Experience</th>
                    <th>ATS / AI Score</th>
                    <th>Integrity</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplicants.map((app) => {
                    const score = app.interviewResult?.overall ?? null
                    const ats = app.atsScore ?? null
                    const displayScore = score ?? ats ?? null
                    const scoreClass =
                      (displayScore ?? 0) >= 85
                        ? styles.scoreHigh
                        : (displayScore ?? 0) >= 70
                          ? styles.scoreMed
                          : styles.scoreLow

                    return (
                      <tr key={app.id}>
                        <td>
                          <div className={styles.candidateName}>{app.candidateName}</div>
                          <div className={styles.candidateContact}>
                            {app.candidateEmail} · {app.candidatePhone}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{app.jobTitle}</div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            {app.company}
                          </div>
                        </td>
                        <td>{app.experienceYears}</td>
                        <td>
                          {ats != null && (
                            <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>
                              ATS {ats}%
                              {app.jdMatchScore != null ? ` · JD ${app.jdMatchScore}%` : ''}
                            </div>
                          )}
                          <span className={`${styles.scorePill} ${scoreClass}`}>
                            <HrIcon name="flame" size={14} />{' '}
                            {score != null
                              ? `${score}% Interview`
                              : ats != null
                                ? `${ats}% ATS (pending interview)`
                                : '—'}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              color: '#059669',
                            }}
                          >
                            <HrIcon name="shield-check" size={14} /> Verified Candidate
                          </span>
                        </td>
                        <td>
                          <select
                            className={styles.statusSelect}
                            value={app.status}
                            onChange={(e) =>
                              handleStatusChange(
                                app.id,
                                e.target.value as EmployerApplicant['status'],
                              )
                            }
                          >
                            <option value="New">New</option>
                            <option value="Shortlisted">Shortlisted</option>
                            <option value="In Review">In Review</option>
                            <option value="Rejected">Rejected</option>
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.viewBtn}
                            onClick={() => setSelectedApplicant(app)}
                          >
                            Inspect AI Report →
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Create Job Opening Modal */}
        {showCreateModal && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2>
                  <HrIcon name="plus" size={20} /> Create Private Job Opening
                </h2>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setShowCreateModal(false)}
                  aria-label="Close"
                >
                  <HrIcon name="close" size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateJob}>
                <div className={styles.formGroup}>
                  <label>Job Opening Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Senior Frontend Developer"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className={styles.formGroup}>
                    <label>Role Track</label>
                    <select
                      value={roleTrack}
                      onChange={(e) => setRoleTrack(e.target.value)}
                    >
                      <option value="Frontend Developer">Frontend Developer</option>
                      <option value="Full Stack Engineer">Full Stack Engineer</option>
                      <option value="Backend Engineer">Backend Engineer</option>
                      <option value="AI/ML Engineer">AI/ML Engineer</option>
                      <option value="Product Analyst">Product Analyst</option>
                      <option value="DevOps Engineer">DevOps Engineer</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Experience Level</label>
                    <select
                      value={experienceLevel}
                      onChange={(e) => setExperienceLevel(e.target.value)}
                    >
                      <option value="0-2 years">0-2 years (Junior)</option>
                      <option value="3-5 years">3-5 years (Mid-Level)</option>
                      <option value="6+ years">6+ years (Senior / Lead)</option>
                    </select>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>Location</label>
                  <input
                    type="text"
                    placeholder="Hyderabad / Remote"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Custom Job Description (JD) for AI Interview</label>
                  <textarea
                    required
                    placeholder="Paste the full job description, requirements, responsibilities, and technologies here. Ava's AI interview will generate questions tailored directly to this JD."
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Required Skills (comma separated)</label>
                  <input
                    type="text"
                    placeholder="React, TypeScript, Redux, Node.js"
                    value={skillsStr}
                    onChange={(e) => setSkillsStr(e.target.value)}
                  />
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className={styles.createBtn}>
                    Generate Shareable Job Link →
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Detailed Applicant AI Evaluation Report Modal */}
        {selectedApplicant && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal} style={{ maxWidth: '780px' }}>
              <div className={styles.modalHeader}>
                <div>
                  <h2>
                    <HrIcon name="document" size={20} /> {selectedApplicant.candidateName} — AI
                    Assessment Report
                  </h2>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>
                    Applied for {selectedApplicant.jobTitle} ({selectedApplicant.company})
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setSelectedApplicant(null)}
                  aria-label="Close"
                >
                  <HrIcon name="close" size={18} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>CANDIDATE DETAILS</div>
                  <div style={{ marginTop: '6px', fontWeight: 700 }}>{selectedApplicant.candidateName}</div>
                  <div style={{ fontSize: '0.85rem', color: '#475569' }}>{selectedApplicant.candidateEmail}</div>
                  <div style={{ fontSize: '0.85rem', color: '#475569' }}>Phone: {selectedApplicant.candidatePhone}</div>
                  <div style={{ fontSize: '0.85rem', color: '#475569' }}>Experience: {selectedApplicant.experienceYears}</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>COMPOSITE HIRE SCORE</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#2563eb', marginTop: '4px' }}>
                    {reportLoading
                      ? '…'
                      : vendorReport?.compositeScore != null
                        ? `${vendorReport.compositeScore}%`
                        : selectedApplicant.interviewResult
                          ? `${selectedApplicant.interviewResult.overall}%`
                          : selectedApplicant.atsScore != null
                            ? `${selectedApplicant.atsScore}% ATS`
                            : 'Pending'}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: 6 }}>
                    ATS {selectedApplicant.atsScore ?? vendorReport?.atsScore ?? '—'}% · Interview{' '}
                    {selectedApplicant.interviewResult?.overall ?? vendorReport?.interviewOverall ?? '—'}%
                  </div>
                  {vendorReport?.recommendation && (
                    <div style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 700, marginTop: 8 }}>
                      {vendorReport.recommendation}
                    </div>
                  )}
                </div>
              </div>

              {vendorReport && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 8px', color: '#0f172a' }}>Executive summary</h4>
                  <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.55 }}>
                    {vendorReport.executiveSummary || vendorReport.atsAnalysis}
                  </p>
                  {vendorReport.atsAnalysis && (
                    <>
                      <h4 style={{ margin: '16px 0 8px', color: '#0f172a' }}>ATS & JD fit analysis</h4>
                      <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.55 }}>
                        {vendorReport.atsAnalysis}
                      </p>
                    </>
                  )}
                  {vendorReport.skillAlignment?.length > 0 && (
                    <>
                      <h4 style={{ margin: '16px 0 8px', color: '#0f172a' }}>Skill alignment</h4>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.88rem', color: '#334155' }}>
                        {vendorReport.skillAlignment.map((s) => (
                          <li key={s.skill}>
                            <strong>{s.skill}</strong> ({s.status}) — {s.evidence}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {vendorReport.risksAndGaps?.length > 0 && (
                    <>
                      <h4 style={{ margin: '16px 0 8px', color: '#0f172a' }}>Risks & gaps</h4>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.88rem', color: '#334155' }}>
                        {vendorReport.risksAndGaps.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {selectedApplicant.resumeText && (
                <div className={styles.formGroup}>
                  <label>Extracted Resume Summary</label>
                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', fontSize: '0.88rem', color: '#334155', border: '1px solid #e2e8f0' }}>
                    {selectedApplicant.resumeText}
                  </div>
                </div>
              )}

              {selectedApplicant.interviewResult && (
                <div>
                  <h4 style={{ margin: '18px 0 10px 0', color: '#0f172a' }}>Category breakdown</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {(vendorReport?.categoryNarratives?.length
                      ? vendorReport.categoryNarratives.map((cat) => ({
                          label: cat.label,
                          score: cat.score,
                          narrative: cat.narrative,
                        }))
                      : selectedApplicant.interviewResult.categories?.map((cat) => ({
                          label: cat.label,
                          score: cat.score,
                          narrative: '',
                        })) || []
                    ).map((cat) => (
                      <div key={cat.label} style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '10px 14px', borderRadius: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600, color: '#475569' }}>{cat.label}</span>
                          <span style={{ fontWeight: 800, color: '#2563eb' }}>{cat.score}%</span>
                        </div>
                        {cat.narrative ? (
                          <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#64748b' }}>{cat.narrative}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <h4 style={{ margin: '18px 0 10px 0', color: '#0f172a' }}>Candidate Answer Transcripts & Scores</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedApplicant.interviewResult.answers?.map((ans, idx) => (
                      <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '14px', borderRadius: '12px' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                          Q{idx + 1}: {ans.question}
                        </div>
                        <div style={{ fontSize: '0.88rem', color: '#334155', fontStyle: 'italic', marginBottom: '6px' }}>
                          "{ans.answer}"
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                          <span>Score: <strong>{ans.score}%</strong></span>
                          <span>Words: <strong>{ans.wordCount}</strong></span>
                          <span>Keywords: <strong>{ans.keywordsHit?.join(', ') || 'N/A'}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Real-time Proctoring & Misbehavior Event Logs */}
                  <div style={{ marginTop: '24px' }}>
                    <VideoProctorTimeline
                      logs={selectedApplicant.interviewResult.integrity?.logs}
                    />

                    {selectedApplicant.interviewResult.integrity?.logs &&
                    selectedApplicant.interviewResult.integrity.logs.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          maxHeight: '220px',
                          overflowY: 'auto',
                        }}
                      >
                        {selectedApplicant.interviewResult.integrity.logs.map((log) => {
                          const bg =
                            log.severity === 'ban'
                              ? '#fef2f2'
                              : log.severity === 'block'
                                ? '#fffbeb'
                                : '#f8fafc'
                          const border =
                            log.severity === 'ban'
                              ? '#fca5a5'
                              : log.severity === 'block'
                                ? '#fde68a'
                                : '#cbd5e1'
                          const textColor =
                            log.severity === 'ban'
                              ? '#dc2626'
                              : log.severity === 'block'
                                ? '#b45309'
                                : '#334155'
                          return (
                            <div
                              key={log.id}
                              style={{
                                background: bg,
                                border: `1px solid ${border}`,
                                padding: '10px 14px',
                                borderRadius: '10px',
                                fontSize: '0.85rem',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  fontWeight: 700,
                                  color: textColor,
                                  marginBottom: '2px',
                                }}
                              >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <HrIcon name="calendar" size={14} />[{log.formattedTime}]{' '}
                                  {log.eventType.replace(/_/g, ' ')}
                                </span>
                                {log.questionIndex && <span>Question #{log.questionIndex}</span>}
                              </div>
                              <div style={{ color: textColor }}>{log.message}</div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div
                        style={{
                          background: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          padding: '12px 16px',
                          borderRadius: '12px',
                          fontSize: '0.85rem',
                          color: '#047857',
                          fontWeight: 700,
                        }}
                      >
                        <HrIcon name="shield-check" size={16} /> Verified Integrity: No face
                        violations or misbehavior events detected during interview.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setSelectedApplicant(null)}
                >
                  Close Report
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  )
}
