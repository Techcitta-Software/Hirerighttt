import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { canViewInterviewVideo } from '../../lib/adminAccess'
import { SAVE_HINT, experienceLabel, sourceLabel, type IndexedApplicant, type PanelTabKey } from '../../lib/applicantSearch'
import { CareerIntelligenceDashboard } from '../CareerIntelligenceDashboard'
import { HrIcon } from '../HrIcon'
import { handleDialogKeyDown } from '../useDialog'
import { VideoProctorTimeline } from '../VideoProctorTimeline'
import { Highlighted } from './Highlighted'
import { ResumeFilePreview } from './ResumeFilePreview'
import styles from './Applicants.module.css'
import { appliedJobsLabel } from './applicantJobs'

export type PanelTab = PanelTabKey

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'resume', label: 'Resume' },
  { key: 'report', label: 'Interview report' },
  { key: 'contact', label: 'Contact' },
]

type Props = {
  row: IndexedApplicant
  terms: string[]
  /** Position in the current results, for "3 of 37" and previous / next. */
  position: { index: number; total: number }
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  saved: boolean
  busy?: string
  rankTotal?: number
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onShortlist: () => void
  onToggleSave: () => void
  onInvite: () => void
  onDownload: () => void
  onOpenFullReport: () => void
}

/**
 * The applicant drawer: resume (text with the searched keywords highlighted, or the original file), interview report
 * with the proctoring recording, and contact details. Contact details are only what the API returned: it already
 * removes them for candidates with no link to this organisation who did not opt in, and this keeps that rule.
 */
