import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { AppFooter } from '../components/AppFooter'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import {
  candidateFullName,
  getApplications,
  getEmployerJobByCode,
  getProfile,
  getUser,
  isLoggedIn,
  type EmployerJob,
} from '../lib/store'
import { parseResumeFile } from '../lib/resumeParser'
import { HrIcon } from '../components/HrIcon'
import { isJobClosedError, resolvePublicJob } from '../lib/resolvePublicJob'
import { vendorJobToEmployerJob } from '../lib/employerCandidateUtils'
import { applyToPublicJob } from '../lib/vendorApi'
import { ensureApiSession } from '../lib/apiSession'
import { apiHealth, getApiToken } from '../lib/api'
import { isValidPhone, normalizePhone } from '../lib/phone'
import { canonicalJobPath, companySlugMatches, slugifyCompany } from '../lib/jobLink'
import { setPendingJob } from '../lib/pendingJobApply'
import styles from './CandidateApplyPage.module.css'
import { writeTargetJob } from '../lib/targetJob'
import { storeApplyResumeFile } from '../lib/resumeUploadApi'

/** Signed-in people get the app's own nav and footer; visitors get the same chrome as the rest of the public site. */
function ApplyNav() {
  return isLoggedIn() ? <SiteNav /> : <MarketingNavBar />
}

function ApplyFooter() {
  return isLoggedIn() ? <AppFooter /> : <MarketingFooter />
}

type ApplyJob = EmployerJob & { companySlug?: string }

function localJobToApply(job: EmployerJob): ApplyJob {
  return { ...job }
}

