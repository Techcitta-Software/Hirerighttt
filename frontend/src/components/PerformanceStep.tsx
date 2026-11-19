import {
  TIME_PERIOD_OPTIONS,
  createEmptyCertification,
  createEmptyMetric,
  mentionedInResume,
  type ProfileFormData,
} from '../data/wizard'
import { MotionStack } from '../motion/MotionStack'
import { SelectField } from './SelectField'
import { toMonthInputValue } from '../lib/resumeExperience'
import styles from './PerformanceStep.module.css'

interface PerformanceStepProps {
  data: ProfileFormData
  onChange: <K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K],
  ) => void
}

const MAX_ACHIEVEMENTS = 5
const MAX_AWARDS = 5
const MAX_CERTS = 5
const MAX_METRICS = 8

export function PerformanceStep({ data, onChange }: PerformanceStepProps) {
  function updateAchievement(index: number, value: string) {
    const next = [...data.achievements]
    next[index] = value
    onChange('achievements', next)
  }

  function addAchievement() {
    if (data.achievements.length >= MAX_ACHIEVEMENTS) return
    onChange('achievements', [...data.achievements, ''])
  }

  function removeAchievement(index: number) {
    if (data.achievements.length <= 1) {
      onChange('achievements', [''])
      return
    }
    onChange(
      'achievements',
      data.achievements.filter((_, i) => i !== index),
    )
  }

  function updateMetric(
    id: string,
    key: 'metric' | 'contribution' | 'impact' | 'timePeriod',
    value: string,
  ) {
    onChange(
      'metrics',
      data.metrics.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    )
  }

  function addMetric() {
    if (data.metrics.length >= MAX_METRICS) return
    onChange('metrics', [...data.metrics, createEmptyMetric()])
  }

  function removeMetric(id: string) {
    if (data.metrics.length <= 1) {
      onChange('metrics', [createEmptyMetric()])
      return
    }
    onChange(
      'metrics',
      data.metrics.filter((item) => item.id !== id),
    )
  }

  function updateAward(index: number, value: string) {
    const next = [...data.awards]
    next[index] = value
    onChange('awards', next)
  }

  function addAward() {
    if (data.awards.length >= MAX_AWARDS) return
    onChange('awards', [...data.awards, ''])
  }

  function removeAward(index: number) {
    if (data.awards.length <= 1) {
      onChange('awards', [''])
      return
    }
    onChange(
      'awards',
      data.awards.filter((_, i) => i !== index),
    )
  }

  function updateCert(
    id: string,
    key: 'name' | 'organization' | 'dateEarned' | 'credentialId',
    value: string,
  ) {
    onChange(
      'certifications',
      data.certifications.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    )
  }

  function addCert() {
    if (data.certifications.length >= MAX_CERTS) return
    onChange('certifications', [
      ...data.certifications,
      createEmptyCertification(),
    ])
  }

  function removeCert(id: string) {
    if (data.certifications.length <= 1) {
      onChange('certifications', [createEmptyCertification()])
      return
    }
    onChange(
      'certifications',
      data.certifications.filter((item) => item.id !== id),
    )
  }

  const trashIcon = (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 6.5H15M8 6.5V5H12V6.5M8.5 9V14M11.5 9V14M6.5 6.5L7 15.5H13L13.5 6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
  const plusIcon = (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )

  return (
    <MotionStack className={styles.stack}>
      <section className={styles.card} aria-labelledby="perf-achievements-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="perf-achievements-title">Key achievements</h2>
            <p>Share your top achievements that you&apos;re proud of.</p>
          </div>
          <span className={styles.helper}>Up to {MAX_ACHIEVEMENTS} achievements</span>
        </div>

        <div className={styles.list}>
          {data.achievements.map((achievement, index) => (
            <div key={`ach-${index}`} className={styles.field}>
              <div className={styles.rowTop}>
                <label htmlFor={`ach-${index}`}>Achievement {index + 1}</label>
                {data.achievements.length > 1 && (
                  <button
                    type="button"
                    className={styles.removeLink}
                    onClick={() => removeAchievement(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <textarea
                id={`ach-${index}`}
                className={styles.textarea}
                rows={4}
                maxLength={500}
                value={achievement}
                placeholder="e.g. Led a team of 5 developers to build a SaaS platform that increased user engagement by 40%"
                aria-describedby={`ach-${index}-count`}
                onChange={(event) =>
                  updateAchievement(index, event.target.value)
                }
              />
              <span id={`ach-${index}-count`} className={styles.counter}>
                {achievement.length}/500
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          className={styles.outlineBtn}
          onClick={addAchievement}
          disabled={data.achievements.length >= MAX_ACHIEVEMENTS}
        >
          {plusIcon}
          Add another achievement
        </button>
      </section>

      <section className={styles.card} aria-labelledby="perf-metrics-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="perf-metrics-title">Performance metrics</h2>
            <p>Highlight your impact using numbers and results.</p>
          </div>
          <span className={styles.helper}>Add measurable results</span>
        </div>

        <div className={styles.metricsTable}>
          <div className={styles.metricsHeader} aria-hidden="true">
            <span>Metric or KPI</span>
            <span>Your contribution</span>
            <span>Impact or result</span>
            <span>Time period</span>
            <span />
          </div>

          {data.metrics.map((row, index) => (
            <div key={row.id} className={styles.metricsRow}>
              <input
                className={styles.textInput}
                value={row.metric}
                aria-label={`Metric ${index + 1}: metric or KPI`}
                placeholder="e.g. Application speed"
                onChange={(event) =>
                  updateMetric(row.id, 'metric', event.target.value)
                }
              />
              <input
                className={styles.textInput}
                value={row.contribution}
                aria-label={`Metric ${index + 1}: your contribution`}
                placeholder="e.g. Optimised queries and caching"
                onChange={(event) =>
                  updateMetric(row.id, 'contribution', event.target.value)
                }
              />
              <input
                className={styles.textInput}
                value={row.impact}
                aria-label={`Metric ${index + 1}: impact or result`}
                placeholder="e.g. Improved by 35%"
                onChange={(event) =>
                  updateMetric(row.id, 'impact', event.target.value)
                }
              />
              <SelectField
                label=""
                value={row.timePeriod}
                options={TIME_PERIOD_OPTIONS}
                placeholder="Select period"
                onChange={(value) =>
                  updateMetric(row.id, 'timePeriod', value)
                }
              />
              <button
                type="button"
                className={styles.trashBtn}
                aria-label={`Remove metric ${index + 1}`}
                onClick={() => removeMetric(row.id)}
              >
                {trashIcon}
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className={styles.outlineBtn}
          onClick={addMetric}
          disabled={data.metrics.length >= MAX_METRICS}
        >
          {plusIcon}
          Add another metric
        </button>
      </section>

      <section className={styles.card} aria-labelledby="perf-awards-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="perf-awards-title">Awards and recognitions</h2>
            <p>List any awards, certifications or recognitions you&apos;ve received.</p>
          </div>
          <span className={styles.helper}>Up to {MAX_AWARDS} items</span>
        </div>

        <div className={styles.list}>
          {data.awards.map((award, index) => (
            <div key={`award-${index}`} className={styles.awardRow}>
              <input
                className={styles.textInput}
                value={award}
                aria-label={`Award ${index + 1}`}
                placeholder="e.g. Best Performer Award (Q4 2023) or Hackathon Winner"
                onChange={(event) => updateAward(index, event.target.value)}
              />
              {data.awards.length > 1 && (
                <button
                  type="button"
                  className={styles.trashBtn}
                  aria-label={`Remove award ${index + 1}`}
                  onClick={() => removeAward(index)}
                >
                  {trashIcon}
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          className={styles.outlineBtn}
          onClick={addAward}
          disabled={data.awards.length >= MAX_AWARDS}
        >
          {plusIcon}
          Add another award
        </button>
      </section>

      <section className={styles.card} aria-labelledby="perf-certs-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="perf-certs-title">Certifications</h2>
            <p>Add relevant certifications that strengthen your profile.</p>
          </div>
          <span className={styles.helper}>Up to {MAX_CERTS} certifications</span>
        </div>

        <div className={styles.list}>
          {data.certifications.map((cert, index) => {
            const isScraped = Boolean(
              cert.fromResume ||
                mentionedInResume(data.resumeText, cert.name) ||
                mentionedInResume(data.resumeText, cert.organization),
            )
            const fid = `cert-${cert.id}`
            return (
              <div key={cert.id} className={styles.certCard}>
                <div className={styles.rowTop}>
                  <div className={styles.certHeaderLeft}>
                    <h3 className={styles.certLabel}>Certification {index + 1}</h3>
                    {isScraped && (
                      <span className={styles.scrapedBadge}>
                        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path
                            d="M2.5 6.5L4.5 8.5L9.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        From your resume
                      </span>
                    )}
                  </div>
                  {data.certifications.length > 1 && (
                    <button
                      type="button"
                      className={styles.removeLink}
                      onClick={() => removeCert(cert.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className={styles.certGrid}>
                  <div className={styles.field}>
                    <label htmlFor={`${fid}-name`}>Certification name</label>
                    <input
                      id={`${fid}-name`}
                      className={styles.textInput}
                      value={cert.name}
                      placeholder="e.g. AWS Solutions Architect"
                      onChange={(event) =>
                        updateCert(cert.id, 'name', event.target.value)
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${fid}-org`}>Issuing organisation</label>
                    <input
                      id={`${fid}-org`}
                      className={styles.textInput}
                      value={cert.organization}
                      placeholder="e.g. Amazon Web Services"
                      onChange={(event) =>
                        updateCert(cert.id, 'organization', event.target.value)
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${fid}-date`}>Date earned</label>
                    <input
                      id={`${fid}-date`}
                      className={styles.textInput}
                      type="month"
                      value={toMonthInputValue(cert.dateEarned)}
                      onChange={(event) =>
                        updateCert(cert.id, 'dateEarned', event.target.value)
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${fid}-cred`}>
                      Credential ID <span className={styles.optional}>(optional)</span>
                    </label>
                    <input
                      id={`${fid}-cred`}
                      className={styles.textInput}
                      value={cert.credentialId}
                      placeholder="e.g. AWS-1234-XYZ"
                      onChange={(event) =>
                        updateCert(cert.id, 'credentialId', event.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className={styles.outlineBtn}
          onClick={addCert}
          disabled={data.certifications.length >= MAX_CERTS}
        >
          {plusIcon}
          Add another certification
        </button>
      </section>
    </MotionStack>
  )
}
