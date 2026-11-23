import { completionRate, type ApplicantStats } from '../lib/jobApplicantStats'
import styles from './StatTiles.module.css'

type Props = {
  stats: ApplicantStats
  /** Accessible name of the group, e.g. "Vault numbers" or "Numbers for this job". */
  label: string
  /** First tile's label and hint differ by page (vault: candidates; job page: applicants). */
  totalLabel?: string
  totalHint?: string
  loading?: boolean
}

/** Four stat tiles: total, resumes parsed, AI interviewed, average score. */
export function StatTiles({
  stats,
  label,
  totalLabel = 'Total candidates',
  totalHint = 'Across applications and onboarding',
  loading = false,
}: Props) {
  const value = (n: number) => (loading ? '—' : n)
  return (
    <section className={styles.grid} aria-label={label} aria-busy={loading || undefined}>
      <div className={styles.card}>
        <span className={styles.label}>{totalLabel}</span>
        <strong className={styles.value}>{value(stats.total)}</strong>
        <small className={styles.help}>{totalHint}</small>
      </div>
      <div className={styles.card}>
        <span className={styles.label}>Resumes parsed</span>
        <strong className={styles.value}>{value(stats.parsed)}</strong>
        <small className={styles.help}>PDF and DOCX text extracted</small>
      </div>
      <div className={styles.card}>
        <span className={styles.label}>AI interviewed</span>
        <strong className={styles.value}>{value(stats.interviewed)}</strong>
        <small className={styles.help}>{loading ? ' ' : `${completionRate(stats)}% completion rate`}</small>
      </div>
      <div className={styles.card}>
        <span className={styles.label}>Average score</span>
        <strong className={styles.value}>
          {!loading && stats.averageScore !== null ? (
            <>
              {stats.averageScore}
              <span className={styles.unit}>/100</span>
            </>
          ) : (
            '—'
          )}
        </strong>
        <small className={styles.help}>Proctored AI interview</small>
      </div>
    </section>
  )
}
