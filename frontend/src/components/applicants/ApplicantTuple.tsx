import { memo, useRef, type MouseEvent } from 'react'
import {
  SAVE_HINT,
  experienceLabel,
  keywordSnippet,
  relativeActive,
  sourceLabel,
  type IndexedApplicant,
} from '../../lib/applicantSearch'
import { HrIcon } from '../HrIcon'
import { Highlighted } from './Highlighted'
import { appliedJobsLabel, jobPageJobsLabel, scoreJobTitle } from './applicantJobs'
import styles from './Applicants.module.css'

/** The current page's URL with this applicant's drawer open (filters, search and page kept). */
function applicantHref(id: string): string {
  if (typeof window === 'undefined') return `?applicant=${encodeURIComponent(id)}`
  const params = new URLSearchParams(window.location.search)
  params.set('applicant', id)
  params.delete('tab')
  return `${window.location.pathname}?${params.toString()}`
}

export type TupleAction = 'view' | 'download' | 'shortlist' | 'save' | 'invite'

type Props = {
  row: IndexedApplicant
  terms: string[]
  selected: boolean
  active: boolean
  saved: boolean
  busy?: string
  now: number
  /** How many applicants of this row's job have a rank (rank is shown when 2 or more do). */
  rankTotal?: number
  /** Candidates (the resume database): job-specific signals (rank, skills fit) show only when the person has them. */
  directory?: boolean
  /** Set on one job's own page: the "Applied to" chip then names only the person's other jobs. */
  pageJobId?: string
  onToggleSelect: (id: string) => void
  onAction: (action: TupleAction, row: IndexedApplicant) => void
}

/** Same thresholds as the Score component; the colour only supports the number, it never replaces it. */
function absoluteDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function flagSummary(row: IndexedApplicant): string {
  const counts = row.applicant.interviewResult?.integrity?.proctoring?.counts
  if (!counts) return `${row.flags} proctoring flag${row.flags === 1 ? '' : 's'}`
  const parts = [
    counts.lookingSide ? `${counts.lookingSide} looking away` : '',
    counts.multiplePeople ? `${counts.multiplePeople} another person` : '',
    counts.noFace ? `${counts.noFace} no face` : '',
  ].filter(Boolean)
  return parts.length ? `Proctoring flags: ${parts.join(', ')}` : `${row.flags} proctoring flags`
}

