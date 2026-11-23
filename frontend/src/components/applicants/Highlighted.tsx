import { Fragment, memo } from 'react'
import { highlightParts } from '../../lib/applicantSearch'
import styles from './Applicants.module.css'

/** Text with the searched keywords / phrases marked. Plain text (no extra nodes) when nothing is searched. */
export const Highlighted = memo(function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>
  return (
    <>
      {highlightParts(text, terms).map((part, i) =>
        part.match ? (
          <mark key={i} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  )
})
