import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CANDIDATE_EXPERIENCE_PRESETS,
  SHORTLIST_HINT,
  SORT_LABELS,
  activeFilterChips,
  experiencePresetId,
  filtersForApplicantSearch,
  filtersForInterviewRadio,
  interviewRadioOf,
  resultRangeLabel,
  searchApplicants,
  type ApplicantSort,
  type FacetCount,
  type IndexedApplicant,
  type InterviewRadio,
} from '../../lib/applicantSearch'
import type { ApplicantsSearchMode } from './useApplicantsUrl'
import type { EmployerApplicant } from '../../lib/store'
import { EmployerCandidateDocumentModal } from '../EmployerCandidateDocumentModal'
import { HrIcon } from '../HrIcon'
import { handleDialogKeyDown, useDialogFocus } from '../useDialog'
import { ApplicantResumePanel } from './ApplicantResumePanel'
import { ApplicantTuple, type TupleAction } from './ApplicantTuple'
import { useApplicantActions } from './useApplicantActions'
import { InviteApplicantDialog, type InviteChoice } from './InviteApplicantDialog'
import { InviteStatusLine } from './InviteStatusLine'
import { useInviteStatus } from './inviteStatus'
import { useApplicantsUrl } from './useApplicantsUrl'
import { useJobRanking } from './useJobRanking'
import { projectApplicantsToJobs, rowHasApplicationId } from './applicantJobs'
import styles from './Applicants.module.css'

export const APPLICANTS_PAGE_SIZE = 20

