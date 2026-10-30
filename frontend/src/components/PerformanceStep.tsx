import {
  TIME_PERIOD_OPTIONS,
  createEmptyCertification,
  createEmptyMetric,
  mentionedInResume,
  type ProfileFormData,
} from '../data/wizard'
import { MotionItem, MotionStack } from '../motion/MotionStack'
import { SelectField } from './SelectField'
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

  return (
    <MotionStack className={styles.stack}>
      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <div>
            <h2>1. Key Achievements</h2>
            <h3>Share your top achievements that you&apos;re proud of.</h3>
          </div>
          <span className={styles.helper}>
            Add up to {MAX_ACHIEVEMENTS} achievements
            <span className={styles.info} title="Share outcomes you are proud of">
              i
            </span>
          </span>
        </div>

        <div className={styles.list}>
          {data.achievements.map((achievement, index) => (
            <div key={`ach-${index}`} className={styles.textareaBlock}>
              <div className={styles.rowTop}>
                <label>Achievement {index + 1}</label>
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
              <div className={styles.textareaWrap}>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  maxLength={500}
                  value={achievement}
                  placeholder="E.g. Led a team of 5 developers to build a scalable SaaS platform that increased user engagement by 40%..."
                  onChange={(event) =>
                    updateAchievement(index, event.target.value)
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className={styles.outlineBtn}
          onClick={addAchievement}
          disabled={data.achievements.length >= MAX_ACHIEVEMENTS}
        >
          + Add Another Achievement
        </button>
      </MotionItem>
      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <div>
            <h2>2. Performance Metrics</h2>
            <h3>Highlight your impact using numbers and results.</h3>
          </div>
          <span className={styles.helper}>Add measurable results</span>
        </div>

        <div className={styles.metricsTable}>
          <div className={styles.metricsHeader} aria-hidden="true">
            <span>Metric / KPI</span>
            <span>Your Contribution</span>
            <span>Impact / Result</span>
            <span>Time Period</span>
            <span />
          </div>

          {data.metrics.map((row) => (
            <div key={row.id} className={styles.metricsRow}>
              <input
                className={styles.textInput}
                value={row.metric}
                placeholder="e.g. Increased Application Speed"
                onChange={(event) =>
                  updateMetric(row.id, 'metric', event.target.value)
                }
              />
              <input
                className={styles.textInput}
                value={row.contribution}
                placeholder="e.g. Optimized queries & caching"
                onChange={(event) =>
                  updateMetric(row.id, 'contribution', event.target.value)
                }
              />
              <input
                className={styles.textInput}
                value={row.impact}
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
                aria-label="Remove metric"
                onClick={() => removeMetric(row.id)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M5 6.5H15M8 6.5V5H12V6.5M8.5 9V14M11.5 9V14M6.5 6.5L7 15.5H13L13.5 6.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
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
          + Add Another Metric
        </button>
      </MotionItem>
      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <div>
            <h2>3. Awards & Recognitions</h2>
            <h3>
              List any awards, certifications, or recognitions you&apos;ve
              received.
            </h3>
          </div>
          <span className={styles.helper}>Add up to {MAX_AWARDS} items</span>
        </div>

        <div className={styles.list}>
          {data.awards.map((award, index) => (
            <div key={`award-${index}`} className={styles.awardRow}>
              <input
                className={styles.textInput}
                value={award}
                placeholder="E.g. Best Performer Award (Q4 2023) or Hackathon Winner"
                onChange={(event) => updateAward(index, event.target.value)}
              />
              {data.awards.length > 1 && (
                <button
                  type="button"
                  className={styles.trashBtn}
                  aria-label="Remove award"
                  onClick={() => removeAward(index)}
                >
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M5 6.5H15M8 6.5V5H12V6.5M8.5 9V14M11.5 9V14M6.5 6.5L7 15.5H13L13.5 6.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
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
          + Add Another Award
        </button>
      </MotionItem>
      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <div>
            <h2>4. Certifications</h2>
            <h3>Add relevant certifications that strengthen your profile.</h3>
          </div>
          <span className={styles.helper}>
            Add up to {MAX_CERTS} certifications
          </span>
        </div>

        <div className={styles.list}>
          {data.certifications.map((cert, index) => {
            const isScraped = Boolean(
              cert.fromResume ||
                mentionedInResume(data.resumeText, cert.name) ||
                mentionedInResume(data.resumeText, cert.organization),
            )
            return (
              <div key={cert.id} className={styles.certCard}>
                <div className={styles.rowTop}>
                  <div className={styles.certHeaderLeft}>
                    <p className={styles.certLabel}>Certification {index + 1}</p>
                    {isScraped && (
                      <span className={styles.scrapedBadge}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path
                            d="M2.5 6.5L4.5 8.5L9.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Scraped from resume
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
                  <label>Certification Name</label>
                  <input
                    className={styles.textInput}
                    value={cert.name}
                    placeholder="e.g. AWS Solutions Architect"
                    onChange={(event) =>
                      updateCert(cert.id, 'name', event.target.value)
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label>Issuing Organization</label>
                  <input
                    className={styles.textInput}
                    value={cert.organization}
                    placeholder="e.g. Amazon Web Services"
                    onChange={(event) =>
                      updateCert(cert.id, 'organization', event.target.value)
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label>Date Earned</label>
                  <input
                    className={styles.textInput}
                    type="month"
                    value={cert.dateEarned}
                    onChange={(event) =>
                      updateCert(cert.id, 'dateEarned', event.target.value)
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label>Credential ID (Optional)</label>
                  <input
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
          + Add Another Certification
        </button>
      </MotionItem>
    </MotionStack>
  )
}
