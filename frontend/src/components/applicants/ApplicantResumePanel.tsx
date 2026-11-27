import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { formatPhoneForDisplay, phoneTelHref } from '../../lib/phone'
import { experienceLabel, interviewProgressLabel, type IndexedApplicant, type PanelTabKey } from '../../lib/applicantSearch'
import { CareerIntelligenceDashboard } from '../CareerIntelligenceDashboard'
import { HrIcon } from '../HrIcon'
import type { InviteStatus } from '../../lib/vendorApi'
import { InviteStatusLine } from './InviteStatusLine'
import { handleDialogKeyDown } from '../useDialog'
import { InterviewVideoSection } from './InterviewVideoSection'
import { ProfileDetails } from './ProfileDetails'
import { ResumeFilePreview } from './ResumeFilePreview'
import styles from './Applicants.module.css'
import sections from './ReportSections.module.css'

export type PanelTab = PanelTabKey

/** Profile is the landing tab; the original resume file and the interview report follow. */
const TABS: { key: PanelTab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'resume', label: 'Resume' },
  { key: 'report', label: 'Interview report' },
]

const VIDEO_ID = 'applicant-report-video'

/** Date on the interview result, when the API sent one. */
function interviewRecordDate(result: { date?: string; completedAt?: string; createdAt?: string }): string {
  const iso = result.completedAt || result.createdAt || result.date
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** In-tab link: scroll the drawer to a report section and move focus to its heading. */
function jumpTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const target = el.closest('section') ?? el
  target.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  el.focus({ preventScroll: true })
}

type Props = {
  row: IndexedApplicant
  terms: string[]
  /** Position in the current results, for "3 of 37" and previous / next. */
  position: { index: number; total: number }
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  busy?: string
  rankTotal?: number
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onShortlist: () => void
  onInvite: () => void
  onDownload: () => void
  onOpenFullReport: () => void
  /** Candidates: the original S3 file opens for anyone listed (by user id), not only by the contact rule. */
  originalResume?: boolean
  /** "Now" for "Active 3 days ago" (fixed in tests). */
  now?: number
  /** Latest interview invite for this person: its state and the link as text. */
  invite?: InviteStatus | null
}

/**
 * The applicant drawer: Profile (the landing tab: interview signal, contact, and the resume read as a profile), the
 * original resume file, and the interview report with the proctoring recording. Owner decision: e-mail, phone, the
 * original file and the full report are shown for every candidate the API returns (it leaves out hidden profiles).
 */