/** One result: who, what they know and how they interviewed, with the recruiter's actions. No contact details here. */
export const ApplicantTuple = memo(function ApplicantTuple({
  row,
  terms,
  selected,
  active,
  saved,
  busy = '',
  now,
  rankTotal = 0,
  directory = false,
  pageJobId = '',
  onToggleSelect,
  onAction,
}: Props) {
  const a = row.applicant
  const moreRef = useRef<HTMLDetailsElement>(null)
  const contactVisible = Boolean(a.candidateEmail) && !a.contactHidden
  const canDownloadOriginal = directory && Boolean(a.hasResumeFile)
  const isApplication = a.recordSource === 'application' || (!a.recordSource && Boolean(a.jobId))
  const shortlisted = a.status === 'Shortlisted'
  const skillHit = (s: string) => {
    const k = s.toLowerCase()
    return terms.some((t) => k.includes(t) || t.includes(k))
  }
  const skills = [...row.skills].sort((x, y) => Number(skillHit(y)) - Number(skillHit(x))).slice(0, 8)
  // A searched keyword in the resume shows where it appears; otherwise the resume's own summary (never its header).
  const snippet = keywordSnippet(a.resumeText, terms)
  const summary = snippet ? '' : row.summary
  const exp = experienceLabel(row)
  const activeLabel = relativeActive(row.lastActive, now)
  const appliedLabel = a.appliedAt
    ? new Date(a.appliedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : ''
  const showRank = typeof a.rank === 'number' && rankTotal >= 2
  // Several jobs: list them all, and say which job the interview score and the rank belong to.
  const appliedToLabel = pageJobId ? jobPageJobsLabel(a, pageJobId) : appliedJobsLabel(a)
  const scoreFrom = scoreJobTitle(a)
  const multiJob = (a.applications?.length ?? 0) > 1
  const name = a.candidateName
  // "Senior Engineer at Flipside" from the resume headline; the application's role when the resume has no title.
  const title = row.headline.title || a.role || ''
  const roleLine = title && row.headline.company ? `${title} at ${row.headline.company}` : title

  // The whole row opens the resume, except clicks on its own controls.
  function onCardClick(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('button, a, input, label, summary, details')) return
    onAction('view', row)
  }

  function act(action: TupleAction) {
    if (moreRef.current) moreRef.current.open = false
    onAction(action, row)
  }

  const actionButtons = (
    <>
      <button
        type="button"
        className={styles.actBtn}
        onClick={() => act('download')}
        disabled={(!contactVisible && !canDownloadOriginal) || busy === 'download'}
        aria-label={`Download ${name}'s resume`}
        title={
          canDownloadOriginal
            ? 'Download the original resume'
            : contactVisible
              ? 'Download resume'
              : 'Contact details are hidden'
        }
      >
        <HrIcon name="download" size={14} /> <span className={styles.actLabel}>Download</span>
      </button>
      {isApplication ? (
        <button
          type="button"
          className={styles.actBtn}
          onClick={() => act('shortlist')}
          disabled={busy === 'shortlist'}
          aria-pressed={shortlisted}
          aria-label={shortlisted ? `${name} is shortlisted` : `Shortlist ${name}`}
        >
          <HrIcon name="check" size={14} /> {shortlisted ? 'Shortlisted' : 'Shortlist'}
        </button>
      ) : null}
      <button
        type="button"
        className={styles.actBtn}
        onClick={() => act('save')}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${name} from Saved for later` : `Save ${name} for later`}
        title={SAVE_HINT}
      >
        <HrIcon name="star" size={14} />{' '}
        <span className={styles.actLabel}>{saved ? 'Saved for later' : 'Save for later'}</span>
      </button>
      <button
        type="button"
        className={styles.actBtn}
        onClick={() => act('invite')}
        disabled={!contactVisible || busy === 'invite'}
        aria-label={`Invite ${name} to interview`}
        title={contactVisible ? 'Email an interview link' : 'Contact details are hidden'}
      >
        <HrIcon name="calendar" size={14} />{' '}
        <span className={styles.actLabel}>{busy === 'invite' ? 'Sending…' : 'Invite'}</span>
      </button>
    </>
  )

  return (
    <article
      className={`${styles.tuple} ${active ? styles.tupleActive : ''} ${selected ? styles.tupleSelected : ''}`}
      aria-labelledby={`tuple-name-${a.id}`}
      aria-current={active ? 'true' : undefined}
      onClick={onCardClick}
      data-testid="applicant-tuple"
    >
      <label className={styles.tupleCheck}>
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(a.id)} aria-label={`Select ${name}`} />
      </label>

      <div className={styles.tupleMain}>
        <h3 className={styles.tupleHead}>
          {/* A real link, so Ctrl/Cmd-click or middle-click opens this applicant in a new tab with the current
              search kept; a plain click opens the drawer in place. */}
          <a
            href={`?applicant=${encodeURIComponent(a.id)}`}
            id={`tuple-name-${a.id}`}
            className={styles.nameBtn}
            onMouseDown={(e) => {
              e.currentTarget.href = applicantHref(a.id)
            }}
            onFocus={(e) => {
              e.currentTarget.href = applicantHref(a.id)
            }}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              e.preventDefault()
              onAction('view', row)
            }}
            aria-current={active ? 'true' : undefined}
            title={name}
          >
            <Highlighted text={name} terms={terms} />
          </a>
          {roleLine ? (
            <span className={styles.tupleTitle} title={roleLine}>
              <Highlighted text={roleLine} terms={terms} />
            </span>
          ) : null}
        </h3>

        <p className={styles.metaLine}>
          <span>{exp || 'Experience —'}</span>
          {row.headline.location ? (
            <span title={`Location on the resume: ${row.headline.location}`}>
              <HrIcon name="map-pin" size={12} /> {row.headline.location}
            </span>
          ) : null}
          {appliedToLabel ? (
            <span className={styles.jobChip} title={appliedToLabel.replace(/^(Also applied|Applied) to:/, (m) => m.replace(' to:', ' for'))}>
              {appliedToLabel}
            </span>
          ) : pageJobId ? null : (
            <span>{sourceLabel(a.recordSource)}</span>
          )}
          {a.contactHidden ? (
            <span className={styles.lockText} title="Contact details are shared once this person applies to one of your jobs or opts in">
              <HrIcon name="lock" size={11} /> Contact locked
            </span>
          ) : null}
          {shortlisted ? <span className={styles.statusText}>Shortlisted</span> : null}
          {saved ? <span className={styles.statusText}>Saved for later</span> : null}
          {row.education ? (
            <span className={styles.metaEdu} title={row.education}>
              {row.education}
            </span>
          ) : null}
        </p>

        <ul className={styles.skillRow} aria-label="Key skills">
          {skills.length ? (
            skills.map((s) => {
              const hit = skillHit(s)
              return (
                <li key={s} className={`${styles.skillChip} ${hit ? styles.skillChipHit : ''}`}>
                  {hit ? (
                    <>
                      <HrIcon name="check" size={11} />
                      <mark className={styles.markBare}>{s}</mark>
                    </>
                  ) : (
                    s
                  )}
                </li>
              )
            })
          ) : (
            <li className={styles.skillNone}>No skills listed</li>
          )}
          {row.skills.length > skills.length ? (
            <li className={styles.skillMore}>+{row.skills.length - skills.length} more</li>
          ) : null}
        </ul>

        {snippet ? (
          <p className={styles.snippet}>
            <Highlighted text={snippet} terms={terms} />
          </p>
        ) : summary ? (
          <p className={styles.summary} title={summary}>
            <span className={styles.summaryLabel}>Summary</span> {summary}
          </p>
        ) : null}
      </div>

      <dl className={styles.signals}>
        <div className={styles.sigScore}>
          <dt className="ds-sr-only">Interview score</dt>
          <dd title="Overall AI interview score out of 100, after any proctoring deduction">
            {row.score !== null ? (
              <>
                <span className={styles.scoreNum}>
                  {Math.round(row.score)}
                  <span className={styles.scoreMax}>/100</span>
                </span>
                {scoreFrom ? (
                  <span className={styles.sigNote} title={`Interview taken for ${scoreFrom}`}>
                    {scoreFrom} interview
                  </span>
                ) : null}
              </>
            ) : (
              <span className={styles.notInterviewed}>Not interviewed</span>
            )}
          </dd>
        </div>
        {directory && !showRank ? null : (
        <div>
          <dt>Rank</dt>
          <dd title={showRank ? `Rank among interviewed applicants for ${a.jobTitle}` : undefined}>
            {showRank ? `#${a.rank} of ${rankTotal}` : '—'}
            {showRank && multiJob && a.jobTitle ? <span className={styles.sigNote}>{a.jobTitle}</span> : null}
          </dd>
        </div>
        )}
        {directory && row.fit === null ? null : (
        <div>
          <dt>Skills fit</dt>
          <dd title="How many of the role's required skills are on the resume and shown in the interview">
            {row.fit !== null ? (
              <>
                {Math.round(row.fit)}%
                <span className={styles.fitBar} aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, row.fit))}%` }} />
                </span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        )}
        {directory && row.interview !== 'completed' ? null : (
        <div>
          <dt>Proctoring</dt>
          <dd>
            {row.interview !== 'completed' ? (
              '—'
            ) : row.flags > 0 ? (
              <span className={styles.flagText} title={flagSummary(row)}>
                <HrIcon name="warning" size={12} /> {row.flags} flag{row.flags === 1 ? '' : 's'}
                {/* The breakdown for keyboard and screen-reader users too, not only the mouse tooltip. */}
                <span className="ds-sr-only">. {flagSummary(row)}</span>
              </span>
            ) : (
              <span className={styles.cleanText}>No flags</span>
            )}
          </dd>
        </div>
        )}
      </dl>

      <div className={styles.tupleFoot}>
        <span className={styles.footDates}>
          {activeLabel ? <span title={absoluteDate(row.lastActive)}>{activeLabel}</span> : null}
          {appliedLabel && a.jobTitle ? <span title={absoluteDate(a.appliedAt)}>Applied {appliedLabel}</span> : null}
        </span>
        <div className={styles.footActions}>
          <button type="button" className={styles.actBtn} onClick={() => onAction('view', row)}>
            <HrIcon name="eye" size={14} /> View resume
          </button>
          <span className={styles.wideActions}>{actionButtons}</span>
          <details ref={moreRef} className={styles.moreMenu}>
            <summary className={styles.iconBtn} aria-label={`More actions for ${name}`}>
              <span aria-hidden="true">⋯</span>
            </summary>
            <div className={styles.moreList}>{actionButtons}</div>
          </details>
        </div>
      </div>
    </article>
  )
})
