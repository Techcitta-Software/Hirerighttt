import { useEffect, useMemo, useState } from 'react'
import { indexApplicant, type IndexedApplicant } from '../../lib/applicantSearch'
import { mapWithConcurrency } from '../../lib/concurrency'
import type { EmployerApplicant } from '../../lib/store'
import { fetchJobApplicants } from '../../lib/vendorApi'

/** Jobs whose ranking is fetched in the background. */
const RANKED_JOBS_LIMIT = 12

type RankInfo = Pick<
  EmployerApplicant,
  'rank' | 'roleSkillsFit' | 'matchedSkills' | 'missingSkills' | 'atsScore' | 'jdMatchScore' | 'interviewCompletedAt'
>

/**
 * Indexes the applicants for search and decorates application rows with each job's ranking (rank, Role Skills Fit,
 * skills the ATS check found) from the existing applicants endpoint. Runs a few jobs at a time after the list is on
 * screen; it never blocks the first render and never recomputes a rank.
 */
export function useJobRanking(
  applicants: EmployerApplicant[],
  jobs: { id: string }[],
  opts: { enabled: boolean; loading: boolean },
) {
  const [rankInfo, setRankInfo] = useState<Record<string, RankInfo>>({})
  // Ranked applicants per job as the server ranked them. Counting the rows on this page under-counted: a person
  // listed once here under another job still holds a rank on this one.
  const [serverTotals, setServerTotals] = useState<Record<string, number>>({})
  const jobIdsKey = jobs
    .slice(0, RANKED_JOBS_LIMIT)
    .map((j) => j.id)
    .filter((id) => id && !id.startsWith('optimistic-'))
    .join(',')

  useEffect(() => {
    if (!opts.enabled || opts.loading || !jobIdsKey) return
    let cancelled = false
    void mapWithConcurrency(jobIdsKey.split(','), 3, async (jobId) => {
      try {
        const { applicants: rows } = await fetchJobApplicants(jobId, { background: true })
        if (cancelled) return
        const patch: Record<string, RankInfo> = {}
        for (const r of rows) {
          patch[r.id] = {
            rank: r.rank ?? null,
            roleSkillsFit: r.rankRoleSkillsFit ?? null,
            matchedSkills: r.data.matchedSkills,
            missingSkills: r.data.missingSkills,
            atsScore: r.data.atsScore,
            jdMatchScore: r.data.jdMatchScore,
            interviewCompletedAt: r.interviewCompletedAt ?? null,
          }
        }
        setRankInfo((prev) => ({ ...prev, ...patch }))
        const ranked = rows.filter((r) => typeof r.rank === 'number').length
        setServerTotals((prev) => ({ ...prev, [jobId]: ranked }))
      } catch {
        /* ranking is optional decoration */
      }
    })
    return () => {
      cancelled = true
    }
  }, [opts.enabled, opts.loading, jobIdsKey])

  const indexed = useMemo<IndexedApplicant[]>(
    () =>
      applicants.map((a) => {
        const extra = rankInfo[a.id]
        if (!extra) return indexApplicant(a)
        const merged: Record<string, unknown> = { ...a }
        for (const [k, v] of Object.entries(extra)) {
          if (v !== undefined && v !== null && merged[k] == null) merged[k] = v
        }
        return indexApplicant(merged as EmployerApplicant)
      }),
    [applicants, rankInfo],
  )

  /** Ranked applicants per job, for "#2 of 14". */
  const rankTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const r of indexed) {
      const jobId = r.applicant.jobId
      if (typeof r.applicant.rank === 'number' && jobId) totals[jobId] = (totals[jobId] ?? 0) + 1
    }
    for (const [jobId, n] of Object.entries(serverTotals)) totals[jobId] = Math.max(totals[jobId] ?? 0, n)
    return totals
  }, [indexed, serverTotals])

  return { indexed, rankTotals }
}
