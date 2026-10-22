import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import {
  findUserByEmail,
  getEmployerJobByCode,
  getUser,
  saveUser,
  type EmployerJob,
} from '../lib/store'
import { parseResumeFile } from '../lib/resumeParser'
import { HrIcon } from '../components/HrIcon'
import { resolvePublicJob } from '../lib/resolvePublicJob'
import { vendorJobToEmployerJob } from '../lib/employerCandidateUtils'
import { applyToPublicJob } from '../lib/vendorApi'
import { ensureApiSession } from '../lib/apiSession'
import { apiHealth } from '../lib/api'
import { isValidPhone, normalizePhone } from '../lib/phone'
import { companySlugMatches } from '../lib/jobLink'
import styles from './CandidateApplyPage.module.css'

type ApplyJob = EmployerJob & { companySlug?: string }

function localJobToApply(job: EmployerJob): ApplyJob {
  return { ...job }
}

export function CandidateApplyPage() {
  const { code, companySlug } = useParams<{ code: string; companySlug?: string }>()
  const navigate = useNavigate()
  const sessionUser = getUser()

  const [job, setJob] = useState<ApplyJob | null>(() => {
    if (!code) return null
    const local = getEmployerJobByCode(code)
    return local ? localJobToApply(local) : null
  })
  const [loadingJob, setLoadingJob] = useState(true)
  const [name, setName] = useState(sessionUser?.name || '')
  const [email, setEmail] = useState(sessionUser?.email || '')
  const [phone, setPhone] = useState(sessionUser?.phone || '')
  const [experience, setExperience] = useState('3 years')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [applyConsent, setApplyConsent] = useState(false)
  const [atsSummary, setAtsSummary] = useState<{
    atsScore: number
    jdMatchScore: number
    matchedSkills: string[]
    missingSkills: string[]
    summary?: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!code) {
        setLoadingJob(false)
        return
      }
      setLoadingJob(true)
      const local = getEmployerJobByCode(code)
      if (local && companySlugMatches(local.company, companySlug)) {
        if (!cancelled) setJob(localJobToApply(local))
      }
      try {
        const { job: remote, error: remoteError } = await resolvePublicJob(code, companySlug)
        if (!cancelled && remote) {
          setJob(
            vendorJobToEmployerJob(remote, sessionUser?.email || 'candidate@hireright.com'),
          )
        } else if (!cancelled && !local && remoteError) {
          setError(remoteError)
        }
      } catch {
        // keep local demo job if any
      } finally {
        if (!cancelled) setLoadingJob(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, companySlug, sessionUser?.email])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResumeFile(file)
    try {
      const extracted = await parseResumeFile(file)
      setResumeText(extracted.resumeText || extracted.whoAreYou || `Resume: ${file.name}`)
      if (extracted.fullName && !name) {
        setName(extracted.fullName)
      }
    } catch {
      setResumeText(`Resume file: ${file.name}`)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !phone.trim()) {
      setError('Please fill in your basic details (Name, Email, Phone).')
      return
    }
    if (!isValidPhone(phone)) {
      setError('Enter a valid mobile number (10–15 digits).')
      return
    }
    if (!job) {
      setError('Invalid job application link.')
      return
    }
    if (resumeText.trim().length < 30) {
      setError('Upload a resume with enough detail (at least a short summary).')
      return
    }
    if (!applyConsent) {
      setError('Please confirm consent to share your application data with the employer.')
      return
    }

    const targetEmail = email.trim().toLowerCase()
    if (findUserByEmail(targetEmail)?.role === 'employer') {
      setError('This email is registered as an employer. Use a candidate email to apply.')
      return
    }

    setLoading(true)
    setError('')
    setAtsSummary(null)

    try {
      const phoneNorm = normalizePhone(phone) || phone.trim()
      saveUser(
        {
          name: name.trim(),
          email: targetEmail,
          password: sessionUser?.password || 'password123',
          role: 'jobseeker',
          phone: phoneNorm,
        },
        true,
      )

      const useApi = await apiHealth()
      if (useApi) {
        const sessionOk = await ensureApiSession()
        if (!sessionOk) {
          navigate('/login', {
            state: {
              from: window.location.pathname,
              prefillEmail: targetEmail,
            },
          })
          return
        }

        const applied = await applyToPublicJob(
          job.shareableCode,
          {
            candidateName: name.trim(),
            candidateEmail: targetEmail,
            candidatePhone: phoneNorm,
            experienceYears: experience,
            resumeText: resumeText.trim(),
            resumeName: resumeFile ? resumeFile.name : 'Candidate_Resume.pdf',
          },
          companySlug || job.companySlug,
        )

        setAtsSummary({
          atsScore: applied.ats.atsScore,
          jdMatchScore: applied.ats.jdMatchScore,
          matchedSkills: applied.ats.matchedSkills || [],
          missingSkills: applied.ats.missingSkills || [],
          summary: applied.ats.summary,
        })

        sessionStorage.setItem(
          'hireright.targetJob',
          JSON.stringify({
            title: job.title,
            company: job.company,
            role: job.roleTrack,
            level: job.experienceLevel,
            jd: job.jobDescription,
            jobId: applied.job.id,
            applicationId: applied.applicationId,
            organizationId: applied.organizationId,
            primarySkills: applied.ats.primarySkills || job.requiredSkills,
            atsScore: applied.ats.atsScore,
            jdMatchScore: applied.ats.jdMatchScore,
          }),
        )
        return
      }

      sessionStorage.setItem(
        'hireright.targetJob',
        JSON.stringify({
          title: job.title,
          company: job.company,
          role: job.roleTrack,
          level: job.experienceLevel,
          jd: job.jobDescription,
        }),
      )
      navigate('/interview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your application.')
    } finally {
      setLoading(false)
    }
  }

  if (loadingJob) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <SiteNav />
          <p className={styles.loadingText}>Loading job details…</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <SiteNav />
          <div className={styles.card} style={{ textAlign: 'center', marginTop: '60px' }}>
            <h2 className={styles.errorTitle}>
              <HrIcon name="warning" size={22} /> Private Job Link Not Found
            </h2>
            <p className={styles.muted}>
              The job application link you accessed may have expired or been removed by the employer.
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <button
              type="button"
              className={styles.submitBtn}
              onClick={() => navigate('/signup')}
              style={{ maxWidth: '240px', margin: '20px auto 0' }}
            >
              Explore Public Jobs →
            </button>
          </div>
        </div>
        <SiteFooter />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />

        <motion.div
          className={styles.card}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className={styles.companyBadge}>
            <HrIcon name="building" size={16} /> PRIVATE JOB INVITATION · {job.company}
          </span>
          <h1 className={styles.title}>{job.title}</h1>

          <div className={styles.metaRow}>
            <span className={styles.badge}>Track: {job.roleTrack}</span>
            <span className={styles.badge}>Experience: {job.experienceLevel}</span>
            <span className={styles.badge}>Location: {job.location}</span>
          </div>

          <div className={styles.jdBox}>
            <h3 className={styles.jdHeading}>
              <HrIcon name="document" size={20} /> Job Description & Requirements
            </h3>
            <p>{job.jobDescription}</p>

            {job.requiredSkills && job.requiredSkills.length > 0 && (
              <div className={styles.skillsBlock}>
                <strong className={styles.skillsLabel}>REQUIRED SKILLS:</strong>
                <div className={styles.skillsRow}>
                  {job.requiredSkills.map((sk) => (
                    <span key={sk} className={styles.skillPill}>
                      {sk}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {atsSummary ? (
            <div className={styles.atsCard}>
              <h3 className={styles.atsTitle}>Application submitted — ATS match</h3>
              <div className={styles.atsScores}>
                <div>
                  <span className={styles.atsLabel}>Resume fit</span>
                  <strong>{Math.round(atsSummary.atsScore)}%</strong>
                </div>
                <div>
                  <span className={styles.atsLabel}>JD match</span>
                  <strong>{Math.round(atsSummary.jdMatchScore)}%</strong>
                </div>
              </div>
              {atsSummary.summary && <p className={styles.muted}>{atsSummary.summary}</p>}
              {atsSummary.matchedSkills.length > 0 && (
                <p className={styles.muted}>
                  <strong>Matched:</strong> {atsSummary.matchedSkills.join(', ')}
                </p>
              )}
              {atsSummary.missingSkills.length > 0 && (
                <p className={styles.muted}>
                  <strong>Gaps:</strong> {atsSummary.missingSkills.join(', ')}
                </p>
              )}
              <button
                type="button"
                className={styles.submitBtn}
                onClick={() => navigate('/interview')}
              >
                Continue to AI interview →
              </button>
            </div>
          ) : (
            <>
              <h3 className={styles.formSectionTitle}>
                <HrIcon name="form" size={22} /> Apply with resume (sign-in required on server)
              </h3>

              <form onSubmit={handleSubmit}>
                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Full Name</label>
                    <input
                      type="text"
                      required
                      className={styles.input}
                      placeholder="e.g. Arjun Sharma"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Email Address</label>
                    <input
                      type="email"
                      required
                      className={styles.input}
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Phone Number</label>
                    <input
                      type="tel"
                      required
                      className={styles.input}
                      placeholder="+91 98765 43210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Years of Experience</label>
                    <input
                      type="text"
                      required
                      className={styles.input}
                      placeholder="e.g. 4 years"
                      value={experience}
                      onChange={(e) => setExperience(e.target.value)}
                    />
                  </div>

                  <div className={styles.formGroupFull}>
                    <label className={styles.label}>Upload Resume (PDF / DOCX)</label>
                    <label className={styles.fileInputBox}>
                      <input
                        type="file"
                        accept=".pdf,.docx,.txt"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                      />
                      <div style={{ marginBottom: '6px', color: '#6036eb' }}>
                        <HrIcon name="folder" size={32} />
                      </div>
                      <div style={{ fontWeight: 700, color: '#141638' }}>
                        {resumeFile ? resumeFile.name : 'Click to Upload Resume PDF'}
                      </div>
                      <div className={styles.muted} style={{ marginTop: '2px', fontSize: '0.8rem' }}>
                        {resumeFile ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <HrIcon name="check" size={14} /> File attached (
                            {Math.round(resumeFile.size / 1024)} KB)
                          </span>
                        ) : (
                          'Ava uses your resume for adaptive interview questions'
                        )}
                      </div>
                    </label>
                  </div>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                <label className={styles.consentRow}>
                  <input
                    type="checkbox"
                    checked={applyConsent}
                    onChange={(e) => setApplyConsent(e.target.checked)}
                    required
                  />
                  <span>
                    I consent to HireRight sharing my name, contact details, and resume with the employer for
                    this job, and processing my data as described in the{' '}
                    <Link to="/privacy">Privacy Policy</Link>.
                  </span>
                </label>

                <button type="submit" className={styles.submitBtn} disabled={loading || !applyConsent}>
                  {loading ? 'Submitting application…' : 'Submit & start AI interview →'}
                </button>
              </form>
            </>
          )}
        </motion.div>
      </div>
      <SiteFooter />
    </div>
  )
}
