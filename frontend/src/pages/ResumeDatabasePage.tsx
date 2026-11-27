import { useCallback, useEffect, useState } from 'react'
import { ApplicantsSearch } from '../components/applicants/ApplicantsSearch'
import { patchApplicantRows } from '../components/applicants/applicantJobs'
import { ensureApiSession } from '../lib/apiSession'
import { mapOrgCandidate } from '../lib/employerCandidateUtils'
import { getUser, type EmployerApplicant } from '../lib/store'
import { fetchAllPlatformCandidates, fetchVendorJobs } from '../lib/vendorApi'
import ui from './EmployerDashboard.module.css'

function normalizeApplicant(row: EmployerApplicant): EmployerApplicant {
  return {
    ...row,
    candidateName: row.candidateName?.trim() || row.candidateEmail || 'Candidate',
    candidateEmail: row.candidateEmail?.trim() || '',
    candidatePhone: row.candidatePhone?.trim() || '',
    company: row.company?.trim() || '',
    jobTitle: row.jobTitle?.trim() || '',
    experienceYears: row.experienceYears?.trim() || '',
    status: row.status || 'New',
  }
}

/** Vendor Candidates: the resume-database search over every job seeker visible on HireRighttt. */
export function ResumeDatabasePage() {
  const user = getUser()
  const [applicants, setApplicants] = useState<EmployerApplicant[]>([])
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  // getUser() returns a fresh object every render, so the load effect keys on these primitives instead.
  const userEmail = user?.email
  const userRole = user?.role

  useEffect(() => {
    if (userRole !== 'employer') return
    let cancelled = false
    const list = new AbortController()
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        if (!(await ensureApiSession())) {
          throw new Error('Could not reach the server. Check your connection and try again.')
        }
        const [people, jobList] = await Promise.all([
          fetchAllPlatformCandidates(list.signal),
          fetchVendorJobs().catch(() => ({ jobs: [] as { id: string; title: string }[] })),
        ])
        if (cancelled) return
        setApplicants(people.map((c) => normalizeApplicant(mapOrgCandidate(c))))
        setJobs((jobList.jobs || []).map((j) => ({ id: j.id, title: j.title })))
      } catch (err) {
        if (!cancelled) {
          setApplicants([])
          setError(err instanceof Error ? err.message : 'We could not load candidates. Please try again.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      list.abort()
    }
  }, [userEmail, userRole, reloadKey])

  const updateApplicant = useCallback((id: string, patch: Partial<EmployerApplicant>) => {
    setApplicants((prev) => patchApplicantRows(prev, id, patch))
  }, [])

  return (
    <div className={ui.pageBleed}>
      <div className={ui.page}>
        <div className={ui.shell}>
          <header className={ui.pageHeader}>
            <div>
              <h1 className={ui.pageTitle}>Candidates</h1>
              <p className={ui.pageSub}>
                Everyone on HireRighttt who is visible to employers. Search by keywords, location and experience.
              </p>
            </div>
          </header>
          <ApplicantsSearch
            mode="candidates"
            applicants={applicants}
            jobs={jobs}
            loading={loading}
            error={error}
            onRetry={() => setReloadKey((k) => k + 1)}
            onUpdateApplicant={updateApplicant}
            loadRanking={false}
          />
        </div>
      </div>
    </div>
  )
}