export function CandidateApplyPage() {
  const { code, companySlug } = useParams<{ code: string; companySlug?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const sessionUser = getUser()
  // Applying always happens from the candidate's own account. (This page used to create an account on the
  // fly with a default password when nobody was signed in.)
  const signedInCandidate = Boolean(
    isLoggedIn() && sessionUser && sessionUser.role !== 'employer' && getApiToken(),
  )
  const signedInEmployer = sessionUser?.role === 'employer'

  const [job, setJob] = useState<ApplyJob | null>(() => {
    if (!code) return null
    const local = getEmployerJobByCode(code)
    return local ? localJobToApply(local) : null
  })
  const [loadingJob, setLoadingJob] = useState(true)
  const [name, setName] = useState(() => {
    if (!sessionUser) return ''
    const resolved = candidateFullName()  // the name on the saved resume, else the signup name
    return resolved && resolved !== 'Candidate' ? resolved : sessionUser.name || ''
  })
  const [email] = useState(sessionUser?.email || '')
  const [phone, setPhone] = useState(sessionUser?.phone || '')
  // A signed-in candidate applies with the résumé and experience already on their profile (no forced re-upload,
  // no made-up "3 years"); choosing a file replaces it for this application only.
  const [savedProfile] = useState(() => (sessionUser ? getProfile() : null))
  const [experience, setExperience] = useState(() => savedProfile?.totalExperience || '')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeText, setResumeText] = useState(() => savedProfile?.resumeText?.trim() || '')
  const profileResumeName = savedProfile?.resumeText?.trim() ? savedProfile?.resumeName || 'Your profile résumé' : ''
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
          const canonical = canonicalJobPath('apply', code, companySlug, remote)
          if (canonical) {
            navigate(canonical, { replace: true })
            return
          }
          setJob(
            vendorJobToEmployerJob(remote, sessionUser?.email || 'candidate@hireright.com'),
          )
        } else if (!cancelled && isJobClosedError(remoteError)) {
          // Closed or unpublished by the employer: say so, even if an old local copy of the job exists.
          setJob(null)
          setError(remoteError)
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
  }, [code, companySlug, navigate, sessionUser?.email])

  /** Remember this job, then sign up / log in. Onboarding (or the return trip) completes the application. */
  function startAuth(path: '/signup' | '/login') {
    if (job) {
      const slug = companySlug || job.companySlug || slugifyCompany(job.company)
      setPendingJob(
        {
          shareableCode: job.shareableCode,
          companySlug: slug,
          jobId: job.id,
          title: job.title,
          company: job.company,
          role: job.roleTrack || job.title,
          level: job.experienceLevel || '',
          jd: job.jobDescription || '',
          primarySkills: job.requiredSkills,
        },
        slug,
      )
    }
    navigate(path, { state: { from: location.pathname, reason: 'job_apply' } })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResumeFile(file)
    try {
      const extracted = await parseResumeFile(file)
      setResumeText(extracted.resumeText || extracted.whoAreYou || `Resume: ${file.name}`)
      // The candidate's name comes from the resume they upload.
      if (extracted.fullName) {
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

    if (!signedInCandidate || !sessionUser) {
      setError('Sign in with your candidate account to apply.')
      return
    }
    const targetEmail = sessionUser.email.trim().toLowerCase()

    setLoading(true)
    setError('')
    setAtsSummary(null)

    try {
      const phoneNorm = normalizePhone(phone) || phone.trim()

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

        // Store the file itself (like onboarding) before applying: the application picks up the stored copy.
        await storeApplyResumeFile(resumeFile)
        const applied = await applyToPublicJob(
          job.shareableCode,
          {
            candidateName: name.trim(),
            candidateEmail: targetEmail,
            candidatePhone: phoneNorm,
            experienceYears: experience,
            resumeText: resumeText.trim(),
            resumeName: resumeFile ? resumeFile.name : profileResumeName || 'Candidate_Resume.pdf',
            source: 'shared_link',
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

        writeTargetJob({
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
          })
        return
      }

      writeTargetJob({
          title: job.title,
          company: job.company,
          role: job.roleTrack,
          level: job.experienceLevel,
          jd: job.jobDescription,
        })
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
        <ApplyNav />
        <main className={styles.shell} aria-busy="true">
          <h1 className="ds-sr-only">Loading job details</h1>
          <section className={styles.card} aria-hidden="true">
            <span className={`ds-skeleton ${styles.skeletonTitle}`} />
            <span className={`ds-skeleton ds-skeleton-line ${styles.skeletonMeta}`} />
            <span className="ds-skeleton ds-skeleton-line" />
            <span className="ds-skeleton ds-skeleton-line" />
          </section>
          <p className={styles.loadingText} role="status">
            Loading job details…
          </p>
        </main>
      </div>
    )
  }

  if (!job) {
    return (
      <div className={styles.page}>
        <ApplyNav />
        <main className={styles.shell}>
          <section className={`${styles.card} ${styles.notFound}`}>
            <span className={styles.notFoundIcon} aria-hidden="true">
              <HrIcon name="warning" size={20} />
            </span>
            {isJobClosedError(error) ? (
              <>
                <h1 className={styles.notFoundTitle}>This job is no longer accepting applications</h1>
                <p className={styles.muted}>
                  The employer has closed this opening. If you already applied, your application and interview
                  report are still with them.
                </p>
              </>
            ) : (
              <>
                <h1 className={styles.notFoundTitle}>Job link not found</h1>
                <p className={styles.muted}>
                  The job application link you accessed may have expired or been removed by the employer.
                </p>
              </>
            )}
            {error && !isJobClosedError(error) && !/not found|expired/i.test(error) && (
              <p className={`ds-alert ds-alert--error ${styles.notFoundAlert}`} role="alert">
                {error}
              </p>
            )}
            {isLoggedIn() ? (
              <button type="button" className={styles.primaryBtn} onClick={() => navigate('/jobs')}>
                Browse open roles
              </button>
            ) : (
              <button type="button" className={styles.primaryBtn} onClick={() => navigate('/')}>
                Go to home page
              </button>
            )}
          </section>
        </main>
        <ApplyFooter />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <ApplyNav />
      <motion.main
        className={styles.shell}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <section className={styles.card} aria-labelledby="apply-job-title">
          <header className={styles.jobHeader}>
            <h1 id="apply-job-title" className={styles.title}>
              {job.title}
            </h1>
            <p className={styles.company}>
              <HrIcon name="building" size={16} />
              <span>
                {job.company} · Private job invitation
              </span>
            </p>
          </header>

          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>
                <HrIcon name="map-pin" size={16} /> Location
              </dt>
              <dd>{job.location || '—'}</dd>
            </div>
            <div className={styles.fact}>
              <dt>
                <HrIcon name="briefcase" size={16} /> Experience
              </dt>
              <dd>{job.experienceLevel || '—'}</dd>
            </div>
            <div className={styles.fact}>
              <dt>
                <HrIcon name="target" size={16} /> Track
              </dt>
              <dd>{job.roleTrack || '—'}</dd>
            </div>
          </dl>

          {job.requiredSkills && job.requiredSkills.length > 0 && (
            <div className={styles.skillsBlock}>
              <h2 className={styles.subTitle}>Required skills</h2>
              <ul className={styles.tagList}>
                {job.requiredSkills.map((sk) => (
                  <li key={sk} className={styles.tag}>
                    {sk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {job.jobDescription && (
            <div className={styles.jdBlock}>
              <h2 className={styles.subTitle}>Job description and requirements</h2>
              <p className={styles.jdText}>{job.jobDescription}</p>
            </div>
          )}
        </section>

        {atsSummary ? (
          <section className={styles.card} aria-labelledby="apply-result-title">
            <div className={styles.resultHeader}>
              <span className={styles.resultIcon} aria-hidden="true">
                <HrIcon name="check" size={20} />
              </span>
              <div>
                <h2 id="apply-result-title" className={styles.sectionTitle}>
                  Application submitted
                </h2>
                <p className={styles.sectionSub}>
                  {job.company} has your application. Here is how your resume compares with this role.
                </p>
              </div>
            </div>

            <dl className={styles.scoreGrid}>
              <div className={styles.scoreTile}>
                <dt>Resume match</dt>
                <dd>
                  <span className={styles.scoreValue}>{Math.round(atsSummary.atsScore)}%</span>
                </dd>
              </div>
              <div className={styles.scoreTile}>
                <dt>Fit for this role</dt>
                <dd>
                  <span className={styles.scoreValue}>{Math.round(atsSummary.jdMatchScore)}%</span>
                </dd>
              </div>
            </dl>

            {atsSummary.summary && <p className={styles.resultSummary}>{atsSummary.summary}</p>}

            {atsSummary.matchedSkills.length > 0 && (
              <div className={styles.skillsBlock}>
                <h3 className={styles.subTitle}>Matched skills</h3>
                <ul className={styles.tagList}>
                  {atsSummary.matchedSkills.map((sk) => (
                    <li key={sk} className={`${styles.tag} ${styles.tagHave}`}>
                      {sk}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {atsSummary.missingSkills.length > 0 && (
              <div className={styles.skillsBlock}>
                <h3 className={styles.subTitle}>Skills to build</h3>
                <ul className={styles.tagList}>
                  {atsSummary.missingSkills.map((sk) => (
                    <li key={sk} className={`${styles.tag} ${styles.tagMissing}`}>
                      {sk}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className={styles.nextStep}>
              <p className={styles.nextStepText}>
                Next step: a short AI interview with Ava, built from your resume and this job.
              </p>
              <button type="button" className={styles.primaryBtn} onClick={() => navigate('/interview')}>
                Continue to AI interview
              </button>
            </div>
          </section>
        ) : signedInEmployer ? (
          <p className={`ds-alert ds-alert--warning ${styles.pageAlert}`} role="alert">
            This link is for candidates. Sign out of your employer account and sign in as a candidate to apply.
          </p>
        ) : !signedInCandidate ? (
          <section className={styles.card} aria-labelledby="apply-gate-title">
            <h2 id="apply-gate-title" className={styles.sectionTitle}>
              Sign in to apply
            </h2>
            <p className={styles.sectionSub}>
              Your application, resume and HireRighttt interview stay together in your candidate account. New
              here? Create a free account; after a short profile setup your application is sent automatically.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => startAuth('/login')}>
                I already have an account
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => startAuth('/signup')}>
                Create a free account
              </button>
            </div>
          </section>
        ) : (
          <section className={styles.card} aria-labelledby="apply-form-title">
            <h2 id="apply-form-title" className={styles.sectionTitle}>
              Apply with your resume
            </h2>
            <p className={styles.sectionSub}>
              We send your details and resume to {job.company}, then show how well your resume matches this role.
            </p>
            {getApplications().some((app) => app.jobId === job.id || (code && app.shareableCode === code)) ? (
              <p className={`ds-alert ds-alert--info ${styles.pageAlert}`} role="status">
                You already applied to this role. Submitting again updates your application.{' '}
                <Link to="/applications">View my applications</Link>
              </p>
            ) : null}

            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="apply-name" className={styles.label}>
                    Full name
                  </label>
                  <input
                    id="apply-name"
                    type="text"
                    required
                    autoComplete="name"
                    className={styles.input}
                    placeholder="e.g. Arjun Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="apply-email" className={styles.label}>
                    Email address
                  </label>
                  <input
                    id="apply-email"
                    type="email"
                    required
                    readOnly
                    aria-readonly="true"
                    aria-describedby="apply-email-help"
                    title="Applications are sent from the account you are signed in with."
                    className={styles.input}
                    value={email}
                  />
                  <p id="apply-email-help" className={styles.help}>
                    From your signed-in account.
                  </p>
                </div>

                <div className={styles.field}>
                  <label htmlFor="apply-phone" className={styles.label}>
                    Phone number
                  </label>
                  <input
                    id="apply-phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    className={styles.input}
                    placeholder="+91 98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="apply-experience" className={styles.label}>
                    Years of experience
                  </label>
                  <input
                    id="apply-experience"
                    type="text"
                    required
                    className={styles.input}
                    placeholder="e.g. 4 years"
                    value={experience}
                    onChange={(e) => setExperience(e.target.value)}
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span id="apply-resume-label" className={styles.label}>
                    Resume
                  </span>
                  <label className={styles.fileInputBox}>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt"
                      className={styles.fileInputNative}
                      aria-labelledby="apply-resume-label"
                      aria-describedby="apply-resume-help"
                      onChange={handleFileChange}
                    />
                    <span className={styles.fileIcon} aria-hidden="true">
                      <HrIcon name={resumeFile ? 'check' : 'upload'} size={20} />
                    </span>
                    <span className={styles.fileName}>
                      {resumeFile ? resumeFile.name : profileResumeName || 'Choose your resume file'}
                    </span>
                    <span id="apply-resume-help" className={styles.fileHint}>
                      {resumeFile
                        ? `File attached (${Math.round(resumeFile.size / 1024)} KB) · choose again to replace`
                        : profileResumeName
                          ? 'From your profile · choose a file to use a different résumé for this job'
                          : 'PDF, DOCX or TXT. Ava uses your resume for adaptive interview questions.'}
                    </span>
                  </label>
                </div>
              </div>

              <label className={styles.consentRow}>
                <input
                  type="checkbox"
                  checked={applyConsent}
                  onChange={(e) => setApplyConsent(e.target.checked)}
                  required
                />
                <span>
                  I consent to HireRighttt sharing my name, contact details, and resume with the employer for this
                  job, and processing my data as described in the <Link to="/privacy">Privacy Policy</Link>.
                </span>
              </label>

              {error && (
                <p className="ds-alert ds-alert--error" role="alert">
                  {error}
                </p>
              )}

              <div className={styles.formActions}>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={loading || !applyConsent}
                  aria-busy={loading || undefined}
                >
                  {loading ? (
                    <>
                      <span className="ds-spinner" aria-hidden="true" /> Submitting…
                    </>
                  ) : (
                    'Submit application'
                  )}
                </button>
              </div>
            </form>
          </section>
        )}
      </motion.main>
      <ApplyFooter />
    </div>
  )
}
