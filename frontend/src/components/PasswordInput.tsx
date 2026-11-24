import { useState, type InputHTMLAttributes } from 'react'
import { capsLockOn } from '../lib/authFormValidation'
import styles from './PasswordInput.module.css'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  id: string
  /** Extra class for the <input> (the auth pages pass their field style). */
  inputClassName?: string
}

/**
 * Password field with a show/hide toggle and a Caps Lock hint. The toggle is a real button (keyboard and screen
 * reader reachable, aria-pressed), it never submits the form, and the field keeps its autocomplete hint so password
 * managers still fill it.
 */
export function PasswordInput({
  id,
  inputClassName,
  className,
  onKeyDown,
  onKeyUp,
  onBlur,
  'aria-describedby': describedBy,
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const capsId = `${id}-caps`
  const describedByIds = [describedBy, caps ? capsId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      <div className={styles.field}>
        <input
          {...rest}
          id={id}
          type={visible ? 'text' : 'password'}
          className={`${inputClassName ?? ''} ${styles.input}`}
          aria-describedby={describedByIds}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            setCaps(capsLockOn(event))
            onKeyDown?.(event)
          }}
          onKeyUp={(event) => {
            setCaps(capsLockOn(event))
            onKeyUp?.(event)
          }}
          // The hint is NOT cleared on blur: removing it would shift the submit button up between mousedown and
          // mouseup, so the click on "Sign in" was lost. It updates on the next key press instead.
          onBlur={onBlur}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-controls={id}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
            <path
              d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
            {visible ? <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
          </svg>
        </button>
      </div>
      {caps ? (
        <p id={capsId} className={styles.caps} role="status">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M8 2.5l5 5.5h-3v3.5H6V8H3l5-5.5zM6 13.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          Caps Lock is on
        </p>
      ) : null}
    </div>
  )
}
