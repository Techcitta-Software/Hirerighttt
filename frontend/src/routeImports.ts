import { lazy, type ComponentType } from 'react'

/**
 * One importer per lazily loaded page module. App.tsx builds its lazy() routes from these (lazyPage), and
 * main.tsx / the marketing links call loadRouteChunk() ahead of time. import() is cached by the module loader,
 * so calling an importer twice never downloads the chunk twice.
 */
export const routeImports = {
  home: () => import('./pages/HomePage'),
  solutions: () => import('./pages/SolutionsPage'),
  why: () => import('./pages/WhyPage'),
  recruiter: () => import('./pages/RecruiterPage'),
  pricing: () => import('./pages/PricingPage'),
  retakePricing: () => import('./pages/InterviewRetakePricingPage'),
  careerView: () => import('./pages/CareerViewPage'),
  auth: () => import('./pages/AuthPages'),
  orgSignup: () => import('./pages/OrganizationSignupPage'),
  appPages: () => import('./pages/AppPages'),
  admin: () => import('./pages/AdminDashboard'),
  interview: () => import('./pages/InterviewPage'),
  interviewNow: () => import('./pages/InterviewNowPage'),
  interviewComplete: () => import('./pages/InterviewCompletePage'),
  employer: () => import('./pages/EmployerDashboard'),
  vendorDashboard: () => import('./pages/VendorDashboardPage'),
  apply: () => import('./pages/CandidateApplyPage'),
  jobInvite: () => import('./pages/JobInviteEntryPage'),
  interviewInvite: () => import('./pages/InterviewInvitePage'),
  resumes: () => import('./pages/ResumeDatabasePage'),
  onboarding: () => import('./pages/ProfileWizard'),
  contact: () => import('./pages/ContactPage'),
  passwordReset: () => import('./pages/PasswordResetPages'),
  legal: () => import('./pages/LegalPages'),
  /** Not a page: the signed-in layout wrapped around the app routes. */
  appShell: () => import('./components/AppShell'),
} as const

export type RouteChunk = keyof typeof routeImports
type ModuleOf<K extends RouteChunk> = Awaited<ReturnType<(typeof routeImports)[K]>>

/** Modules that have finished loading, so a page whose code is already here renders without suspending. */
const loaded = new Map<RouteChunk, unknown>()

/** Loads (once) and remembers a page module. */
export function loadRouteChunk<K extends RouteChunk>(chunk: K): Promise<ModuleOf<K>> {
  return (routeImports[chunk]() as Promise<ModuleOf<K>>).then((mod) => {
    loaded.set(chunk, mod)
    return mod
  })
}

/**
 * React.lazy for a page export. When the chunk is already loaded (prefetched on hover, or awaited in main.tsx)
 * the factory hands React a synchronously resolved thenable, so the page renders in the same pass with no
 * Suspense fallback, and no fallback hold.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<K extends RouteChunk, C extends ComponentType<any>>(chunk: K, pick: (mod: ModuleOf<K>) => C) {
  return lazy(() => {
    const ready = loaded.get(chunk) as ModuleOf<K> | undefined
    if (ready) {
      const thenable = { then: (resolve: (value: { default: C }) => void) => resolve({ default: pick(ready) }) }
      return thenable as unknown as Promise<{ default: C }>
    }
    return loadRouteChunk(chunk).then((mod) => ({ default: pick(mod) }))
  })
}

const APP_PAGE_PATHS = new Set(['/dashboard', '/dashboard/report', '/jobs', '/applications', '/profile'])
const AUTH_PATHS = new Set(['/login', '/signup', '/logout', '/settings'])
const LEGAL_PATHS = new Set(['/privacy', '/privacy-policy', '/terms', '/terms-of-use', '/cookies', '/cookie-policy'])

/** Which page module serves a pathname (null when the path has no lazy page, e.g. a 404). */
export function routeChunkForPath(pathname: string): RouteChunk | null {
  const path = (pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  if (path === '/') return 'home'
  if (path === '/solutions') return 'solutions'
  if (path === '/why') return 'why'
  if (path === '/organizations' || path === '/for-recruiters') return 'recruiter'
  if (path === '/organizations/signup') return 'orgSignup'
  if (path === '/pricing') return 'pricing'
  if (path === '/pricing/retake') return 'retakePricing'
  if (path === '/career-view' || path === '/360-career-view' || path === '/career') return 'careerView'
  if (AUTH_PATHS.has(path)) return 'auth'
  if (APP_PAGE_PATHS.has(path)) return 'appPages'
  if (path === '/admin') return 'admin'
  if (path === '/interview') return 'interview'
  if (path === '/interview/now') return 'interviewNow'
  if (path === '/interview/complete') return 'interviewComplete'
  if (path.startsWith('/interview/invite/')) return 'interviewInvite'
  if (
    path === '/employer/jobs' ||
    path === '/employer/applicants'
  )
    return 'employer'
  if (path === '/employer/dashboard' || path === '/employer') return 'vendorDashboard'
  if (path.startsWith('/apply/')) return 'apply'
  if (path.startsWith('/jobs/')) return 'jobInvite'
  if (path === '/employer/candidates' || path === '/candidates' || path === '/resumes' || path === '/talent-vault')
    return 'resumes'
  if (path === '/onboarding') return 'onboarding'
  if (path === '/contact') return 'contact'
  if (path === '/forgot-password' || path === '/reset-password') return 'passwordReset'
  if (LEGAL_PATHS.has(path)) return 'legal'
  return null
}

/** Paths rendered inside AppShell (see App.tsx); their first render also needs the shell's code. */
const APP_SHELL_PATHS = new Set([
  '/dashboard', '/dashboard/report', '/pricing/retake', '/employer', '/employer/dashboard', '/employer/jobs',
  '/employer/applicants', '/employer/candidates', '/candidates', '/resumes', '/talent-vault', '/jobs', '/applications', '/profile',
  '/settings', '/admin',
])

/** Signed-in routes outside the shell; RequireAuth shows its own loader while the session is checked. */
const AUTH_GATED_PATHS = new Set(['/onboarding', '/interview', '/interview/now', '/interview/complete'])

/**
 * What main.tsx waits for before the first render, so the page paints in one pass.
 * Public pages: their page code. Signed-in pages: only the shell (header/footer); the page code keeps
 * downloading in parallel with the session check instead of delaying it.
 */
export function loadRouteForFirstPaint(pathname: string): Promise<unknown> {
  const path = (pathname || '/').replace(/\/+$/, '') || '/'
  const chunk = routeChunkForPath(path)
  const page = chunk ? loadRouteChunk(chunk) : Promise.resolve(null)
  page.catch(() => undefined) // lazy() imports again on render and shows the real error there
  if (APP_SHELL_PATHS.has(path)) return loadRouteChunk('appShell').catch(() => undefined)
  if (AUTH_GATED_PATHS.has(path)) return Promise.resolve()
  return page.catch(() => undefined)
}

/** Starts loading the page module for `pathname` (fire and forget; a failure surfaces when the route renders). */
export function prefetchRouteChunk(pathname: string): Promise<void> {
  const chunk = routeChunkForPath(pathname)
  if (!chunk) return Promise.resolve()
  return loadRouteChunk(chunk).then(
    () => undefined,
    () => undefined, // lazy() imports again when the route renders and shows the real error there.
  )
}

/** Props for a marketing link: start downloading the target page as soon as the visitor shows intent. */
export function prefetchOnIntent(to: string) {
  const go = () => {
    void prefetchRouteChunk(to)
  }
  return { onMouseEnter: go, onFocus: go, onTouchStart: go }
}
