import { useId } from 'react'
import styles from './CharacterTextarea.module.css'

interface CharacterTextareaProps {
  label: string
  sublabel?: string
  value: string
  maxLength: number
  placeholder: string
  onChange: (value: string) => void
  rows?: number
  /** When false, hides the bottom-right length counter (maxLength still enforced). */
  showCounter?: boolean
}

export function CharacterTextarea({
  label,
  sublabel,
  value,
  maxLength,
  placeholder,
  onChange,
  rows = 4,
  showCounter = false,
}: CharacterTextareaProps) {
  const id = useId()

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {sublabel && <span className={styles.sublabel}>{sublabel}</span>}
      <div className={styles.wrap}>
        <textarea
          id={id}
          className={styles.textarea}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          rows={rows}
          onChange={(event) => onChange(event.target.value)}
        />
        {showCounter ? (
          <span className={styles.counter}>
            {value.length}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  )
}
