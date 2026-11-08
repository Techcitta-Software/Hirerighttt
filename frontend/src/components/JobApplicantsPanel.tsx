import { useMemo, useState } from 'react'
import type { EmployerApplicant } from '../lib/store'
import {
  DEFAULT_JOB_APPLICANT_FILTERS,
  filterJobApplicants,
  interviewScoreOf,
  summarizeJobApplicants,
  type JobApplicantFilters,
} from '../lib/jobApplicantFilters'
import { HrIcon } from './HrIcon'
import styles from './JobApplicantsPanel.module.css'

type Props = {
  rows: EmployerApplicant[]
  loading: boolean
  onViewDocument: (kind: 'resume' | 'report', applicant: EmployerApplicant) => void
  onOpenApplicant: (applicant: EmployerApplicant) => void
}

const SOURCE_LABEL: Record<NonNullable<EmployerApplicant['source']>, string> = {
  job_board: 'Job board',
  shared_link: 'Shared link',
  invite: 'Invite',
}

function ScoreCell({ value, label }: { value: number | null | undefined; label: string }) {
  if (typeof value !== 'number') return <span className={styles.muted}>—</span>
  const tone = value >= 75 ? styles.good : value >= 50 ? styles.mid : styles.low
  return (
    <span className={styles.score} role="img" aria-label={`${label} ${Math.round(value)} out of 100`}>
      <span className={`${styles.scoreBar} ${tone}`} aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
      </span>
      <strong className="ds-num">{Math.round(value)}</strong>
    </span>
  )
}