export function ApplicantResumePanel({
  row,
  terms,
  position,
  tab,
  onTab,
  saved,
  busy = '',
  rankTotal = 0,
  onClose,
  onPrev,
  onNext,
  onShortlist,
  onToggleSave,
  onInvite,
  onDownload,
  onOpenFullReport,
}: Props) {
  const a = row.applicant
  const hasText = Boolean(a.resumeText?.trim())
  const contactVisible = Boolean(a.candidateEmail) && !a.contactHidden
  const [resumeView, setResumeView] = useState<'text' | 'file'>(hasText ? 'text' : 'file')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // A different applicant: focus its name, start the resume at the top.
  useEffect(() => {
    setResumeView(a.resumeText?.trim() ? 'text' : 'file')
    headingRef.current?.focus()
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [a.id, a.resumeText])

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.key === tab)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next === -1) return
    e.preventDefault()
    onTab(TABS[next].key)
    document.getElementById(`applicant-tab-${TABS[next].key}`)?.focus()
  }

  const isApplication = a.recordSource === 'application' || (!a.recordSource && Boolean(a.jobId))
  const shortlisted = a.status === 'Shortlisted'
  const exp = experienceLabel(row)
  const showRank = typeof a.rank === 'number' && rankTotal >= 2

  return (
    <div
      className={styles.panel}
      data-applicant-panel
      role="dialog"
      aria-modal="true"
      aria-labelledby="applicant-panel-name"
      onKeyDown={(e) => handleDialogKeyDown(e, onClose)}
      data-testid="applicant-panel"
    >
      <header className={styles.panelHeader}>
        <div className={styles.panelNav}>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close applicant">
            <HrIcon name="close" size={16} />
          </button>
          <span className={styles.panelKeys} aria-hidden="true">
            <kbd>j</kbd>/<kbd>k</kbd> next / previous · <kbd>s</kbd> shortlist · <kbd>Esc</kbd> close
          </span>
          <span className={styles.panelPos} aria-live="polite">
            {position.index + 1} of {position.total}
          </span>
          <button type="button" className={styles.iconBtn} onClick={onPrev} disabled={!onPrev} aria-label="Previous applicant">
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className={styles.iconBtn} onClick={onNext} disabled={!onNext} aria-label="Next applicant">
            <span aria-hidden="true">›</span>
          </button>
        </div>

        <div className={styles.panelIdentity}>
          <div className={styles.panelTitleRow}>
            <h2 id="applicant-panel-name" ref={headingRef} tabIndex={-1} className={styles.panelName}>
              {a.candidateName}
            </h2>
            <span className={styles.panelScore} title="Overall AI interview score out of 100">
              {row.score !== null ? (
                <>
                  <strong>{Math.round(row.score)}</strong>/100
                  {showRank ? <span className={styles.panelRank}> · Rank #{a.rank} of {rankTotal}</span> : null}
                </>
              ) : (
                <span className={styles.notInterviewed}>Not interviewed</span>
              )}
            </span>
          </div>
          <p className={styles.panelSub}>
            {[a.role, exp, appliedJobsLabel(a) || sourceLabel(a.recordSource)].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className={styles.panelActions}>
          {isApplication ? (
            <button
              type="button"
              className={styles.actBtn}
              onClick={onShortlist}
              disabled={busy === 'shortlist'}
              aria-pressed={shortlisted}
            >
              <HrIcon name="check" size={14} /> {shortlisted ? 'Shortlisted' : busy === 'shortlist' ? 'Saving…' : 'Shortlist'}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.actBtn}
            onClick={onDownload}
            disabled={!contactVisible || busy === 'download'}
            aria-label={`Download ${a.candidateName}'s resume`}
            title={contactVisible ? 'Download the resume' : 'Contact details are hidden'}
          >
            <HrIcon name="download" size={14} /> Download
          </button>
          <button
            type="button"
            className={`${styles.actBtn} ${styles.actPrimary}`}
            onClick={onInvite}
            disabled={!contactVisible || busy === 'invite'}
            title={contactVisible ? 'Email an interview link' : 'Contact details are hidden'}
          >
            <HrIcon name="calendar" size={14} /> {busy === 'invite' ? 'Sending…' : 'Invite to interview'}
          </button>
          <button type="button" className={styles.actBtn} onClick={onToggleSave} aria-pressed={saved} title={SAVE_HINT}>
            <HrIcon name="star" size={14} /> {saved ? 'Saved for later' : 'Save for later'}
          </button>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Applicant details">
          {TABS.map((t) => (
            <button
              key={t.key}
              id={`applicant-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={`applicant-tabpanel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => onTab(t.key)}
              onKeyDown={onTabKey}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.panelBody} ref={bodyRef}>
        {tab === 'resume' ? (
          <section id="applicant-tabpanel-resume" role="tabpanel" aria-labelledby="applicant-tab-resume" tabIndex={0}>
            {hasText && contactVisible ? (
              <div className={styles.segmented} role="group" aria-label="Resume view">
                <button type="button" aria-pressed={resumeView === 'text'} onClick={() => setResumeView('text')}>
                  Highlighted text
                </button>
                <button type="button" aria-pressed={resumeView === 'file'} onClick={() => setResumeView('file')}>
                  Original file
                </button>
              </div>
            ) : null}
            {resumeView === 'text' && hasText ? (
              <>
                {row.skills.length ? (
                  <ul className={styles.panelSkills} aria-label="Key skills">
                    {row.skills.slice(0, 16).map((s) => (
                      <li key={s} className={styles.skillChip}>
                        <Highlighted text={s} terms={terms} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className={styles.resumeText} data-testid="resume-text">
                  <Highlighted text={a.resumeText || ''} terms={terms} />
                </div>
              </>
            ) : contactVisible ? (
              <ResumeFilePreview
                candidateEmail={a.candidateEmail}
                candidateName={a.candidateName}
                fallbackText={a.resumeText}
                onDownload={onDownload}
              />
            ) : (
              <p className={styles.panelNote}>No resume is available for this applicant.</p>
            )}
          </section>
        ) : tab === 'report' ? (
          <section id="applicant-tabpanel-report" role="tabpanel" aria-labelledby="applicant-tab-report" tabIndex={0}>
            {a.interviewResult ? (
              <>
                <dl className={styles.reportSummary}>
                  <div>
                    <dt>Interview score</dt>
                    <dd>{row.score !== null ? `${Math.round(row.score)}/100` : '—'}</dd>
                  </div>
                  <div>
                    <dt>Rank</dt>
                    <dd>{showRank ? `#${a.rank} of ${rankTotal}` : '—'}</dd>
                  </div>
                  <div>
                    <dt>Skills fit</dt>
                    <dd>{row.fit !== null ? `${Math.round(row.fit)}%` : '—'}</dd>
                  </div>
                  <div>
                    <dt>Proctoring</dt>
                    <dd className={row.flags > 0 ? styles.flagText : undefined}>
                      {row.flags > 0 ? `${row.flags} flag${row.flags === 1 ? '' : 's'}` : 'No flags'}
                    </dd>
                  </div>
                </dl>
                <button type="button" className={styles.linkBtn} onClick={onOpenFullReport}>
                  Open the full report and recording <HrIcon name="arrow-up-right" size={12} />
                </button>
                <CareerIntelligenceDashboard
                  embedded
                  variant="detailed"
                  audience="recruiter"
                  result={a.interviewResult}
                  candidateName={a.candidateName}
                  candidateRole={a.role || a.jobTitle}
                  candidateExperience={exp || a.experienceYears}
                  skills={row.skills}
                />
                {canViewInterviewVideo() && a.interviewResult.sessionId && contactVisible ? (
                  <div className={styles.timelineBox}>
                    <h3 className={styles.panelH3}>Interview recording and proctoring timeline</h3>
                    <VideoProctorTimeline
                      sessionId={a.interviewResult.sessionId}
                      candidateEmail={a.candidateEmail}
                      logs={a.interviewResult.integrity?.logs}
                      proctoring={a.interviewResult.integrity?.proctoring}
                      hideTitle
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.panelNote}>
                <p>
                  <strong>No interview yet.</strong> Send an interview link and the report appears here once they finish.
                </p>
                {contactVisible ? (
                  <button type="button" className={`${styles.actBtn} ${styles.actPrimary}`} onClick={onInvite}>
                    <HrIcon name="calendar" size={14} /> Invite to interview
                  </button>
                ) : null}
              </div>
            )}
          </section>
        ) : (
          <section id="applicant-tabpanel-contact" role="tabpanel" aria-labelledby="applicant-tab-contact" tabIndex={0}>
            {contactVisible ? (
              <dl className={styles.contactList}>
                <div>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${a.candidateEmail}`}>{a.candidateEmail}</a>
                  </dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>
                    {a.candidatePhone ? <a href={`tel:${a.candidatePhone.replace(/\s+/g, '')}`}>{a.candidatePhone}</a> : '—'}
                  </dd>
                </div>
                <div>
                  <dt>How they reached you</dt>
                  <dd>{sourceLabel(a.recordSource)}</dd>
                </div>
              </dl>
            ) : (
              <div className={styles.panelNote} data-testid="contact-locked">
                <p>
                  <HrIcon name="lock" size={14} /> <strong>Contact details are locked.</strong> They are shared once this
                  person applies to one of your jobs or chooses to share them with recruiters.
                </p>
                <Link to="/employer/jobs" className={`${styles.actBtn} ${styles.actPrimary}`}>
                  Invite to apply
                </Link>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
