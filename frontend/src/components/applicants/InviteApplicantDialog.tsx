import { useRef, useState, type FormEvent } from 'react'
import { HrIcon } from '../HrIcon'
import { handleDialogKeyDown, useDialogFocus } from '../useDialog'
import styles from './Applicants.module.css'
import { defaultSlot, slotError, toLocalInputValue } from './inviteSlot'

export type InviteChoice = { kind: 'open' } | { kind: 'scheduled'; scheduledStart: string; durationMinutes: number }

type Props = {
  candidateName: string
  busy?: boolean
  onSubmit: (choice: InviteChoice) => void
  onClose: () => void
  now?: number
}

const DURATIONS = [20, 30, 45, 60]

/** Row / profile "Invite": an open link the candidate can use any time, or a date and time slot. */
export function InviteApplicantDialog({ candidateName, busy = false, onSubmit, onClose, now: nowProp }: Props) {
  const [now] = useState(() => nowProp ?? Date.now())
  const [kind, setKind] = useState<'open' | 'scheduled'>('open')
  const [slot, setSlot] = useState(() => defaultSlot(now))
  const [duration, setDuration] = useState(30)
  const [error, setError] = useState('')
  const ref = useRef<HTMLFormElement>(null)
  useDialogFocus(true, ref)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (kind === 'open') {
      onSubmit({ kind: 'open' })
      return
    }
    const problem = slotError(slot, Date.now())
    if (problem) {
      setError(problem)
      return
    }
    onSubmit({ kind: 'scheduled', scheduledStart: new Date(slot).toISOString(), durationMinutes: duration })
  }

  return (
    <div className={styles.inviteDialogBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={ref}
        className={styles.inviteDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-applicant-title"
        tabIndex={-1}
        onSubmit={submit}
        onKeyDown={(e) => handleDialogKeyDown(e, onClose)}
        data-testid="invite-applicant-dialog"
      >
        <div className={styles.inviteDialogHead}>
          <h2 id="invite-applicant-title">Invite {candidateName} to interview</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <HrIcon name="close" size={14} />
          </button>
        </div>
        <fieldset className={styles.inviteChoices}>
          <legend className="ds-sr-only">When can they interview?</legend>
          <label className={styles.inviteChoice}>
            <input type="radio" name="invite-kind" checked={kind === 'open'} onChange={() => setKind('open')} />
            <span>
              <strong>Open link</strong>
              <span className={styles.inviteHint}>They can start any time in the next 7 days.</span>
            </span>
          </label>
          <label className={styles.inviteChoice}>
            <input type="radio" name="invite-kind" checked={kind === 'scheduled'} onChange={() => setKind('scheduled')} />
            <span>
              <strong>Pick a date and time</strong>
              <span className={styles.inviteHint}>The link opens at that time and they have 15 minutes to join.</span>
            </span>
          </label>
        </fieldset>
        {kind === 'scheduled' ? (
          <div className={styles.inviteSlotRow}>
            <label>
              <span>Date and time</span>
              <input
                type="datetime-local"
                value={slot}
                min={toLocalInputValue(now)}
                onChange={(e) => {
                  setSlot(e.target.value)
                  setError('')
                }}
                required
                data-testid="invite-slot"
              />
            </label>
            <label>
              <span>Length</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {error ? (
          <p className={styles.inviteError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.inviteDialogFoot}>
          <button type="button" className={styles.actBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.actBtn} ${styles.actPrimary}`} disabled={busy} aria-busy={busy}>
            {busy ? 'Sending…' : kind === 'open' ? 'Send link' : 'Schedule interview'}
          </button>
        </div>
      </form>
    </div>
  )
}
