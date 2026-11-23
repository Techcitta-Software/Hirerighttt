import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  EMPTY_APPLICANT_FILTERS,
  readApplicantsUrl,
  writeApplicantsUrl,
  type ApplicantFilters,
  type ApplicantsUrlState,
} from '../../lib/applicantSearch'

export type Draft = Pick<ApplicantFilters, 'keywords' | 'location' | 'expMin' | 'expMax'>

const SEARCH_DEBOUNCE_MS = 300

function sameDraft(a: Draft, b: Draft): boolean {
  return a.keywords === b.keywords && a.location === b.location && a.expMin === b.expMin && a.expMax === b.expMax
}

function draftOf(f: ApplicantFilters): Draft {
  return { keywords: f.keywords, location: f.location, expMin: f.expMin, expMax: f.expMax }
}

/**
 * The Applicants view state lives in the URL (search, filters, sort, page, open applicant, drawer tab), so reload,
 * a shared link and Back / Forward all reproduce the view. Discrete changes push a history entry; typing (debounced)
 * and browsing between applicants replace it.
 */
export function useApplicantsUrl() {
  const [params, setParams] = useSearchParams()
  const url = useMemo(() => readApplicantsUrl(params), [params])

  const commit = useCallback(
    (patch: Partial<ApplicantsUrlState>, opts: { replace?: boolean } = {}) => {
      setParams((prev) => writeApplicantsUrl({ ...readApplicantsUrl(prev), ...patch }), { replace: opts.replace })
    },
    [setParams],
  )

  const [draft, setDraft] = useState<Draft>(() => draftOf(url.filters))
  const committedRef = useRef<Draft>(draft)

  // The address can change from outside (Back / Forward, a link): show its values in the inputs.
  const fromUrl = draftOf(url.filters)
  const fromUrlKey = JSON.stringify(fromUrl)
  useEffect(() => {
    const next = JSON.parse(fromUrlKey) as Draft
    if (sameDraft(committedRef.current, next)) return
    committedRef.current = next
    setDraft(next)
  }, [fromUrlKey])

  // Typing applies after a short pause. The search runs locally, so no response can arrive out of order.
  useEffect(() => {
    if (sameDraft(committedRef.current, draft)) return
    const timer = window.setTimeout(() => {
      committedRef.current = draft
      setParams(
        (prev) => {
          const cur = readApplicantsUrl(prev)
          return writeApplicantsUrl({ ...cur, filters: { ...cur.filters, ...draft }, page: 1 })
        },
        { replace: true },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, setParams])

  /** Search button / Enter: apply the inputs now, as a new history entry. */
  const submitDraft = useCallback(() => {
    committedRef.current = draft
    commit({ filters: { ...url.filters, ...draft }, page: 1 })
  }, [draft, url.filters, commit])

  /** A filter change from the rail or a chip: applies at once and keeps the inputs in step. */
  const patchFilters = useCallback(
    (patch: Partial<ApplicantFilters>) => {
      const next = { ...url.filters, ...patch }
      committedRef.current = draftOf(next)
      setDraft(draftOf(next))
      commit({ filters: next, page: 1 })
    },
    [url.filters, commit],
  )

  const clearFilters = useCallback(() => {
    committedRef.current = draftOf(EMPTY_APPLICANT_FILTERS)
    setDraft(draftOf(EMPTY_APPLICANT_FILTERS))
    commit({ filters: EMPTY_APPLICANT_FILTERS, page: 1 })
  }, [commit])

  return { url, commit, draft, setDraft, submitDraft, patchFilters, clearFilters }
}
