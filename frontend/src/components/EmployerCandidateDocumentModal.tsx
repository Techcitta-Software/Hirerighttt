import { useState } from 'react'
import type { EmployerApplicant } from '../lib/store'
import {
  downloadResumeFile,
  hireRightReportPdfName,
} from '../lib/employerCandidateUtils'
import { downloadElementAsPdf } from '../lib/printScorecard'
import { HrIcon } from './HrIcon'
import styles from './EmployerCandidateDocumentModal.module.css'

export const EMPLOYER_REPORT_PREVIEW_ID = 'employer-candidate-report-preview'

export type EmployerDocumentKind = 'resume' | 'report'

type Props = {
  kind: EmployerDocumentKind
  applicant: EmployerApplicant
  onClose: () => void
}

export function EmployerCandidateDocumentModal({ kind, applicant, onClose }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  const isResume = kind === 'resume'
  const title = isResume
    ? `Resume — ${applicant.candidateName}`
    : `HireRighttt report — ${applicant.candidateName}`

  const canDownloadResume = Boolean(applicant.resumeText?.trim())
  const canDownloadReport = Boolean(applicant.interviewResult)

  async function handleDownload() {
    setDownloadError('')
    setDownloading(true)
    try {
      if (isResume) {
        downloadResumeFile(applicant)
        if (!applicant.resumeText?.trim()) {
          setDownloadError('No resume text available to download.')
        }
      } else {
        await downloadElementAsPdf(
          EMPLOYER_REPORT_PREVIEW_ID,
          hireRightReportPdfName(applicant.candidateName),
          'HireRighttt assessment report',
        )
      }
    } catch {
      setDownloadError('Could not prepare download. Try again.')
    } finally {
      setDownloading(false)
    }
  }

  const score = applicant.aiScore ?? applicant.interviewResult?.overall

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="employer-doc-title">
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2 id="employer-doc-title">
              <HrIcon name={isResume ? 'document' : 'sparkle'} size={18} /> {title}
            </h2>
            {!isResume && (
              <p className={styles.subtitle}>
                {applicant.jobTitle}
                {applicant.company ? ` · ${applicant.company}` : ''}
              </p>
            )}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <HrIcon name="close" size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {isResume ? (
            canDownloadResume ? (
              <pre className={styles.resumeText}>{applicant.resumeText}</pre>
            ) : (
              <p className={styles.empty}>No resume on file for this candidate.</p>
            )
          ) : canDownloadReport ? (
            <div id={EMPLOYER_REPORT_PREVIEW_ID} className={styles.reportRoot}>
              <div className={styles.reportHero}>
                <div>
                  <div className={styles.reportLabel}>Candidate</div>
                  <div className={styles.reportName}>{applicant.candidateName}</div>
                  <div className={styles.reportMeta}>{applicant.candidateEmail}</div>
                  <div className={styles.reportMeta}>Experience: {applicant.experienceYears || '—'}</div>
                </div>
                <div className={styles.scoreBlock}>
                  <div className={styles.reportLabel}>Overall fit</div>
                  <div className={styles.scoreValue}>
                    {score != null ? `${score}%` : '—'}
                  </div>
                </div>
              </div>

              {(applicant.atsScore != null || applicant.jdMatchScore != null) && (
                <div className={styles.metricsRow}>
                  {applicant.atsScore != null && <span>ATS {applicant.atsScore}%</span>}
                  {applicant.jdMatchScore != null && <span>JD match {applicant.jdMatchScore}%</span>}
                </div>
              )}

              {applicant.primarySkills && applicant.primarySkills.length > 0 && (
                <div className={styles.skills}>
                  <strong>Key skills:</strong> {applicant.primarySkills.join(', ')}
                </div>
              )}

              {applicant.interviewResult?.categories && applicant.interviewResult.categories.length > 0 && (
                <>
                  <h3 className={styles.sectionTitle}>Category breakdown</h3>
                  <div className={styles.categoryGrid}>
                    {applicant.interviewResult.categories.map((cat) => (
                      <div key={cat.label} className={styles.categoryCard}>
                        <span>{cat.label}</span>
                        <strong>{cat.score}%</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {applicant.interviewResult?.answers && applicant.interviewResult.answers.length > 0 && (
                <>
                  <h3 className={styles.sectionTitle}>Interview Q&amp;A</h3>
                  <div className={styles.qaList}>
                    {applicant.interviewResult.answers.map((ans, idx) => (
                      <div key={idx} className={styles.qaCard}>
                        <div className={styles.qaQuestion}>
                          Q{idx + 1}: {ans.question}
                        </div>
                        <div className={styles.qaAnswer}>&ldquo;{ans.answer}&rdquo;</div>
                        <div className={styles.qaMeta}>
                          Score {ans.score}% · {ans.wordCount} words
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className={styles.empty}>This candidate has not completed a HireRighttt interview yet.</p>
          )}
        </div>

        <div className={styles.footer} data-download-exclude>
          {downloadError ? <p className={styles.downloadError}>{downloadError}</p> : null}
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={downloading || (isResume ? !canDownloadResume : !canDownloadReport)}
            onClick={() => void handleDownload()}
          >
            <HrIcon name="download" size={16} />
            {downloading ? 'Preparing…' : isResume ? 'Download resume' : 'Download report'}
          </button>
        </div>
      </div>
    </div>
  )
}