/** Everyone who applied to one job — from the job board or a shared link — ranked by JD fit and interview. */
export function JobApplicantsPanel({ rows, loading, onViewDocument, onOpenApplicant }: Props) {
  const [f, setF] = useState<JobApplicantFilters>(DEFAULT_JOB_APPLICANT_FILTERS)
  const visible = useMemo(() => filterJobApplicants(rows, f), [rows, f])
  const summary = useMemo(() => summarizeJobApplicants(rows), [rows])
  const set = (patch: Partial<JobApplicantFilters>) => setF((prev) => ({ ...prev, ...patch }))
  const filtered = JSON.stringify({ ...f, sort: 'ats' }) !== JSON.stringify({ ...DEFAULT_JOB_APPLICANT_FILTERS, sort: 'ats' })

  if (loading) {
    return (
      <div className={styles.panel} role="status" aria-label="Loading applicants">
        {[0, 1, 2].map((i) => (
          <span key={i} className="ds-skeleton ds-skeleton-row" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="ds-empty">
        <span className="ds-empty__icon" aria-hidden="true">
          <HrIcon name="users" size={20} />
        </span>
        <p className="ds-empty__title">No applications yet</p>
        <p className="ds-empty__body">
          Share the job link, or wait for candidates to apply from the job board. Each applicant appears here with
          their resume-to-JD ATS score and HireRighttt interview score.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <dl className={styles.summary}>
        <div>
          <dt>Applicants</dt>
          <dd className="ds-num">{summary.total}</dd>
        </div>
        <div>
          <dt>Interviewed</dt>
          <dd className="ds-num">{summary.interviewed}</dd>
        </div>
        <div>
          <dt>Avg ATS score</dt>
          <dd className="ds-num">{summary.avgAts ?? '—'}</dd>
        </div>
        <div>
          <dt>Avg HireRighttt score</dt>
          <dd className="ds-num">{summary.avgInterview ?? '—'}</dd>
        </div>
      </dl>

      <div className={styles.filters} role="search" aria-label="Filter applicants">
        <label className={styles.searchField}>
          <span className="ds-sr-only">Search applicants</span>
          <HrIcon name="search" size={16} />
          <input
            type="search"
            placeholder="Search name, email or skill…"
            value={f.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        <label>
          <span>ATS score</span>
          <select aria-label="ATS score" value={f.minAts} onChange={(e) => set({ minAts: Number(e.target.value) })}>
            <option value={0}>Any</option>
            <option value={50}>50+</option>
            <option value={70}>70+</option>
            <option value={85}>85+</option>
          </select>
        </label>
        <label>
          <span>HireRighttt score</span>
          <select
            aria-label="HireRighttt score"
            value={String(f.interview)}
            onChange={(e) => {
              const v = e.target.value
              set({ interview: v === 'any' || v === 'interviewed' || v === 'not_interviewed' ? v : Number(v) })
            }}
          >
            <option value="any">Any</option>
            <option value="interviewed">Interviewed</option>
            <option value="not_interviewed">Not interviewed</option>
            <option value="50">50+</option>
            <option value="70">70+</option>
            <option value="85">85+</option>
          </select>
        </label>
        <label>
          <span>Source</span>
          <select aria-label="Source" value={f.source} onChange={(e) => set({ source: e.target.value as JobApplicantFilters['source'] })}>
            <option value="all">All</option>
            <option value="job_board">Job board</option>
            <option value="shared_link">Shared link</option>
            <option value="invite">Invite</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value as JobApplicantFilters['status'] })}>
            <option value="all">All</option>
            <option value="New">New</option>
            <option value="In Review">In review</option>
            <option value="Interviewing">Interviewing</option>
            <option value="Shortlisted">Shortlisted</option>
            <option value="Rejected">Rejected</option>
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select aria-label="Sort by" value={f.sort} onChange={(e) => set({ sort: e.target.value as JobApplicantFilters['sort'] })}>
            <option value="ats">Best ATS score</option>
            <option value="jd">Best JD match</option>
            <option value="interview">Best HireRighttt score</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>

      <p className={styles.count} role="status">
        Showing <strong>{visible.length}</strong> of {rows.length}
        {filtered ? (
          <button type="button" className={styles.reset} onClick={() => setF(DEFAULT_JOB_APPLICANT_FILTERS)}>
            Clear filters
          </button>
        ) : null}
      </p>

      {visible.length === 0 ? (
        <div className="ds-empty">
          <p className="ds-empty__title">No applicants match these filters</p>
          <div className="ds-empty__actions">
            <button type="button" className={styles.reset} onClick={() => setF(DEFAULT_JOB_APPLICANT_FILTERS)}>
              Clear filters
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">ATS score</th>
                <th scope="col">JD match</th>
                <th scope="col">HireRighttt score</th>
                <th scope="col">Matched skills</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="ds-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const skills = a.matchedSkills || []
                const iv = interviewScoreOf(a)
                return (
                  <tr key={a.id}>
                    <td className={styles.who}>
                      <button type="button" className={styles.name} onClick={() => onOpenApplicant(a)}>
                        {a.candidateName}
                      </button>
                      <span className={styles.sub}>{a.candidateEmail}</span>
                      {a.source ? <span className={styles.source}>{SOURCE_LABEL[a.source]}</span> : null}
                    </td>
                    <td data-label="ATS score">
                      <ScoreCell value={a.atsScore} label="ATS score" />
                    </td>
                    <td data-label="JD match">
                      <ScoreCell value={a.jdMatchScore} label="JD match" />
                    </td>
                    <td data-label="HireRighttt score">
                      {iv === null ? (
                        <span className={styles.muted}>Not interviewed</span>
                      ) : (
                        <>
                          <ScoreCell value={iv} label="HireRighttt score" />
                          <span
                            className={styles.ivSource}
                            title={
                              a.interviewSource === 'job'
                                ? 'Interview taken for this job'
                                : "The candidate's general career interview, not one for this job"
                            }
                          >
                            {a.interviewSource === 'job' ? 'Job interview' : 'Career interview'}
                          </span>
                        </>
                      )}
                    </td>
                    <td data-label="Matched skills">
                      {skills.length ? (
                        <span className={styles.skills}>
                          {skills.slice(0, 3).map((s) => (
                            <span key={s} className={styles.skill}>
                              {s}
                            </span>
                          ))}
                          {skills.length > 3 ? <span className={styles.more}>+{skills.length - 3}</span> : null}
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={styles.status}>{a.status}</span>
                    </td>
                    <td className={styles.actions}>
                      <button type="button" onClick={() => onViewDocument('resume', a)} disabled={!a.resumeName && !a.resumeText}>
                        Resume
                      </button>
                      <button type="button" onClick={() => onViewDocument('report', a)} disabled={iv === null}>
                        Report
                      </button>
                      <button type="button" className={styles.primary} onClick={() => onOpenApplicant(a)}>
                        Details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
