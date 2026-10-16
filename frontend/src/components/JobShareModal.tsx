import { useMemo, useState } from 'react'
import type { EmployerJob } from '../lib/store'
import { buildJobShareChannels, jobApplyUrl } from '../lib/jobShareLinks'
import { HrIcon } from './HrIcon'
import { SharePlatformIcon, sharePlatformShortLabel } from './SharePlatformIcon'
import styles from './JobShareModal.module.css'

type Props = {
  job: EmployerJob
  onClose: () => void
}

export function JobShareModal({ job, onClose }: Props) {
  const applyUrl = jobApplyUrl(job)
  const channels = useMemo(() => buildJobShareChannels(job), [job])
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(applyUrl)
    } catch {
      window.prompt('Copy this link', applyUrl)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-share-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <span className={styles.badge}>Job created</span>
            <h2 id="job-share-title">{job.title}</h2>
            <p className={styles.sub}>
              Share this private link so candidates can apply and complete the HireRight AI interview.
            </p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <HrIcon name="close" size={18} />
          </button>
        </div>

        <div className={styles.linkBox}>
          <input className={styles.linkInput} readOnly value={applyUrl} aria-label="Application link" />
          <button type="button" className={styles.copyBtn} onClick={() => void copyLink()}>
            {copied ? (
              <>
                <HrIcon name="check" size={16} /> Copied
              </>
            ) : (
              <>
                <HrIcon name="clipboard" size={16} /> Copy link
              </>
            )}
          </button>
        </div>

        <p className={styles.shareLabel}>Share via</p>
        <div className={styles.channelScrollWrap}>
          <div className={styles.channelScroll} tabIndex={0} aria-label="Share on messaging platforms">
            <div className={styles.channelTrack}>
              {channels.map((ch) => (
                <a
                  key={ch.id}
                  className={styles.channelChip}
                  href={ch.href}
                  target={ch.external ? '_blank' : undefined}
                  rel={ch.external ? 'noopener noreferrer' : undefined}
                  title={ch.label}
                >
                  <span className={styles.channelIconWrap}>
                    <SharePlatformIcon id={ch.id} size={44} />
                  </span>
                  <span className={styles.channelChipLabel}>
                    {sharePlatformShortLabel(ch.id, ch.label)}
                  </span>
                </a>
              ))}
            </div>
          </div>
          <p className={styles.scrollHint}>Swipe or scroll horizontally for more apps →</p>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.doneBtn} onClick={onClose}>
            Done — back to Jobs
          </button>
        </div>
      </div>
    </div>
  )
}
