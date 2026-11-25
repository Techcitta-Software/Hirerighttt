import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  relativeActive,
  resumeCertifications,
  resumeEducationEntries,
  resumeExperienceEntries,
  resumeLanguages,
  resumeProjects,
  resumeSummary,
  sourceLabel,
  type IndexedApplicant,
} from '../../lib/applicantSearch'
import { formatPhoneForDisplay, phoneTelHref } from '../../lib/phone'
import { HrIcon } from '../HrIcon'
import { Highlighted } from './Highlighted'
import styles from './Applicants.module.css'

type Props = {
  row: IndexedApplicant
  terms: string[]
  /** The row has an e-mail address (the API returns contact details for every candidate it lists). */
  contactVisible: boolean
  /** Rank among interviewed applicants for the job, when there are at least two. */
  rank?: { rank: number; total: number } | null
  /** Candidates page: job-specific tiles (rank, fit) only when they apply. */
  directory?: boolean
  now: number
  onOpenReport: () => void
}

function shortDate(iso: string | undefined): string {
  const d = new Date(String(iso ?? ''))
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "2 looking away, 1 another person": what the proctoring flags were, for the tooltip and screen readers. */
function proctoringBreakdown(row: IndexedApplicant): string {
  const counts = row.applicant.interviewResult?.integrity?.proctoring?.counts
  if (!counts) return ''
  return [
    counts.lookingSide ? `${counts.lookingSide} looking away` : '',
    counts.multiplePeople ? `${counts.multiplePeople} another person` : '',
    counts.noFace ? `${counts.noFace} no face` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

/** "Copy" next to a contact value: copies it and says so for two seconds (also to screen readers). */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = window.setTimeout(() => setState('idle'), 2000)
    return () => window.clearTimeout(t)
  }, [state])
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('done')
    } catch {
      setState('failed')
    }
  }
  return (
    <button type="button" className={styles.copyBtn} onClick={() => void copy()} aria-label={`Copy ${label}`}>
      <HrIcon name={state === 'done' ? 'check' : 'clipboard'} size={13} />
      <span aria-live="polite">{state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
    </button>
  )
}

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.pSection} aria-labelledby={`profile-${id}`} data-testid={`profile-${id}`}>
      <div className={styles.pSectionHead}>
        <h3 id={`profile-${id}`} className={styles.pH3}>
          {title}
        </h3>
        {aside ? <span className={styles.pAside}>{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * The Profile tab: the person as a recruiter reads them in ten seconds (interview signal, where they are, how to
 * reach them), then the resume read as a profile (about, skills, roles, projects, education, certifications,
 * languages). Everything comes from the application, the interview and the resume; nothing is guessed, and a section
 * with nothing to show is left out.
 */
export function ProfileDetails({ row, terms, contactVisible, rank = null, directory = false, now, onOpenReport }: Props) {
  const a = row.applicant
  const text = a.resumeText
  const roles = useMemo(() => resumeExperienceEntries(text), [text])
  const education = useMemo(() => resumeEducationEntries(text), [text])
  const about = useMemo(() => resumeSummary(text, 900), [text])
  const projects = useMemo(() => resumeProjects(text), [text])
  const certifications = useMemo(() => resumeCertifications(text), [text])
  const languages = useMemo(() => resumeLanguages(text), [text])

  const hit = (s: string) => {
    const k = s.toLowerCase()
    return terms.some((t) => k.includes(t) || t.includes(k))
  }
  const skills = [...row.skills].sort((x, y) => Number(hit(y)) - Number(hit(x)))
  const hits = terms.length ? skills.filter(hit).length : 0

  const interviewed = row.score !== null || Boolean(a.interviewResult)
  const showFit = row.fit !== null || !directory
  const showRank = Boolean(rank) || !directory
  const breakdown = proctoringBreakdown(row)

  const jobTitles = Array.from(
    new Set(
      (a.applications?.length ? a.applications.map((x) => x.jobTitle) : [a.jobTitle])
        .map((t) => String(t ?? '').trim())
        .filter(Boolean),
    ),
  )
  const active = relativeActive(row.lastActive, now)
  const applied = jobTitles.length ? shortDate(a.appliedAt) : ''
  const meta = [
    active ? { icon: 'clock' as const, text: active, title: shortDate(row.lastActive) } : null,
    applied ? { icon: 'calendar' as const, text: `Applied ${applied}`, title: '' } : null,
    // "Applied to your job" says nothing the "Applied to" chips below do not; other sources say how they got here.
    jobTitles.length ? null : { icon: 'user' as const, text: sourceLabel(a.recordSource), title: 'How they reached you' },
  ].filter((m): m is { icon: 'clock' | 'calendar' | 'user'; text: string; title: string } => Boolean(m))

  const hasResumeDetails = Boolean(
    about || skills.length || roles.length || projects.length || education.length || certifications.length || languages.length,
  )

  return (
    <div className={styles.profile} data-testid="profile-details">
      <div className={styles.snap}>
        {interviewed ? (
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
            {showRank ? (
              <div>
                <dt>Rank</dt>
                <dd>{rank ? `#${rank.rank} of ${rank.total}` : '—'}</dd>
              </div>
            ) : null}
            {showFit ? (
              <div>
                <dt>Skills fit</dt>
                <dd>{row.fit !== null ? `${Math.round(row.fit)}%` : '—'}</dd>
              </div>
            ) : null}
            <div>
              <dt>Proctoring</dt>
              <dd>
                {row.flags > 0 ? (
                  <span className={styles.flagText} title={breakdown || undefined}>
                    <HrIcon name="warning" size={13} /> {row.flags} flag{row.flags === 1 ? '' : 's'}
                    {breakdown ? <span className="ds-sr-only">: {breakdown}</span> : null}
                  </span>
                ) : (
                  <span className={styles.cleanText}>No flags</span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className={styles.snapEmpty}>
            <HrIcon name="mic" size={16} />
            <span>
              <strong>Not interviewed yet.</strong>{' '}
              {contactVisible
                ? 'Invite them to the AI interview to see a score, rank and skills fit here.'
                : 'Their score, rank and skills fit appear here once they finish an AI interview.'}
            </span>
          </p>
        )}
        {interviewed ? (
          <button type="button" className={styles.snapLink} onClick={onOpenReport}>
            View interview report <HrIcon name="arrow-right" size={13} />
          </button>
        ) : null}
      </div>

      <div className={styles.metaBlock}>
        <ul className={styles.metaList} aria-label="Activity">
          {meta.map((m) => (
            <li key={m.text} title={m.title || undefined}>
              <HrIcon name={m.icon} size={14} /> {m.text}
            </li>
          ))}
        </ul>
        {jobTitles.length ? (
          <div className={styles.appliedRow}>
            <span className={styles.appliedLabel}>Applied to</span>
            <ul className={styles.appliedChips} aria-label="Jobs applied to">
              {jobTitles.map((t) => (
                <li key={t} className={styles.jobChip}>
                  <HrIcon name="briefcase" size={12} /> {t}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Section id="contact" title="Contact">
        <dl className={styles.contactGrid} data-testid="profile-contact">
          <div>
            <dt>Email</dt>
            <dd>
              {contactVisible ? (
                <>
                  <a href={`mailto:${a.candidateEmail}`}>{a.candidateEmail}</a>
                  <CopyButton value={a.candidateEmail} label="email" />
                </>
              ) : (
                <span className={styles.muted}>Not provided</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>
              {a.candidatePhone ? (
                <>
                  <a href={phoneTelHref(a.candidatePhone)}>{formatPhoneForDisplay(a.candidatePhone)}</a>
                  <CopyButton value={formatPhoneForDisplay(a.candidatePhone)} label="phone number" />
                </>
              ) : (
                <span className={styles.muted}>Not provided</span>
              )}
            </dd>
          </div>
        </dl>
      </Section>

      {about ? (
        <Section id="about" title="About">
          <p className={styles.profileText}>
            <Highlighted text={about} terms={terms} />
          </p>
        </Section>
      ) : null}

      {skills.length ? (
        <Section
          id="skills"
          title="Key skills"
          aside={hits ? `${hits} match${hits === 1 ? 'es' : ''} your search` : `${skills.length} skill${skills.length === 1 ? '' : 's'}`}
        >
          <ul className={styles.panelSkills} aria-label="Key skills">
            {skills.map((s) =>
              hit(s) ? (
                <li key={s} className={`${styles.skillChip} ${styles.skillChipHit}`}>
                  <HrIcon name="check" size={11} />
                  <mark className={styles.markBare}>{s}</mark>
                </li>
              ) : (
                <li key={s} className={styles.skillChip}>
                  {s}
                </li>
              ),
            )}
          </ul>
        </Section>
      ) : null}

      {roles.length ? (
        <Section id="experience" title="Work experience">
          <ol className={styles.timeline}>
            {roles.map((r, i) => (
              <li key={`${r.title}-${r.company}-${i}`} className={styles.timelineItem}>
                <span className={styles.timelineDot} aria-hidden="true" />
                <div className={styles.timelineHead}>
                  <strong>
                    <Highlighted text={r.title} terms={terms} />
                  </strong>
                  {r.company ? (
                    <span className={styles.timelineCompany}>
                      <Highlighted text={r.company} terms={terms} />
                    </span>
                  ) : null}
                </div>
                {r.period || r.location ? (
                  <p className={styles.timelineMeta}>{[r.period, r.location].filter(Boolean).join(' · ')}</p>
                ) : null}
                {r.points.length ? (
                  <ul className={styles.timelinePoints}>
                    {r.points.map((p, j) => (
                      <li key={j}>
                        <Highlighted text={p} terms={terms} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {projects.length ? (
        <Section id="projects" title="Projects">
          <ul className={styles.plainList}>
            {projects.map((p) => (
              <li key={p}>
                <Highlighted text={p} terms={terms} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {education.length ? (
        <Section id="education" title="Education">
          <ul className={styles.eduList}>
            {education.map((e) => (
              <li key={e}>
                <HrIcon name="book" size={14} />
                <span>
                  <Highlighted text={e} terms={terms} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {certifications.length ? (
        <Section id="certifications" title="Certifications">
          <ul className={styles.eduList}>
            {certifications.map((c) => (
              <li key={c}>
                <HrIcon name="shield-check" size={14} />
                <span>
                  <Highlighted text={c} terms={terms} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {languages.length ? (
        <Section id="languages" title="Languages">
          <ul className={styles.panelSkills} aria-label="Languages">
            {languages.map((l) => (
              <li key={l} className={styles.skillChip}>
                {l}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {!hasResumeDetails ? (
        <p className={styles.profileEmpty} data-testid="profile-empty">
          <strong>No resume details on this profile yet.</strong>
          {a.hasResumeFile ? ' Their uploaded file is in the Resume tab.' : ''}
        </p>
      ) : null}
    </div>
  )
}