export function ApplicantResumePanel({
  row,
  terms,
  position,
  tab,
  onTab,
  busy = '',
  rankTotal = 0,
  invite = null,
  onClose,
  onPrev,
  onNext,
  onShortlist,
  onInvite,
  onDownload,
  onOpenFullReport,
  originalResume = false,
  now: nowProp,
}: Props) {
  const a = row.applicant
  const [now] = useState(() => nowProp ?? Date.now())
  const contactVisible = Boolean(a.candidateEmail)
  // Applications: by e-mail. Candidates: the stored file by user id (the API decides who may open it).
  const canOriginal = originalResume
    ? Boolean(a.hasResumeFile && (a.candidateUserId || a.candidateEmail))
    : contactVisible
  const person = originalResume ? 'candidate' : 'applicant'
  // The API said this person has no stored file (application rows do not say so up front).
  const [missingFileFor, setMissingFileFor] = useState<string | null>(null)
  const fileMissing = missingFileFor === a.id
  const headingRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // A different applicant: focus its name, start at the top.
  useEffect(() => {
    headingRef.current?.focus()
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [a.id])

  // Another tab starts at the top too (the header stays put, so nothing moves under the pointer).
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [tab])

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
  const showRank = typeof a.rank === 'number' && rankTotal >= 1
  // "Frontend Developer at CartWave · 4 yrs · Chennai": the resume headline, else the resolved current role.
  const title = row.headline.title || row.roleLabel || ''
  const progressLabel = interviewProgressLabel(a)
  const roleLine = title && row.headline.company ? `${title} at ${row.headline.company}` : title
  const hasText = Boolean(a.resumeText?.trim())
  // Nothing to download: no file stored (the API said so, or the directory row says so) and no resume text either.
  const nothingToDownload = (fileMissing || (originalResume && !a.hasResumeFile)) && !hasText
  const downloadDisabled =
    (originalResume ? !a.hasResumeFile && !contactVisible : !contactVisible) || nothingToDownload || busy === 'download'
  const fileName = /\.(pdf|docx?)$/i.test(a.resumeName || '') ? (a.resumeName as string) : 'Original resume'
  const interviewedOn = a.interviewResult ? interviewRecordDate(a.interviewResult) : ''
  const interviewScore = a.interviewResult
    ? Math.round(typeof a.interviewResult.overall === 'number' ? a.interviewResult.overall : (row.score ?? 0))
    : null

  function goTab(next: PanelTab) {
    onTab(next)
    window.setTimeout(() => document.getElementById(`applicant-tab-${next}`)?.focus(), 0)
  }

  return (
    <div
      className={`${styles.panel}${originalResume ? ` ${styles.panelOriginal}` : ''}`}
      data-applicant-panel
      role="dialog"
      aria-modal="true"
      aria-labelledby="applicant-panel-name"
      onKeyDown={(e) => handleDialogKeyDown(e, onClose)}
      data-testid="applicant-panel"
    >
      <header className={styles.panelHeader}>
        <div className={styles.panelNav}>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label={`Close ${person}`}>
            <HrIcon name="close" size={16} />
          </button>
          <span className={styles.panelKeys} aria-hidden="true">
            <kbd>j</kbd>/<kbd>k</kbd> next / previous · <kbd>s</kbd> shortlist · <kbd>Esc</kbd> close
          </span>
          <span className={styles.panelPos} aria-live="polite">
            {position.index + 1} of {position.total}
          </span>
          <button type="button" className={styles.iconBtn} onClick={onPrev} disabled={!onPrev} aria-label={`Previous ${person}`}>
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className={styles.iconBtn} onClick={onNext} disabled={!onNext} aria-label={`Next ${person}`}>
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
              ) : progressLabel ? (
                <span className={styles.inProgressText}>{progressLabel}</span>
              ) : (
                <span className={styles.notInterviewed}>Not interviewed</span>
              )}
            </span>
          </div>
          <p className={styles.panelSub}>
            {[roleLine, exp, row.headline.location].filter(Boolean).join(' · ')}
          </p>
          {invite ? <InviteStatusLine invite={invite} showUrl /> : null}
          {contactVisible || a.candidatePhone ? (
            <p className={styles.panelContact} aria-label="Contact" data-testid="panel-contact">
              {contactVisible ? (
                <a href={`mailto:${a.candidateEmail}`}>{a.candidateEmail}</a>
              ) : null}
              {a.candidatePhone ? (
                <a href={phoneTelHref(a.candidatePhone)}>{formatPhoneForDisplay(a.candidatePhone)}</a>
              ) : null}
            </p>
          ) : null}
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
            disabled={downloadDisabled}
            aria-label={`Download ${a.candidateName}'s resume`}
            title={
              originalResume && a.hasResumeFile
                ? 'Download the original resume'
                : !contactVisible
                  ? 'No resume on file'
                  : nothingToDownload
                    ? 'No resume uploaded'
                : fileMissing
                  ? 'No original resume file is stored'
                  : 'Download the original resume'
            }
          >
            <HrIcon name="download" size={14} /> Download
          </button>
          <button
            type="button"
            className={`${styles.actBtn} ${styles.actPrimary}`}
            onClick={onInvite}
            disabled={!contactVisible || busy === 'invite'}
            title={contactVisible ? 'Email an interview link' : 'No e-mail address on file'}
          >
            <HrIcon name="message" size={14} /> {busy === 'invite' ? 'Sending…' : 'Invite to interview'}
          </button>
        </div>

        <div className={styles.tabs} role="tablist" aria-label={originalResume ? 'Candidate details' : 'Applicant details'}>
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
        {tab === 'profile' ? (
          <section id="applicant-tabpanel-profile" role="tabpanel" aria-labelledby="applicant-tab-profile" tabIndex={0}>
            <div className={styles.snap} data-testid="profile-interview">
              {a.interviewResult ? (
                <>
                  <p className={styles.snapEmpty}>
                    <span>
                      <strong>{interviewScore}</strong>
                      <span className={styles.snapMax}>/100</span>
                      {interviewedOn ? ` · ${interviewedOn}` : ''}
                    </span>
                  </p>
                  <button type="button" className={styles.snapLink} onClick={() => goTab('report')}>
                    Open report
                  </button>
                </>
              ) : (
                <p className={styles.snapEmpty}>No interview yet</p>
              )}
            </div>
            <ProfileDetails
              row={row}
              terms={terms}
              contactVisible={contactVisible}
              rank={showRank ? { rank: a.rank as number, total: rankTotal } : null}
              directory={originalResume}
              now={now}
              onOpenReport={() => goTab('report')}
            />
          </section>
        ) : tab === 'resume' ? (
          <section id="applicant-tabpanel-resume" role="tabpanel" aria-labelledby="applicant-tab-resume" tabIndex={0}>
            {canOriginal && !fileMissing ? (
              <div className={styles.resumeCanvasInline}>
                <div className={styles.resumeBar}>
                  <span className={styles.resumeFileName} title={fileName}>
                    <HrIcon name="document" size={14} />
                    <span>{fileName}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.actBtn}
                    onClick={onDownload}
                    disabled={downloadDisabled}
                    aria-label={`Download ${a.candidateName}'s original resume`}
                  >
                    <HrIcon name="download" size={14} /> {busy === 'download' ? 'Downloading…' : 'Download'}
                  </button>
                </div>
                <div className={styles.resumeSheet}>
                  <ResumeFilePreview
                    candidateEmail={a.candidateEmail}
                    candidateUserId={originalResume ? a.candidateUserId : undefined}
                    candidateName={a.candidateName}
                    onDownload={onDownload}
                    onMissing={() => setMissingFileFor(a.id)}
                  />
                </div>
              </div>
            ) : (
              <div className={styles.resumeEmpty} data-testid="resume-empty">
                <span className={styles.resumeEmptyIcon} aria-hidden="true">
                  <HrIcon name="document" size={22} />
                </span>
                <h3 className={styles.resumeEmptyTitle}>No resume file uploaded</h3>
                <p>
                  {a.resumeText?.trim()
                    ? 'Their skills, experience and education are in the Profile tab.'
                    : 'Profile details appear in the Profile tab once they add a resume.'}
                </p>
                <button type="button" className={styles.actBtn} onClick={() => goTab('profile')}>
                  Go to Profile
                </button>
              </div>
            )}
          </section>
        ) : tab === 'report' ? (
          <section id="applicant-tabpanel-report" role="tabpanel" aria-labelledby="applicant-tab-report" tabIndex={0}>
            {a.interviewResult ? (
              <>
                <div className={styles.snap}>
                  <dl className={styles.snapStats} aria-label="Interview summary">
                    <div>
                      <dt>Interview score</dt>
                      <dd>
                        {row.score !== null ? (
                          <>
                            <strong>{Math.round(row.score)}</strong>
                            <span className={styles.snapMax}>/100</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    {originalResume && !showRank ? null : (
                      <div>
                        <dt>Rank</dt>
                        <dd>{showRank ? `#${a.rank} of ${rankTotal}` : '—'}</dd>
                      </div>
                    )}
                    {originalResume && row.fit === null ? null : (
                      <div>
                        <dt>Skills fit</dt>
                        <dd>{row.fit !== null ? `${Math.round(row.fit)}%` : '—'}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Proctoring</dt>
                      <dd>
                        {row.flags > 0 ? (
                          <span className={styles.flagText}>
                            <HrIcon name="warning" size={13} /> {row.flags} flag{row.flags === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className={styles.cleanText}>No flags</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <button type="button" className={styles.snapLink} onClick={onOpenFullReport}>
                    Open the full report and recording <HrIcon name="arrow-up-right" size={13} />
                  </button>
                </div>
                <nav className={sections.jump} aria-label="On this tab">
                  <span className={sections.jumpLabel}>Jump to</span>
                  <button type="button" className={sections.jumpLink} onClick={() => jumpTo(VIDEO_ID)}>
                    Interview video
                  </button>
                </nav>
                <CareerIntelligenceDashboard
                  embedded
                  result={a.interviewResult}
                  candidateName={a.candidateName}
                  candidateRole={a.role || a.jobTitle}
                  candidateExperience={exp || a.experienceYears}
                  skills={row.skills}
                />
                <InterviewVideoSection
                  sessionId={a.interviewResult.sessionId}
                  candidateEmail={contactVisible ? a.candidateEmail : null}
                  candidateName={a.candidateName}
                  logs={a.interviewResult.integrity?.logs}
                  proctoring={a.interviewResult.integrity?.proctoring}
                  headingId={VIDEO_ID}
                />
              </>
            ) : (
              <div className={styles.resumeEmpty} data-testid="report-empty">
                <span className={styles.resumeEmptyIcon} aria-hidden="true">
                  <HrIcon name="mic" size={22} />
                </span>
                <h3 className={styles.resumeEmptyTitle}>No interview yet</h3>
                <p>
                  {contactVisible
                    ? 'Send an interview link and the report appears here once they finish.'
                    : 'The report appears here once they finish an AI interview.'}
                </p>
                {contactVisible ? (
                  <button
                    type="button"
                    className={`${styles.actBtn} ${styles.actPrimary}`}
                    onClick={onInvite}
                    disabled={busy === 'invite'}
                  >
                    <HrIcon name="message" size={14} /> {busy === 'invite' ? 'Sending…' : 'Invite to interview'}
                  </button>
                ) : null}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}
