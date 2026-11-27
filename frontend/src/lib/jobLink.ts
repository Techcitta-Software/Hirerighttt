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
  // No configured URL and no window (tests / prerender): a root-relative link, never a hard-coded localhost.
  return `${publicAppOrigin()}/apply/${slug}/${code}`
}

/** In-app route for the apply form (resume upload + ATS). */
export function buildApplyPath(company: string, shareableCode: string): string {
  const slug = slugifyCompany(company)
  const code = encodeURIComponent(String(shareableCode || '').trim())
  return `/apply/${slug}/${code}`
}

export function companySlugMatches(company: string, slug: string | undefined): boolean {
  if (!slug?.trim()) return true
  return slugifyCompany(company) === slug.trim().toLowerCase()
}

/**
 * Replace path when a public job URL has the right code and the wrong company slug.
 * Null when the slug is missing or already the canonical one (comparison is case-insensitive).
 */
export function canonicalJobPath(
  section: 'jobs' | 'apply',
  code: string,
  urlSlug: string | undefined,
  job: { company?: string | null; companySlug?: string | null },
): string | null {
  const given = String(urlSlug || '').trim().toLowerCase()
  const share = String(code || '').trim()
  if (!given || !share) return null
  const canonical = String(job.companySlug || '').trim().toLowerCase() || slugifyCompany(job.company || '')
  if (!canonical || given === canonical) return null
  return `/${section}/${encodeURIComponent(canonical)}/${encodeURIComponent(share)}`
}
