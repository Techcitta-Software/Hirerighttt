import { useMemo } from 'react'
import {
  experienceLabel,
  resumeEducationEntries,
  resumeExperienceEntries,
  type IndexedApplicant,
} from '../../lib/applicantSearch'
import { HrIcon } from '../HrIcon'
import { Highlighted } from './Highlighted'
import styles from './Applicants.module.css'

type Props = {
  row: IndexedApplicant
  terms: string[]
}

/**
 * "Profile details": the resume read as a profile (summary, key skills, roles as a timeline, education), the way a
 * resume database shows a person before the full text. Everything comes from the resume and the profile; nothing is
 * guessed, and a section with nothing to show is left out.
 */
export function ProfileDetails({ row, terms }: Props) {
  const a = row.applicant
  const roles = useMemo(() => resumeExperienceEntries(a.resumeText), [a.resumeText])
  const education = useMemo(() => resumeEducationEntries(a.resumeText), [a.resumeText])
  const exp = experienceLabel(row)
  const facts = [
    { label: 'Current role', value: [row.headline.title || a.role, row.headline.company].filter(Boolean).join(' at ') },
    { label: 'Experience', value: exp },
    { label: 'Location', value: row.headline.location },
  ].filter((f) => f.value)

  if (!facts.length && !row.summary && !row.skills.length && !roles.length && !education.length) return null

  return (
    <section className={styles.profileCard} aria-labelledby="profile-details-title" data-testid="profile-details">
      <h3 id="profile-details-title" className={styles.profileTitle}>
        Profile details
      </h3>

      {facts.length ? (
        <dl className={styles.profileFacts}>
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                <Highlighted text={f.value} terms={terms} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {row.summary ? (
        <div className={styles.profileBlock}>
          <h4 className={styles.profileH4}>Summary</h4>
          <p className={styles.profileText}>
            <Highlighted text={row.summary} terms={terms} />
          </p>
        </div>
      ) : null}

      {row.skills.length ? (
        <div className={styles.profileBlock}>
          <h4 className={styles.profileH4}>Key skills</h4>
          <ul className={styles.panelSkills} aria-label="Key skills">
            {row.skills.slice(0, 20).map((s) => (
              <li key={s} className={styles.skillChip}>
                <Highlighted text={s} terms={terms} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {roles.length ? (
        <div className={styles.profileBlock}>
          <h4 className={styles.profileH4}>Experience</h4>
          <ol className={styles.timeline}>
            {roles.map((r, i) => (
              <li key={`${r.title}-${r.company}-${i}`} className={styles.timelineItem}>
                <span className={styles.timelineDot} aria-hidden="true" />
                <div className={styles.timelineHead}>
                  <strong>
                    <Highlighted text={r.title} terms={terms} />
                  </strong>
                  {r.company ? (
                    <span>
                      {' '}
                      at <Highlighted text={r.company} terms={terms} />
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
        </div>
      ) : null}

      {education.length ? (
        <div className={styles.profileBlock}>
          <h4 className={styles.profileH4}>Education</h4>
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
        </div>
      ) : null}
    </section>
  )
}
