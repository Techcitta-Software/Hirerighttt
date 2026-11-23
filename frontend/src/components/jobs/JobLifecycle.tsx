import { useRef, useState, type FormEvent } from 'react'
import { handleDialogKeyDown, useDialogFocus } from '../useDialog'
import { HrIcon } from '../HrIcon'
import { DEFAULT_JOB_ROLE, JOB_ROLE_GROUPS } from '../../data/jobRoles'
import { ensureApiSession } from '../../lib/apiSession'
import { updateVendorJob, vendorJobStatus, type VendorJob, type VendorJobStatus } from '../../lib/vendorApi'
import type { EmployerJob } from '../../lib/store'
import { JOB_STATUS_LABEL, jobEditPatch, jobStatusActions, splitSkills, validateJobEdit, type JobEditDraft, type JobStatusAction } from './jobStatusRules'
import dash from '../../pages/EmployerDashboard.module.css'
import styles from './JobLifecycle.module.css'

const EXPERIENCE_OPTIONS = [
  { value: '0-2 years', label: '0-2 years (Junior)' },
  { value: '3-5 years', label: '3-5 years (Mid-Level)' },
  { value: '6+ years', label: '6+ years (Senior / Lead)' },
]

const BADGE_CLASS: Record<VendorJobStatus, string> = {
  published: styles.badgePublished,
  draft: styles.badgeDraft,
  closed: styles.badgeClosed,
  archived: styles.badgeArchived,
}

export function JobStatusBadge({ status }: { status: string | undefined }) {
  const s = vendorJobStatus({ status })
  return (
    <span className={`${styles.badge} ${BADGE_CLASS[s]}`} data-testid="job-status-badge" data-status={s}>
      {JOB_STATUS_LABEL[s]}
    </span>
  )
}

type Notice = (text: string, tone?: 'success' | 'error') => void

/**
 * Edit + status buttons for one job (Close job / Reopen / Unpublish / Publish), each status change behind a
 * confirm dialog with a busy state. `onChanged` gets the job as the API saved it.
 */
export function JobLifecycleActions({
  job,
  onChanged,
  onNotice,
  disabled = false,
  showEdit = true,
  compact = true,
}: {
  job: EmployerJob
  onChanged: (job: VendorJob) => void
  onNotice: Notice
  disabled?: boolean
  showEdit?: boolean
  compact?: boolean
}) {
  const [pending, setPending] = useState<JobStatusAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const confirmRef = useRef<HTMLDivElement>(null)
  useDialogFocus(Boolean(pending), confirmRef)
  const status = vendorJobStatus(job)
  const actions = jobStatusActions(status)
  const btn = compact ? `${dash.btnSm}` : ''

  function close() {
    if (busy) return
    setPending(null)
  }

  async function confirm(action: JobStatusAction) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await ensureApiSession()
      const { job: saved } = await updateVendorJob(job.id, { status: action.to })
      onChanged(saved)
      onNotice(action.done(job.title), 'success')
      setPending(null)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The change was not saved. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <span className={styles.actions}>
        {showEdit ? (
          <button
            type="button"
            className={`${dash.btnSecondary} ${btn}`}
            disabled={disabled || busy}
            onClick={() => setEditing(true)}
            aria-label={`Edit job ${job.title}`}
          >
            Edit
          </button>
        ) : null}
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`${dash.btnSecondary} ${btn}`}
            disabled={disabled || busy}
            onClick={() => {
              setError('')
              setPending(a)
            }}
            aria-label={`${a.label}: ${job.title}`}
          >
            {busy && pending?.key === a.key ? a.busyLabel : a.label}
          </button>
        ))}
      </span>

      {pending ? (
        <div
          className={dash.modalOverlay}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`job-status-title-${job.id}`}
          aria-describedby={`job-status-body-${job.id}`}
          onKeyDown={(e) => handleDialogKeyDown(e, close)}
        >
          <div ref={confirmRef} tabIndex={-1} className={`${dash.modal} ${dash.modalSm}`}>
            <div className={dash.modalHeader}>
              <h2 id={`job-status-title-${job.id}`}>{pending.title(job.title)}</h2>
            </div>
            <div className={dash.modalBody}>
              <p id={`job-status-body-${job.id}`} className={dash.modalSub}>
                {pending.body}
              </p>
              {error ? (
                <p className={`ds-alert ds-alert--error ${dash.modalError}`} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className={dash.modalFooter}>
              <button type="button" className={dash.btnSecondary} onClick={close} disabled={busy} data-autofocus>
                Cancel
              </button>
              <button
                type="button"
                className={pending.danger ? dash.btnDanger : dash.btnPrimary}
                disabled={busy}
                aria-busy={busy}
                onClick={() => void confirm(pending)}
              >
                {busy ? pending.busyLabel : pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <EditJobDialog
          job={job}
          onClose={() => setEditing(false)}
          onSaved={(saved, changed) => {
            setEditing(false)
            if (!changed.length) {
              onNotice('No changes to save.')
              return
            }
            onChanged(saved)
            onNotice(
              changed.some((c) => c === 'jobDescription' || c === 'requiredSkills')
                ? `“${saved.title}” saved. New interviews use the updated description; completed ones keep their questions.`
                : `“${saved.title}” saved.`,
              'success',
            )
          }}
        />
      ) : null}
    </>
  )
}

