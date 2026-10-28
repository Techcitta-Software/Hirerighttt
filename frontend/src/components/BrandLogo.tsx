import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import styles from './BrandLogo.module.css'

export type BrandLogoProps = {
  /** Light text on dark backgrounds (footer, auth panel). */
  dark?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  to?: string
  asSpan?: boolean
  onClick?: () => void
  className?: string
  style?: CSSProperties
  showTagline?: boolean
}

function LogoMark({
  dark,
  size,
  showTagline,
}: {
  dark: boolean
  size: BrandLogoProps['size']
  showTagline: boolean
}) {
  const sizeClass = `hr-logo--${size ?? 'md'}`
  const toneClass = dark ? 'hr-logo--dark' : ''
  return (
    <span className={`hr-logo brand-logo ${sizeClass} ${toneClass}`.trim()} aria-hidden={false}>
      <span className="hr-logo__wordmark">
        <span className="hr-logo__hire">Hire</span>
        <span className="hr-logo__rightShell">
          <span className="hr-logo__right">Righttt</span>
        </span>
      </span>
      {showTagline ? <span className="hr-logo__tagline">Talent to Talent</span> : null}
    </span>
  )
}

export function BrandLogo({
  dark = false,
  size = 'md',
  to = '/',
  asSpan = false,
  onClick,
  className = '',
  style,
  showTagline = true,
}: BrandLogoProps) {
  const combinedClass = `${styles.brandLink} ${className}`.trim()
  const mark = <LogoMark dark={dark} size={size} showTagline={showTagline} />

  if (asSpan || !to) {
    return (
      <span
        className={combinedClass}
        onClick={onClick}
        style={style}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {mark}
      </span>
    )
  }

  return (
    <Link
      to={to}
      className={combinedClass}
      aria-label="HireRighttt — Talent to Talent"
      onClick={onClick}
      style={style}
    >
      {mark}
    </Link>
  )
}
