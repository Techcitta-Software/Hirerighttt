import { useEffect, useRef } from 'react'
import { highlightSegments, type CandidateQuickFilter, type CandidateSort } from '../lib/candidateSearch'
import { HrIcon } from './HrIcon'
import styles from './CandidateSearchBar.module.css'

/** Wraps the words the recruiter searched in <mark> so it is obvious why a candidate matched. */
export function HighlightText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

type Props = {
  query: string
  onQuery: (value: string) => void
  quick: CandidateQuickFilter
  onQuick: (value: CandidateQuickFilter) => void
  sort: CandidateSort
  onSort: (value: CandidateSort) => void
  shown: number
  total: number
  counts: Record<CandidateQuickFilter, number>
  moreOpen: boolean
  moreActiveCount: number
  onToggleMore: () => void
  onReset: () => void
}

const CHIPS: { id: CandidateQuickFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'interviewed', label: 'Interviewed' },
  { id: 'not_interviewed', label: 'Not interviewed' },
  { id: 'score_70', label: 'Score 70+' },
  { id: 'review', label: 'Needs review' },
]

export function CandidateSearchBar({
  query,
  onQuery,
  quick,
  onQuick,
  sort,
  onSort,
  shown,
  total,
  counts,
  moreOpen,
  moreActiveCount,
  onToggleMore,
  onReset,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Press "/" anywhere on the page to jump to the search box.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const searching = query.trim().length > 0
  const dirty = searching || quick !== 'all' || moreActiveCount > 0

  return (
    <section className={styles.wrap} aria-label="Search candidates">
      <div className={styles.searchRow}>
        <div className={styles.inputWrap}>
          <span className={styles.icon} aria-hidden="true">
            <HrIcon name="search" size={20} />
          </span>
          <input
            ref={inputRef}
            type="search"
            className={styles.input}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onQuery('')
            }}
            placeholder="Search by name, email, phone, role, skill or resume keyword"
            aria-label="Search candidates"
            autoComplete="off"
            spellCheck={false}
          />
          {searching ? (
            <button type="button" className={styles.clear} onClick={() => onQuery('')} aria-label="Clear search">
              <HrIcon name="close" size={16} />
            </button>
          ) : (
            <kbd className={styles.kbd} aria-hidden="true">
              /
            </kbd>
          )}
        </div>

        <label className={styles.sortLabel}>
          <span>Sort</span>
          <select className={styles.sort} value={sort} onChange={(e) => onSort(e.target.value as CandidateSort)}>
            <option value="best_match">{searching ? 'Best match' : 'Newest first'}</option>
            <option value="newest">Newest first</option>
            <option value="score">Highest score</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>

        <button
          type="button"
          className={`${styles.moreBtn} ${moreOpen ? styles.moreBtnOpen : ''}`}
          onClick={onToggleMore}
          aria-expanded={moreOpen}
        >
          More filters{moreActiveCount ? <span className={styles.badge}>{moreActiveCount}</span> : null}
        </button>
      </div>

      <div className={styles.chipRow} role="group" aria-label="Quick filters">
        {CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`${styles.chip} ${quick === chip.id ? styles.chipOn : ''}`}
            onClick={() => onQuick(chip.id)}
            aria-pressed={quick === chip.id}
          >
            {chip.label}
            <span className={styles.chipCount}>{counts[chip.id]}</span>
          </button>
        ))}
      </div>

      <div className={styles.statusRow} role="status" aria-live="polite">
        <span>
          {searching ? (
            <>
              <strong>{shown}</strong> {shown === 1 ? 'candidate matches' : 'candidates match'} “{query.trim()}”
            </>
          ) : (
            <>
              Showing <strong>{shown}</strong> of {total} candidates
            </>
          )}
        </span>
        {dirty ? (
          <button type="button" className={styles.reset} onClick={onReset}>
            Reset all
          </button>
        ) : null}
      </div>
    </section>
  )
}
