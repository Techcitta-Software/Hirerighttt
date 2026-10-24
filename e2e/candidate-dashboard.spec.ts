import { test, expect } from '@playwright/test'

const email = 'dashboard-test@example.com'
const user = { id: 'dashboard-test', email, name: 'Maya Patel', role: 'jobseeker', createdAt: '2026-01-01' }
const profile = { fullName: 'Maya Patel', currentRole: 'Frontend Engineer', totalExperience: '4 years', currentLocation: 'Pune', resumeName: 'maya-resume.pdf', skills: ['React', 'TypeScript'], noticePeriod: '30 days', completedSteps: 5, updatedAt: '2026-10-21T12:00:00Z' }
const interview = { role: 'Frontend Engineer', level: 'Mid-level', date: '2026-10-21T10:00:00Z', overall: 82, categories: [{ label: 'Technical knowledge', score: 86 }, { label: 'Communication', score: 78 }], strengths: ['Explains technical decisions with clear examples.'], improvements: ['Quantify the impact of your work.'], answers: [{ question: 'How did you improve performance?', answer: 'I measured render times and reduced redundant renders.', score: 82, feedback: 'Include measured results.', wordCount: 10, keywordsHit: [] }] }

async function setup(page: import('@playwright/test').Page, options = { empty: false, fail: false }) {
  await page.addInitScript(({ email, user, profile, interview, empty }) => {
    localStorage.setItem('hireright.storageVersion', '2026-10-16-clean-roster-v1')
    localStorage.setItem('hireright.users', JSON.stringify([user]))
    localStorage.setItem('hireright.session', email)
    localStorage.setItem('hireright.apiToken', 'test-token')
    localStorage.setItem('hireright.cookieConsent', JSON.stringify({version: 1, essential: true, analytics: false, decidedAt: '2026-10-24'}))
    localStorage.setItem(`hireright.profile.${email}`, JSON.stringify(profile))
    if (!empty) localStorage.setItem(`hireright.interviewResult.${email}`, JSON.stringify(interview))
    // A different account's legacy result must never appear.
    localStorage.setItem('hireright.interviewResult', JSON.stringify({ ...interview, overall: 99 }))
  }, { email, user, profile, interview, empty: options.empty })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/me') return route.fulfill({ json: { user, profile, interview: options.empty ? null : interview } })
    if (path === '/api/health') return route.fulfill({ json: { ok: true } })
    if (options.fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
    if (path === '/api/jobs') return route.fulfill({ json: { jobs: options.empty ? [] : [{ id: 'role-1', title: 'React Developer', company: 'Example Company', location: 'Remote', requiredSkills: ['React'] }] } })
    if (path === '/api/applications') return route.fulfill({ json: { applications: options.empty ? [] : [{ id: 'app-1', title: 'Frontend Engineer', company: 'Example Company', status: 'In Review', appliedAt: '2026-10-20', location: 'Pune', match: 80 }] } })
    return route.fulfill({ json: {} })
  })
}

test('dashboard displays real data, downloads a PDF and opens job matches', async ({ page }) => {
  await setup(page)
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Welcome back, Maya.' })).toBeVisible()
  await expect(page.getByText('Refreshing your dashboard…')).toBeHidden()
  await expect(page.getByText('1 in review')).toBeVisible()
  await expect(page.getByText('82', { exact: false }).first()).toBeVisible()
  await page.getByRole('link', { name: 'View Report', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard\/report$/)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Report', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('maya-patel-career-report.pdf')
  expect(await download.failure()).toBeNull()
  await page.goto('/dashboard')
  await expect(page.getByText('Refreshing your dashboard.')).toBeHidden()
  await expect(page.getByRole('heading', {name: 'Welcome back, Maya.'})).toBeVisible()
  await page.screenshot({ path: 'test-results/candidate-dashboard-desktop.png', fullPage: true })
  await page.getByRole('link', { name: 'Browse all roles', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs$/)
})

test('empty dashboard has no invented scores and fits mobile', async ({ page }) => {
  await setup(page, { empty: true, fail: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard')
  await expect(page.getByText('Refreshing your dashboard…')).toBeHidden()
  await expect(page.getByRole('button', { name: 'View Report', exact: true })).toBeDisabled()
  await expect(page.getByText('No open roles at the moment.', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/candidate-dashboard-mobile.png', fullPage: true })
})

test('unavailable data is distinct from empty data and retry recovers', async ({ page }) => {
  await setup(page, { empty: false, fail: true })
  await page.goto('/dashboard')
  await expect(page.getByText('Open roles could not be loaded.')).toBeVisible()
  await page.route('**/api/jobs*', route => route.fulfill({ json: { jobs: [] } }))
  await page.route('**/api/applications', route => route.fulfill({ json: { applications: [] } }))
  await page.getByRole('button', { name: 'Retry refresh' }).click()
  await expect(page.getByText('No open roles at the moment.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry refresh' })).toBeHidden()
})

test('profile updates reach the API and failed saves keep the previous stored profile', async ({ page }) => {
  await setup(page)
  await page.goto('/profile')
  await page.getByTestId('basics-edit-btn').click()
  await page.getByTestId('basics-full-name').fill('Maya Updated')
  await page.route('**/api/profile', route => route.fulfill({ status: 503, json: { error: 'Save unavailable' } }))
  await page.getByTestId('basics-done-btn').click()
  await expect(page.getByTestId('basics-saving-notice')).toBeHidden()
  expect(await page.evaluate(email => JSON.parse(localStorage.getItem(`hireright.profile.${email}`)!).fullName, email)).toBe('Maya Patel')
  await page.route('**/api/profile', route => route.fulfill({ json: { profile: { ...route.request().postDataJSON(), updatedAt: '2026-10-21T15:00:00Z' } } }))
  await page.getByTestId('basics-done-btn').click()
  await expect(page.getByTestId('basics-edit-btn')).toBeVisible()
  expect(await page.evaluate(email => JSON.parse(localStorage.getItem(`hireright.profile.${email}`)!).fullName, email)).toBe('Maya Updated')
})


test('missing details link to the right section and job cards scroll on mobile', async ({ page }) => {
  await setup(page)
  await page.route('**/api/me', route => route.fulfill({ json: { user, profile: { ...profile, skills: [], updatedAt: '2026-10-25T12:00:00Z' }, interview } }))
  await page.route('**/api/jobs*', route => route.fulfill({ json: { jobs: Array.from({ length: 6 }, (_, i) => ({ id: `job-${i}`, title: `Developer ${i}`, company: 'Example Company', location: 'Remote', shareableCode: `role-${i}` })) } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard')
  await expect(page.getByText('Refreshing your dashboard.')).toBeHidden()
  await expect(page.getByRole('progressbar', { name: 'Profile completion' })).toHaveAttribute('value', '86')
  await expect(page.getByRole('link', { name: /Skills.*Add details/ })).toHaveAttribute('href', '/profile#skills')
  const rail = page.getByRole('list', { name: 'Open jobs, scroll horizontally' })
  await expect(rail.getByRole('listitem')).toHaveCount(6)
  await page.getByRole('button', { name: 'Next jobs', exact: true }).click()
  await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/candidate-dashboard-mobile-jobs.png', fullPage: true })
  await page.getByRole('link', { name: /Skills.*Add details/ }).click()
  await expect(page).toHaveURL(/\/profile#skills$/)
  await expect(page.getByTestId('skills-edit-btn')).toBeInViewport()
})
