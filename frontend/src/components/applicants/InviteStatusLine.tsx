import { useState } from 'react'
import type { InviteStatus } from '../../lib/vendorApi'
import { inviteStatusText, inviteTone } from './inviteStatus'
import styles from './Applicants.module.css'

type Props = {
  invite: InviteStatus
  /** Show the invite URL as selectable text with a Copy button (panel / job page). Rows only show the state. */
  showUrl?: boolean
  /** Prefix such as the candidate's e-mail on the job page's invite list. */
  label?: string
}

/** "Interview invite: Booked for Fri 27 Nov, 10:00 am" plus, where there is room, the link itself. */
export function InviteStatusLine({ invite, showUrl = false, label }: Props) {
  const [copied, setCopied] = useState(false)
  const text = inviteStatusText(invite)
  const tone = inviteTone(invite.state)
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* the URL is on screen to copy by hand */
    }
  }
  return (
    <div className={styles.inviteLine} data-testid="invite-status" data-state={invite.state}>
      <span className={`${styles.inviteState} ${tone === 'warn' ? styles.inviteWarn : tone === 'good' ? styles.inviteGood : ''}`}>
        {label ? <span className={styles.inviteWho}>{label}</span> : <span className="ds-sr-only">Interview invite: </span>}
        {text}
      </span>
      {showUrl && invite.state !== 'completed' && invite.state !== 'expired' ? (
        <span className={styles.inviteUrlRow}>
          <input
            className={styles.inviteUrl}
            readOnly
            value={invite.inviteUrl}
            aria-label={`Interview link${label ? ` for ${label}` : ''}`}
            onFocus={(e) => e.currentTarget.select()}
            data-testid="invite-url"
          />
          <button type="button" className={styles.linkBtn} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </span>
      ) : null}
    </div>
  )
}