export type ApplicantsSearchProps = {
  mode: ApplicantsSearchMode
  applicants: EmployerApplicant[]
  jobs: { id: string; title: string }[]
  loading: boolean
  error?: string
  onRetry: () => void
  /** Applies a local change (e.g. status after Shortlist) to the page's list. */
  onUpdateApplicant?: (id: string, patch: Partial<EmployerApplicant>) => void
  /** Opens the "Invite to interview" (email links) dialog from the empty state. */
  onInviteByEmail?: () => void
  /** Fetch each job's ranking in the background (off in tests). */
  loadRanking?: boolean
  /** Fetch each invite's status (sent / opened / booked / …) in the background. */
  loadInviteStatus?: boolean
  now?: number
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function FilterGroup({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  open: boolean
  onToggle: (id: string) => void
  children: ReactNode
}) {
  return (
    <fieldset className={styles.fGroup}>
      <legend className={styles.fGroupTitle}>
        <button
          type="button"
          className={styles.fGroupToggle}
          aria-expanded={open}
          aria-controls={`fgroup-${id}`}
          onClick={() => onToggle(id)}
        >
          {title}
          <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true" />
        </button>
      </legend>
      <div id={`fgroup-${id}`} hidden={!open} className={styles.fGroupBody}>
        {children}
      </div>
    </fieldset>
  )
}

function CheckList({
  name,
  options,
  values,
  onToggle,
  disableEmpty = true,
}: {
  name: string
  options: FacetCount[]
  values: string[]
  onToggle: (value: string) => void
  /** When false, a zero-count option stays clickable (so a selected city or skill can be turned off). */
  disableEmpty?: boolean
}) {
  if (!options.length) return <p className={styles.fEmpty}>No data yet</p>
  return (
    <ul className={styles.checkList}>
      {options.map((o) => {
        const checked = values.some((v) => v.toLowerCase() === o.value.toLowerCase())
        const dead = disableEmpty && !o.count && !checked
        return (
          <li key={o.value}>
            <label className={`${styles.checkRow} ${dead ? styles.checkRowMuted : ''}`}>
              <input type="checkbox" name={name} checked={checked} disabled={dead} onChange={() => onToggle(o.value)} />
              <span className={styles.checkLabel}>{o.label}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
}

function RadioList({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: { value: string; label: string; count?: number }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <ul className={styles.checkList}>
      {options.map((o) => (
        <li key={o.value}>
          <label className={styles.checkRow}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className={styles.checkLabel}>{o.label}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

/** Placeholder row with the exact tuple layout, so nothing moves when the data arrives. */
function TupleSkeleton() {
  return (
    <article className={`${styles.tuple} ${styles.tupleSkeleton}`} aria-hidden="true">
      <span className={styles.tupleCheck}>
        <span className={`ds-skeleton ${styles.skBox}`} />
      </span>
      <div className={styles.tupleMain}>
        <span className={styles.tupleHead}>
          <span className={`ds-skeleton ds-skeleton-line ${styles.skName}`} />
        </span>
        <span className={styles.metaLine}>
          <span className={`ds-skeleton ds-skeleton-line ${styles.skMeta}`} />
        </span>
        <span className={styles.skillRow}>
          {[56, 72, 48, 64].map((w) => (
            <span key={w} className={`ds-skeleton ${styles.skChip}`} style={{ width: w }} />
          ))}
        </span>
      </div>
      <div className={styles.signals}>
        <span className={`ds-skeleton ds-skeleton-line ${styles.skScore}`} />
        <span className={`ds-skeleton ds-skeleton-line ${styles.skSig}`} />
        <span className={`ds-skeleton ds-skeleton-line ${styles.skSig}`} />
        <span className={`ds-skeleton ds-skeleton-line ${styles.skSig}`} />
      </div>
      <div className={styles.tupleFoot}>
        <span className={`ds-skeleton ds-skeleton-line ${styles.skMeta}`} />
        <span className={`ds-skeleton ${styles.skBtn}`} />
      </div>
    </article>
  )
}

/**
 * Applicants page: resume-database search (keywords with AND / OR / "phrases" / -exclude, experience, location),
 * faceted filters with counts, dense result rows, bulk actions and an applicant drawer. The whole view lives in the
 * URL. Works on the list the page already loaded, decorated with each job's ranking.
 */
export function ApplicantsSearch({
  mode,
  applicants,
  jobs,
  loading,
  error = '',
  onRetry,
  onUpdateApplicant,
  onInviteByEmail,
  loadRanking = true,
  loadInviteStatus = true,
  now: nowProp,
}: ApplicantsSearchProps) {
  const [now] = useState(() => nowProp ?? Date.now())
  const { url, commit, draft, setDraft, submitDraft, patchFilters, clearFilters } = useApplicantsUrl(mode)
  const person = mode === 'candidates' ? 'candidate' : 'applicant'
  const people = `${person}s`
  const { filters, sort: urlSort, page, applicant: activeId, tab } = url
  const sort = mode === 'candidates' && urlSort === 'fit' ? 'relevance' : urlSort
  // Under a job filter, a person who applied to several jobs shows THAT job's application (id, status, scores, rank).
  const jobFilterKey = filters.jobs.join(',')
  const shownApplicants = useMemo(
    () => projectApplicantsToJobs(applicants, jobFilterKey ? jobFilterKey.split(',') : []),
    [applicants, jobFilterKey],
  )
  const { indexed, rankTotals } = useJobRanking(shownApplicants, jobs, { enabled: loadRanking, loading })
  const singleJobId = mode === 'applications' && filters.jobs.length === 1 ? filters.jobs[0] : undefined
  const inviteStatus = useInviteStatus({ enabled: loadInviteStatus && !loading, jobId: singleJobId })
  const actions = useApplicantActions(onUpdateApplicant, inviteStatus.refresh, filters.keywords)
  const { busy, bulkBusy, notice, setNotice } = actions
  // Row / profile "Invite" asks: open link, or a date and time slot.
  const [inviteFor, setInviteFor] = useState<IndexedApplicant | null>(null)

  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [reportFor, setReportFor] = useState<EmployerApplicant | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(['role', 'skills', 'experience', 'interview']),
  )
  const [skillQuery, setSkillQuery] = useState('')
  const [showAllSkills, setShowAllSkills] = useState(false)
  const [roleQuery, setRoleQuery] = useState('')
  const [showAllRoles, setShowAllRoles] = useState(false)
  const resultsTopRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const panelTriggerRef = useRef<HTMLElement | null>(null)
  // Below 900px the filter rail opens as a full-screen sheet: a modal dialog (focus in, scroll lock, focus back).
  const sheetRef = useRef<HTMLElement>(null)
  useDialogFocus(filtersOpen, sheetRef)

  const jobTitles = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j.title])), [jobs])
  const effectiveFilters = useMemo(() => filtersForApplicantSearch(mode, filters), [mode, filters])
  const result = useMemo(
    () => searchApplicants(indexed, effectiveFilters, sort, { now, jobTitles }),
    [indexed, effectiveFilters, sort, now, jobTitles],
  )

  const pageCount = Math.max(1, Math.ceil(result.rows.length / APPLICANTS_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = result.rows.slice((safePage - 1) * APPLICANTS_PAGE_SIZE, safePage * APPLICANTS_PAGE_SIZE)
  const roleLabels = useMemo(
    () => Object.fromEntries(result.facets.roles.map((r) => [r.value, r.label])),
    [result.facets.roles],
  )
  const chips = activeFilterChips(effectiveFilters, { jobs: jobTitles, roles: roleLabels })
  const filterChipCount = chips.filter((c) => c.key !== 'kw').length

  const activeRow = useMemo(
    () =>
      activeId
        ? (result.rows.find((r) => r.applicant.id === activeId) ??
          indexed.find((r) => r.applicant.id === activeId) ??
          // The drawer was opened on this person's other application before the job filter changed.
          result.rows.find((r) => rowHasApplicationId(r.applicant, activeId)) ??
          null)
        : null,
    [activeId, result.rows, indexed],
  )
  const activeIndex = activeRow ? result.rows.indexOf(activeRow) : -1

  // A link to an applicant who is not in this list (removed, another organisation's, a typo): drop it and say so.
  useEffect(() => {
    if (!activeId || activeRow || loading || !applicants.length) return
    commit({ applicant: null, tab: 'profile' }, { replace: true })
    setNotice({ tone: 'info', text: 'That applicant isn’t in this list any more.' })
  }, [activeId, activeRow, loading, applicants.length, commit, setNotice])

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    submitDraft()
    // Keep the search box in view: only scroll when the results start below the fold (e.g. on a phone, where
    // the search card fills the screen), never on desktop where results are already visible under it.
    const top = resultsTopRef.current?.getBoundingClientRect().top
    if (top !== undefined && top > window.innerHeight * 0.75) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      resultsTopRef.current?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    }
  }

  function clearAll() {
    setSkillQuery('')
    setRoleQuery('')
    clearFilters()
  }

  /** Job applications: drop the search card only. The job scope stays, so the recruiter remains on this job. */
  function clearSearch() {
    patchFilters({ keywords: '', location: '', expMin: '', expMax: '' })
  }

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /* ── Drawer ── */
  const openPanel = useCallback(
    (id: string) => {
      const el = document.activeElement
      if (el instanceof HTMLElement && !el.closest('[role="dialog"]')) panelTriggerRef.current = el
      commit({ applicant: id, tab: 'profile' })
    },
    [commit],
  )

  const closePanel = useCallback(() => {
    const id = activeId
    commit({ applicant: null, tab: 'profile' })
    const trigger = panelTriggerRef.current
    window.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus()
      else if (id) document.getElementById(`tuple-name-${id}`)?.focus()
    }, 0)
  }, [commit, activeId])

  const goTo = useCallback(
    (index: number) => {
      const row = result.rows[index]
      if (!row) return
      panelTriggerRef.current = null // focus returns to the row now open
      commit({ applicant: row.applicant.id, page: Math.floor(index / APPLICANTS_PAGE_SIZE) + 1 }, { replace: true })
    },
    [result.rows, commit],
  )

  /* At 1024px and wider the drawer sits beside the list instead of over it: the list narrows (filters hidden, compact
     rows) so the scores of the other applicants stay visible while one is open. */
  const rootRef = useRef<HTMLDivElement>(null)
  const [pushPad, setPushPad] = useState(0)
  useEffect(() => {
    if (!activeId || typeof window.matchMedia !== 'function') {
      setPushPad(0)
      return
    }
    function measure() {
      const root = rootRef.current
      const panel = document.querySelector<HTMLElement>('[data-applicant-panel]')
      if (!root || !panel || !window.matchMedia('(min-width: 1024px)').matches) return setPushPad(0)
      const prev = root.style.paddingRight
      root.style.paddingRight = ''
      const overlap = root.getBoundingClientRect().right - panel.getBoundingClientRect().left
      root.style.paddingRight = prev
      setPushPad(overlap > 0 ? Math.ceil(overlap) + 16 : 0)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [activeId])

  // Below 1024px the drawer covers the page, so the page behind it must not scroll.
  useEffect(() => {
    if (!activeId || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(max-width: 1023px)').matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [activeId])

  // Latest action handlers, for the memoised rows and the keyboard shortcuts.
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  })

  const onAction = useCallback(
    (action: TupleAction, row: IndexedApplicant) => {
      const h = actionsRef.current
      if (action === 'view') openPanel(row.applicant.id)
      else if (action === 'download') void h.download(row)
      else if (action === 'shortlist') void h.shortlist([row], { toggle: true })
      else if (action === 'invite') setInviteFor(row)
    },
    [openPanel],
  )

  /* Keyboard: "/" focuses the search; with the drawer open j / k move, s shortlists, Esc closes. Never while typing. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (e.key === '/' && !activeRow) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (!activeRow) return
      if (e.key === 'j' && activeIndex >= 0 && activeIndex < result.rows.length - 1) goTo(activeIndex + 1)
      else if (e.key === 'k' && activeIndex > 0) goTo(activeIndex - 1)
      else if (e.key === 's') void actionsRef.current.shortlist([activeRow], { toggle: true })
      else if (e.key === 'Escape') closePanel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [activeRow, activeIndex, result.rows.length, goTo, closePanel])

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Selection is kept across filters, pages and the drawer; rows a filter hides are counted, not dropped.
  const selectedRows = indexed.filter((r) => selected.has(r.applicant.id))

  async function submitInvite(choice: InviteChoice) {
    const row = inviteFor
    if (!row) return
    if (choice.kind === 'open') {
      setInviteFor(null)
      await actionsRef.current.invite([row])
      return
    }
    const ok = await actionsRef.current.scheduleInvite(row, {
      scheduledStart: choice.scheduledStart,
      durationMinutes: choice.durationMinutes,
    })
    if (ok) setInviteFor(null)
  }

  // People invited to this job by e-mail who have not applied yet: otherwise invisible on the job page.
  const pendingInvites = singleJobId ? inviteStatus.index.unmatched(applicants) : []
  const visibleIds = new Set(result.rows.map((r) => r.applicant.id))
  const hiddenSelected = selectedRows.filter((r) => !visibleIds.has(r.applicant.id)).length
  const pageIds = pageRows.map((r) => r.applicant.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const somePageSelected = pageIds.some((id) => selected.has(id))

  function toggleSelectPage() {
    setSelected((s) => {
      const next = new Set(s)
      if (allPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setNotice({ tone: 'success', text: 'Link copied.' })
    } catch {
      window.prompt('Copy this interview link', link)
    }
  }

  const visibleSkills = result.facets.skills.filter((s) =>
    skillQuery.trim() ? s.label.toLowerCase().includes(skillQuery.trim().toLowerCase()) : true,
  )
  const skillsShown = showAllSkills || skillQuery.trim() ? visibleSkills : visibleSkills.slice(0, 10)
  const visibleRoles = result.facets.roles.filter((r) =>
    roleQuery.trim() ? r.label.toLowerCase().includes(roleQuery.trim().toLowerCase()) : true,
  )
  const rolesShown =
    showAllRoles || roleQuery.trim()
      ? visibleRoles
      : visibleRoles.filter(
          (r, i) => i < 8 || effectiveFilters.roles.some((v) => v.toLowerCase() === r.value.toLowerCase()),
        )
  const showSkeleton = loading && applicants.length === 0
  const refreshing = loading && applicants.length > 0
  const removable = chips.filter((c) => c.key !== 'kw').slice(0, 2)
  const experienceValue = experiencePresetId(effectiveFilters.expMin, effectiveFilters.expMax) ?? ''
  const interviewValue = interviewRadioOf(effectiveFilters) ?? ''

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${selected.size ? styles.rootWithBulk : ''} ${pushPad ? styles.rootWithPanel : ''}`}
      style={pushPad ? { paddingRight: pushPad } : undefined}
    >
      <form className={styles.searchCard} onSubmit={submitSearch} role="search" aria-label={`Search ${people}`}>
        <div className={styles.searchGrid}>
          <label className={`${styles.field} ${styles.fieldKeywords}`}>
            <span className={styles.fieldLabel}>Keywords</span>
            <span className={styles.inputWrap}>
              <HrIcon name="search" size={16} className={styles.inputIcon} />
              <input
                ref={searchInputRef}
                type="search"
                value={draft.keywords}
                onChange={(e) => setDraft((d) => ({ ...d, keywords: e.target.value }))}
                placeholder="Search skills, titles, companies or keywords"
                autoComplete="off"
              />
            </span>
          </label>
          <label className={`${styles.field} ${styles.fieldLocation}`}>
            <span className={styles.fieldLabel}>Location</span>
            <span className={styles.inputWrap}>
              <HrIcon name="map-pin" size={16} className={styles.inputIcon} />
              <input
                type="text"
                value={draft.location}
                onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                placeholder="City, e.g. Bengaluru"
                autoComplete="off"
              />
            </span>
          </label>
          <fieldset className={`${styles.field} ${styles.fieldExp}`}>
            <legend className={styles.fieldLabel}>Experience (yrs)</legend>
            <span className={styles.expPair}>
              <input
                type="number"
                min={0}
                max={50}
                inputMode="numeric"
                value={draft.expMin}
                onChange={(e) => setDraft((d) => ({ ...d, expMin: e.target.value }))}
                placeholder="Min"
                aria-label="Minimum years of experience"
              />
              <span aria-hidden="true">–</span>
              <input
                type="number"
                min={0}
                max={50}
                inputMode="numeric"
                value={draft.expMax}
                onChange={(e) => setDraft((d) => ({ ...d, expMax: e.target.value }))}
                placeholder="Max"
                aria-label="Maximum years of experience"
              />
            </span>
          </fieldset>
          <button type="submit" className={styles.searchBtn}>
            <HrIcon name="search" size={16} /> Search
          </button>
        </div>
      </form>

      {notice ? (
        <div
          className={`ds-alert ${notice.tone === 'error' ? 'ds-alert--error' : notice.tone === 'success' ? 'ds-alert--success' : 'ds-alert--info'} ${styles.notice}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span>
            {notice.text}
            {notice.link ? (
              notice.link.includes('\n') ? (
                <textarea
                  className={styles.noticeLink}
                  readOnly
                  rows={Math.min(4, notice.link.split('\n').length)}
                  value={notice.link}
                  aria-label="Interview links"
                  onFocus={(e) => e.currentTarget.select()}
                />
              ) : (
                <input
                  className={styles.noticeLink}
                  readOnly
                  value={notice.link}
                  aria-label="Interview link"
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="notice-link"
                />
              )
            ) : null}
          </span>
          {notice.undo ? (
            <button type="button" className={styles.linkBtn} onClick={notice.undo}>
              Undo
            </button>
          ) : null}
          {notice.link ? (
            <button type="button" className={styles.linkBtn} onClick={() => void copyLink(notice.link!)}>
              {notice.link.includes('\n') ? 'Copy links' : 'Copy link'}
            </button>
          ) : null}
          <button type="button" className={styles.iconBtn} onClick={() => setNotice(null)} aria-label="Dismiss message">
            <HrIcon name="close" size={14} />
          </button>
        </div>
      ) : null}

      <div className={`${styles.layout}${mode === 'applications' ? ` ${styles.layoutSingle}` : ''}`}>
        {mode === 'candidates' ? (
        <aside
          ref={sheetRef}
          className={`${styles.sidebar} ${filtersOpen ? styles.sidebarOpen : ''}`}
          aria-label={filtersOpen ? undefined : 'Filters'}
          id="applicant-filters"
          {...(filtersOpen
            ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'applicant-filters-title', tabIndex: -1 }
            : {})}
          onKeyDown={filtersOpen ? (e) => handleDialogKeyDown(e, () => setFiltersOpen(false)) : undefined}
        >
          <div className={styles.sidebarHead}>
            <h2 className={styles.sidebarTitle} id="applicant-filters-title">
              Filters
            </h2>
            <button type="button" className={styles.linkBtn} onClick={clearAll} disabled={!chips.length}>
              Clear all
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.sheetClose}`}
              onClick={() => setFiltersOpen(false)}
              aria-label="Close filters"
              {...(filtersOpen ? { 'data-autofocus': true } : {})}
            >
              <HrIcon name="close" size={16} />
            </button>
          </div>

          <div className={styles.sidebarScroll}>
            {showSkeleton ? (
              <p className={styles.filterLoading} role="status" aria-live="polite">
                Loading filters…
              </p>
            ) : (
              <>
            <FilterGroup id="role" title="Current role" open={openGroups.has('role')} onToggle={toggleGroup}>
              <input
                type="search"
                className={styles.fSearch}
                value={roleQuery}
                onChange={(e) => setRoleQuery(e.target.value)}
                placeholder="Find a role"
                aria-label="Find a role"
              />
              {rolesShown.length ? (
                <CheckList
                  name="role"
                  options={rolesShown}
                  values={effectiveFilters.roles}
                  onToggle={(v) => patchFilters({ roles: toggleIn(effectiveFilters.roles, v) })}
                />
              ) : (
                <p className={styles.fEmpty}>{roleQuery.trim() ? 'No roles found' : 'No data yet'}</p>
              )}
              {!roleQuery.trim() && visibleRoles.length > 8 ? (
                <button type="button" className={styles.linkBtn} onClick={() => setShowAllRoles((v) => !v)}>
                  {showAllRoles ? 'Show fewer' : `Show all ${visibleRoles.length}`}
                </button>
              ) : null}
            </FilterGroup>

            <FilterGroup id="skills" title="Key skills" open={openGroups.has('skills')} onToggle={toggleGroup}>
              {result.facets.skills.length > 6 ? (
                <input
                  type="search"
                  className={styles.fSearch}
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  placeholder="Find a skill"
                  aria-label="Find a skill"
                />
              ) : null}
              {skillsShown.length ? (
                <div className={styles.chipCloud}>
                  {skillsShown.map((s) => {
                    const on = effectiveFilters.skills.some((x) => x.toLowerCase() === s.value.toLowerCase())
                    return (
                      <button
                        key={s.value}
                        type="button"
                        className={`${styles.fChip} ${on ? styles.fChipOn : ''}`}
                        aria-pressed={on}
                        disabled={s.count === 0 && !on}
                        onClick={() =>
                          patchFilters({
                            skills: on
                              ? effectiveFilters.skills.filter((x) => x.toLowerCase() !== s.value.toLowerCase())
                              : [...effectiveFilters.skills, s.value],
                          })
                        }
                      >
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className={styles.fEmpty}>No skills found</p>
              )}
              {!skillQuery.trim() && visibleSkills.length > 10 ? (
                <button type="button" className={styles.linkBtn} onClick={() => setShowAllSkills((v) => !v)}>
                  {showAllSkills ? 'Show fewer' : `Show all ${visibleSkills.length}`}
                </button>
              ) : null}
              {effectiveFilters.skills.length > 1 ? <p className={styles.fEmpty}>Candidates with all selected skills.</p> : null}
            </FilterGroup>

            <FilterGroup id="experience" title="Experience" open={openGroups.has('experience')} onToggle={toggleGroup}>
              <RadioList
                name="experience-range"
                value={experienceValue}
                onChange={(id) => {
                  if (id === 'any') {
                    patchFilters({ expMin: '', expMax: '' })
                    return
                  }
                  const preset = CANDIDATE_EXPERIENCE_PRESETS.find((p) => p.id === id)
                  if (preset) patchFilters({ expMin: preset.min, expMax: preset.max })
                }}
                options={[
                  { value: 'any', label: 'Any' },
                  ...CANDIDATE_EXPERIENCE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                ]}
              />
            </FilterGroup>

            <FilterGroup id="interview" title="Interview" open={openGroups.has('interview')} onToggle={toggleGroup}>
              <RadioList
                name="interview-choice"
                value={interviewValue}
                onChange={(v) => patchFilters(filtersForInterviewRadio(v as InterviewRadio))}
                options={[
                  { value: 'any', label: 'Any' },
                  { value: 'interviewed', label: 'Interviewed', count: result.facets.interviewChoices.interviewed },
                  { value: '80', label: 'Score 80 and above', count: result.facets.interviewChoices.score80 },
                  { value: '60', label: 'Score 60 and above', count: result.facets.interviewChoices.score60 },
                  { value: 'not', label: 'Not interviewed yet', count: result.facets.interviewChoices.notInterviewed },
                ]}
              />
            </FilterGroup>

              </>
            )}
          </div>

          <div className={styles.sheetFoot}>
            <button type="button" className={styles.linkBtn} onClick={clearAll} disabled={!chips.length}>
              Clear all
            </button>
            <button type="button" className={`${styles.actBtn} ${styles.actPrimary}`} onClick={() => setFiltersOpen(false)}>
              Show {people}
            </button>
          </div>
        </aside>
        ) : null}

        <section className={styles.results} aria-labelledby="applicants-results-title" aria-busy={loading}>
          <div ref={resultsTopRef} className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <label className={styles.selectAll}>
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = somePageSelected && !allPageSelected
                  }}
                  onChange={toggleSelectPage}
                  disabled={!pageRows.length}
                  aria-label={`Select all ${people} on this page`}
                />
              </label>
              <h2 id="applicants-results-title" className={styles.resultCount} aria-live="polite">
                {showSkeleton
                  ? `Loading ${people}…`
                  : resultRangeLabel(safePage, APPLICANTS_PAGE_SIZE, result.rows.length, person)}
              </h2>
            </div>
            <div className={styles.toolbarRight}>
              {mode === 'candidates' ? (
                <button
                  type="button"
                  className={`${styles.actBtn} ${styles.filtersToggle}`}
                  aria-expanded={filtersOpen}
                  aria-controls="applicant-filters"
                  onClick={() => setFiltersOpen(true)}
                >
                  <HrIcon name="settings" size={14} /> Filters{filterChipCount ? ` (${filterChipCount})` : ''}
                </button>
              ) : null}
              {mode === 'applications' ? (
                <button
                  type="button"
                  className={styles.actBtn}
                  onClick={() => actions.exportCsv(result.rows, now)}
                  disabled={!result.rows.length}
                  title={`Download the ${result.rows.length} ${result.rows.length === 1 ? person : people} shown as a CSV file`}
                >
                  <HrIcon name="download" size={14} /> Export CSV
                </button>
              ) : null}
              <label className={styles.sortLabel}>
                <span>Sort by</span>
                <select value={sort} onChange={(e) => commit({ sort: e.target.value as ApplicantSort, page: 1 })}>
                  {(Object.keys(SORT_LABELS) as ApplicantSort[])
                    .filter((s) => mode === 'applications' || s !== 'fit')
                    .map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {refreshing ? <div className={styles.progress} role="progressbar" aria-label={`Updating ${people}`} /> : null}

          {pendingInvites.length ? (
            <details className={styles.pendingInvites} data-testid="pending-invites">
              <summary>
                Invited, not applied yet ({pendingInvites.length})
              </summary>
              <ul>
                {pendingInvites.map((inv) => (
                  <li key={inv.token}>
                    <InviteStatusLine invite={inv} showUrl label={inv.candidateName || inv.candidateEmail} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {mode === 'candidates' && chips.length ? (
            <div className={styles.chipsBar} aria-label="Applied filters">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={styles.appliedChip}
                  onClick={() => patchFilters(c.clear)}
                  aria-label={`Remove filter ${c.label}`}
                >
                  {c.label}
                  <HrIcon name="close" size={12} />
                </button>
              ))}
              <button type="button" className={styles.linkBtn} onClick={clearAll}>
                Clear all
              </button>
            </div>
          ) : null}

          {selected.size > 0 ? (
            <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
              <strong>
                {selected.size} selected
                {hiddenSelected ? <span className={styles.bulkHidden}> ({hiddenSelected} hidden by filters)</span> : null}
              </strong>
              <div className={styles.bulkActions}>
                <button
                  type="button"
                  className={styles.actBtn}
                  onClick={() => void actions.shortlist(selectedRows)}
                  disabled={Boolean(bulkBusy)}
                  aria-busy={bulkBusy === 'shortlist'}
                  title={SHORTLIST_HINT}
                >
                  <HrIcon name="check" size={14} /> {bulkBusy === 'shortlist' ? 'Shortlisting…' : 'Shortlist'}
                </button>
                <button
                  type="button"
                  className={`${styles.actBtn} ${styles.actPrimary}`}
                  onClick={() => void actions.invite(selectedRows, { confirm: true })}
                  disabled={Boolean(bulkBusy)}
                  aria-busy={bulkBusy === 'invite'}
                >
                  <HrIcon name="message" size={14} /> {bulkBusy === 'invite' ? 'Sending…' : 'Invite to interview'}
                </button>
                <button
                  type="button"
                  className={styles.actBtn}
                  onClick={() => void actions.downloadZip(selectedRows, now)}
                  disabled={Boolean(bulkBusy)}
                >
                  <HrIcon name="download" size={14} /> {bulkBusy === 'zip' ? 'Preparing…' : 'Download resumes (zip)'}
                </button>
                {mode === 'applications' ? (
                  <button type="button" className={styles.actBtn} onClick={() => actions.exportCsv(selectedRows, now)}>
                    <HrIcon name="download" size={14} /> Export CSV
                  </button>
                ) : null}
                <button type="button" className={styles.linkBtn} onClick={() => setSelected(new Set())}>
                  Clear selection
                </button>
              </div>
            </div>
          ) : null}

          {error && !loading ? (
            <div className={`ds-empty ${styles.empty}`} role="alert" data-testid="applicants-error">
              <span className="ds-empty__icon" aria-hidden="true">
                <HrIcon name="warning" size={20} />
              </span>
              <p className="ds-empty__title">We couldn’t load your {people}</p>
              <p className="ds-empty__body">Check your connection and try again.</p>
              <div className="ds-empty__actions">
                <button type="button" className={`${styles.actBtn} ${styles.actPrimary}`} onClick={onRetry}>
                  Retry
                </button>
              </div>
            </div>
          ) : showSkeleton ? (
            <ul className={styles.tupleList} aria-hidden="true" data-testid="applicants-skeleton">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <li key={i}>
                  <TupleSkeleton />
                </li>
              ))}
            </ul>
          ) : result.rows.length === 0 && applicants.length === 0 ? (
            <div className={`ds-empty ${styles.empty}`} data-testid="applicants-empty">
              <span className="ds-empty__icon" aria-hidden="true">
                <HrIcon name="users" size={20} />
              </span>
              <p className="ds-empty__title">{mode === 'candidates' ? 'No candidates yet' : 'No applicants yet'}</p>
              <p className="ds-empty__body">
                {mode === 'candidates'
                  ? 'People who are visible to employers show up here. Search by role, skills, location and experience.'
                  : 'Share a job’s apply link or email interview links. People appear here as soon as they apply or share an interview with you.'}
              </p>
              {mode === 'applications' || onInviteByEmail ? (
                <div className="ds-empty__actions">
                  {mode === 'applications' ? (
                    <Link to="/employer/jobs" state={{ createJob: true }} className={`${styles.actBtn} ${styles.actPrimary}`}>
                      Post a job
                    </Link>
                  ) : null}
                  {onInviteByEmail ? (
                    <button type="button" className={styles.actBtn} onClick={onInviteByEmail}>
                      Invite to interview
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : result.rows.length === 0 ? (
            <div className={`ds-empty ${styles.empty}`} data-testid="applicants-no-results">
              <span className="ds-empty__icon" aria-hidden="true">
                <HrIcon name="search" size={20} />
              </span>
              <p className="ds-empty__title">
                No {people} match{effectiveFilters.keywords.trim() ? ` “${effectiveFilters.keywords.trim()}”` : mode === 'candidates' ? ' these filters' : ' this search'}
                {mode === 'candidates' && filterChipCount && effectiveFilters.keywords.trim()
                  ? ` + ${filterChipCount} filter${filterChipCount === 1 ? '' : 's'}`
                  : ''}
              </p>
              <p className="ds-empty__body">Try fewer words, OR between alternatives, or a skill instead of a full title.</p>
              <div className="ds-empty__actions">
                {mode === 'applications' ? (
                  <button type="button" className={`${styles.actBtn} ${styles.actPrimary}`} onClick={clearSearch}>
                    Clear search
                  </button>
                ) : (
                  <>
                    {removable.map((c) => (
                      <button key={c.key} type="button" className={styles.actBtn} onClick={() => patchFilters(c.clear)}>
                        Remove “{c.label}”
                      </button>
                    ))}
                    {effectiveFilters.jobs.length ? (
                      <button type="button" className={styles.actBtn} onClick={() => patchFilters({ jobs: [] })}>
                        Search all jobs
                      </button>
                    ) : null}
                    <button type="button" className={`${styles.actBtn} ${styles.actPrimary}`} onClick={clearAll}>
                      Clear all filters
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <ul className={`${styles.tupleList} ${refreshing ? styles.stale : ''}`}>
              {pageRows.map((row) => (
                <li key={row.applicant.id}>
                  <ApplicantTuple
                    row={row}
                    terms={result.terms}
                    selected={selected.has(row.applicant.id)}
                    active={row.applicant.id === activeId}
                    busy={busy[row.applicant.id]}
                    now={now}
                    rankTotal={row.applicant.jobId ? rankTotals[row.applicant.jobId] : 0}
                    invite={inviteStatus.index.forApplicant(row.applicant)}
                    inProgress={inviteStatus.index.inProgress(row.applicant)}
                    directory={mode === 'candidates'}
                    pageJobId={mode === 'applications' && filters.jobs.length === 1 ? filters.jobs[0] : undefined}
                    onToggleSelect={toggleSelect}
                    onAction={onAction}
                  />
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 && !showSkeleton && !error ? (
            <nav className={styles.pager} aria-label="Result pages">
              <button type="button" className={styles.actBtn} disabled={safePage <= 1} onClick={() => commit({ page: safePage - 1 })}>
                Previous
              </button>
              <ol className={styles.pageList}>
                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1)
                  .map((p, i, arr) => (
                    <li key={p}>
                      {i > 0 && p - arr[i - 1] > 1 ? <span className={styles.pageGap}>…</span> : null}
                      <button
                        type="button"
                        className={`${styles.pageBtn} ${p === safePage ? styles.pageBtnOn : ''}`}
                        aria-current={p === safePage ? 'page' : undefined}
                        aria-label={`Page ${p}`}
                        onClick={() => {
                          commit({ page: p })
                          resultsTopRef.current?.scrollIntoView?.({ block: 'start' })
                        }}
                      >
                        {p}
                      </button>
                    </li>
                  ))}
              </ol>
              <button
                type="button"
                className={styles.actBtn}
                disabled={safePage >= pageCount}
                onClick={() => commit({ page: safePage + 1 })}
              >
                Next
              </button>
            </nav>
          ) : null}
        </section>
      </div>

      {mode === 'candidates' && filtersOpen ? (
        <div className={styles.sheetBackdrop} onClick={() => setFiltersOpen(false)} aria-hidden="true" />
      ) : null}

      {activeRow ? (
        <>
          <div className={styles.panelBackdrop} onClick={closePanel} aria-hidden="true" />
          <ApplicantResumePanel
            row={activeRow}
            terms={result.terms}
            position={{ index: Math.max(0, activeIndex), total: Math.max(result.rows.length, 1) }}
            tab={tab}
            onTab={(t) => commit({ tab: t }, { replace: true })}
            busy={busy[activeRow.applicant.id]}
            rankTotal={activeRow.applicant.jobId ? rankTotals[activeRow.applicant.jobId] : 0}
            onClose={closePanel}
            onPrev={activeIndex > 0 ? () => goTo(activeIndex - 1) : undefined}
            onNext={activeIndex >= 0 && activeIndex < result.rows.length - 1 ? () => goTo(activeIndex + 1) : undefined}
            onShortlist={() => void actions.shortlist([activeRow], { toggle: true })}
            onInvite={() => setInviteFor(activeRow)}
            invite={inviteStatus.index.forApplicant(activeRow.applicant)}
            onDownload={() => void actions.download(activeRow)}
            onOpenFullReport={() => setReportFor(activeRow.applicant)}
            originalResume={mode === 'candidates'}
            now={now}
          />
        </>
      ) : null}

      {inviteFor ? (
        <InviteApplicantDialog
          candidateName={inviteFor.applicant.candidateName}
          busy={busy[inviteFor.applicant.id] === 'invite'}
          onSubmit={(choice) => void submitInvite(choice)}
          onClose={() => setInviteFor(null)}
        />
      ) : null}

      {reportFor ? (
        <EmployerCandidateDocumentModal kind="report" applicant={reportFor} onClose={() => setReportFor(null)} />
      ) : null}
    </div>
  )
}
