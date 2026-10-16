export function slugifyCompany(name: string): string {
  const base = String(name || 'company')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'company'
}

/** Public site origin for share links (set VITE_PUBLIC_APP_URL in production). */
export function publicAppOrigin(): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_APP_URL
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return ''
}

export function buildApplyUrl(company: string, shareableCode: string): string {
  const slug = slugifyCompany(company)
  const code = encodeURIComponent(String(shareableCode || '').trim())
  const origin = publicAppOrigin() || 'http://localhost:5173'
  return `${origin}/apply/${slug}/${code}`
}

export function companySlugMatches(company: string, slug: string | undefined): boolean {
  if (!slug?.trim()) return true
  return slugifyCompany(company) === slug.trim().toLowerCase()
}