/** Edit a job's title, role, experience, location, description and skills. Sends only what changed. */
export function EditJobDialog({
  job,
  onClose,
  onSaved,
}: {
  job: EmployerJob
  onClose: () => void
  onSaved: (job: VendorJob, changed: string[]) => void
}) {
  const [draft, setDraft] = useState<JobEditDraft>(() => ({
    title: job.title,
    roleTrack: job.roleTrack || DEFAULT_JOB_ROLE,
    experienceLevel: job.experienceLevel,
    location: job.location,
    jobDescription: job.jobDescription,
    skills: job.requiredSkills.join(', '),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  useDialogFocus(true, formRef, 'field')
  const roleKnown = JOB_ROLE_GROUPS.some((g) => g.roles.includes(draft.roleTrack))
  const expKnown = EXPERIENCE_OPTIONS.some((o) => o.value === draft.experienceLevel)
  const descLength = draft.jobDescription.trim().length
  const idp = `edit-job-${job.id}`

  function set<K extends keyof JobEditDraft>(key: K, value: JobEditDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function close() {
    if (!saving) onClose()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    const problem = validateJobEdit(draft)
    if (problem) {
      setError(problem)
      return
    }
    const patch = jobEditPatch(job, draft)
    if (!Object.keys(patch).length) {
      onSaved({ ...(job as unknown as VendorJob) }, [])
      return
    }
    setSaving(true)
    setError('')
    try {
      await ensureApiSession()
      const { job: saved, changed } = await updateVendorJob(job.id, patch)
      onSaved(saved, changed)
    } catch (err) {
      setError(err instanceof Error && err.message ? `Not saved. ${err.message}` : 'Not saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={dash.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${idp}-title`}
      onKeyDown={(e) => handleDialogKeyDown(e, close)}
    >
      <form ref={formRef} tabIndex={-1} className={`${dash.modal} ${dash.modalLg}`} onSubmit={submit} noValidate>
        <div className={dash.modalHeader}>
          <div>
            <h2 id={`${idp}-title`}>Edit job</h2>
            <p className={dash.modalSub}>
              Changes apply to new interviews. Interviews already completed keep the questions they were asked.
            </p>
          </div>
          <button type="button" className={dash.closeBtn} onClick={close} aria-label="Close" disabled={saving}>
            <HrIcon name="close" size={16} />
          </button>
        </div>

        <div className={dash.modalBody}>
          <div className={dash.formGroup}>
            <label htmlFor={`${idp}-name`}>Job title</label>
            <input id={`${idp}-name`} type="text" required maxLength={200} value={draft.title} onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className={dash.formGrid}>
            <div className={dash.formGroup}>
              <label htmlFor={`${idp}-role`}>Role</label>
              <select id={`${idp}-role`} required value={draft.roleTrack} onChange={(e) => set('roleTrack', e.target.value)}>
                {!roleKnown ? <option value={draft.roleTrack}>{draft.roleTrack}</option> : null}
                {JOB_ROLE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className={dash.formGroup}>
              <label htmlFor={`${idp}-exp`}>Years of experience</label>
              <select id={`${idp}-exp`} required value={draft.experienceLevel} onChange={(e) => set('experienceLevel', e.target.value)}>
                {!expKnown ? <option value={draft.experienceLevel}>{draft.experienceLevel || 'Choose…'}</option> : null}
                {EXPERIENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={dash.formGroup}>
            <label htmlFor={`${idp}-loc`}>Location</label>
            <input id={`${idp}-loc`} type="text" required value={draft.location} onChange={(e) => set('location', e.target.value)} />
          </div>
          <div className={dash.formGroup}>
            <label htmlFor={`${idp}-jd`}>Job description</label>
            <textarea
              id={`${idp}-jd`}
              required
              aria-describedby={`${idp}-jd-hint`}
              value={draft.jobDescription}
              onChange={(e) => set('jobDescription', e.target.value)}
            />
            <span
              id={`${idp}-jd-hint`}
              className={`${dash.fieldHint} ${dash.fieldHintCounter} ${descLength >= 30 ? dash.fieldHintOk : ''}`}
            >
              {descLength >= 30 ? `${descLength} characters` : `At least 30 characters (${descLength}/30)`}
            </span>
          </div>
          <div className={`${dash.formGroup} ${dash.formGroupLast}`}>
            <label htmlFor={`${idp}-skills`}>Required skills</label>
            <input
              id={`${idp}-skills`}
              type="text"
              aria-describedby={`${idp}-skills-hint`}
              value={draft.skills}
              onChange={(e) => set('skills', e.target.value)}
            />
            <span id={`${idp}-skills-hint`} className={dash.fieldHint}>
              Separate skills with commas ({splitSkills(draft.skills).length} listed).
            </span>
          </div>
          {error ? (
            <p className={`ds-alert ds-alert--error ${dash.modalError}`} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className={dash.modalFooter}>
          <button type="button" className={dash.btnSecondary} onClick={close} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={dash.btnPrimary} disabled={saving} aria-busy={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
