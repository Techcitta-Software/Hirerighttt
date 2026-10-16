import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import {
  findUserByEmail,
  getEmployerJobByCode,
  getUser,
  saveEmployerApplicant,
  saveUser,
  type EmployerJob,
} from '../lib/store'
import { parseResumeFile } from '../lib/resumeParser'
import { applyToPublicJob, fetchPublicJob, type VendorJob } from '../lib/vendorApi'
import { ensureApiSession } from '../lib/apiSession'
import { apiSaveProfile } from '../lib/api'
import { HrIcon } from '../components/HrIcon'
import styles from './CandidateApplyPage.module.css'

export function CandidateApplyPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const user = getUser()

  const [job, setJob] = useState<EmployerJob | null>(() =>
    code ? getEmployerJobByCode(code) : null,
  )
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phone, setPhone] = useState('')
  const [experience, setExperience] = useState('3 years')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function vendorJobToLocal(v: VendorJob): EmployerJob {
    return {
      id: v.id,
      title: v.title,
      company: v.company,
      roleTrack: v.roleTrack || 'Software Engineer',
      experienceLevel: v.experienceLevel || '2–5 years',
      location: v.location || 'Remote',
      jobDescription: v.jobDescription || '',
      requiredSkills: v.requiredSkills || [],
      shareableCode: v.shareableCode,
      createdByEmail: '',
      createdAt: v.createdAt,
    }
  }

  useEffect(() => {
    if (!code) return
    const local = getEmployerJobByCode(code)
    if (local) {
      setJob(local)
      return
    }
    void fetchPublicJob(code)
      .then(({ job: remote }) => setJob(vendorJobToLocal(remote)))
      .catch(() => setJob(null))
  }, [code])

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
    if (!job) {
      setError('Invalid job application link.')
      return
    }

    const targetEmail = email.trim().toLowerCase()
    if (findUserByEmail(targetEmail)?.role === 'employer') {
      setError('This email is registered as an employer. Use a candidate email to apply.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const account = saveUser(
        {
          name: name.trim(),
          email: targetEmail,
          password: 'password123',
          role: 'jobseeker',
        },
        true,
      )

      const resumePayload =
        resumeText || `${name.trim()} - ${job.title} applicant`

      let applicantId = ''
      let applicationId = ''
      let organizationId = ''
      let primarySkills: string[] = job.requiredSkills || []
      let atsScore = 0
      let jdMatchScore = 0

      try {
        await ensureApiSession()
        const applied = await applyToPublicJob(code || job.shareableCode, {
          candidateName: account.name,
          candidateEmail: account.email,
          candidatePhone: phone.trim(),
          experienceYears: experience,
          resumeText: resumePayload,
          resumeName: resumeFile ? resumeFile.name : 'Candidate_Resume.pdf',
        })
        applicationId = applied.applicationId
        organizationId = applied.organizationId
        primarySkills = applied.ats.primarySkills
        atsScore = applied.ats.atsScore
        jdMatchScore = applied.ats.jdMatchScore
        await apiSaveProfile({
          fullName: account.name,
          resumeText: resumePayload,
          currentRole: job.roleTrack,
          totalExperience: experience,
          skills: primarySkills,
        } as never)
      } catch {
        // Offline fallback — local applicant only
      }

      const applicant = saveEmployerApplicant({
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,
        candidateName: account.name,
        candidateEmail: account.email,
        candidatePhone: phone.trim(),
        experienceYears: experience,
        resumeName: resumeFile ? resumeFile.name : 'Candidate_Resume.pdf',
        resumeText: resumePayload,
        atsScore,
        jdMatchScore,
        primarySkills,
      })
      applicantId = applicant.id

      sessionStorage.setItem(
        'hireright.targetJob',
        JSON.stringify({
          title: job.title,
          company: job.company,
          role: job.roleTrack,
          level: job.experienceLevel,
          jd: job.jobDescription,
          applicantId,
          jobId: job.id,
          applicationId,
          organizationId,
          primarySkills,
          atsScore,
          jdMatchScore,
        }),
      )

      navigate('/interview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the application.')
    } finally {
      setLoading(false)
    }
  }

  if (!job) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <SiteNav />
          <div className={styles.card} style={{ textAlign: 'center', marginTop: '60px' }}>
            <h2 style={{ color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <HrIcon name="warning" size={22} /> Private Job Link Not Found
            </h2>
            <p style={{ color: '#64748b' }}>
              The job application link you accessed (`{code}`) may have expired or been removed by the employer.
            </p>
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

          {/* Job Description Box */}
          <div className={styles.jdBox}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HrIcon name="document" size={20} /> Job Description & Requirements
            </h3>
            <p>{job.jobDescription}</p>

            {job.requiredSkills && job.requiredSkills.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <strong style={{ fontSize: '0.85rem', color: '#64748b' }}>REQUIRED SKILLS:</strong>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {job.requiredSkills.map((sk) => (
                    <span
                      key={sk}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                      }}
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Candidate Information Form */}
          <h3
            style={{
              fontSize: '1.2rem',
              fontWeight: 800,
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <HrIcon name="form" size={22} /> Fill Basic Details & Upload Resume to Start AI Assessment
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
                  <div style={{ marginBottom: '6px', color: '#e11d48' }}>
                    <HrIcon name="folder" size={32} />
                  </div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>
                    {resumeFile ? resumeFile.name : 'Click to Upload Resume PDF'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                    {resumeFile ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <HrIcon name="check" size={14} /> File attached (
                        {Math.round(resumeFile.size / 1024)} KB)
                      </span>
                    ) : (
                      'Ava will extract your projects & skills to personalize the AI interview'
                    )}
                  </div>
                </label>
              </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Initializing AI Interview Studio...' : 'Start AI Interview Now →'}
            </button>
          </form>
        </motion.div>
      </div>
      <SiteFooter />
    </div>
  )
}
