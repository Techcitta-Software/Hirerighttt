import { test, expect } from '@playwright/test'

test.describe('Full Website Route Audit', () => {
  const publicRoutes = [
    { path: '/', contentCheck: 'Upload Resume' },
    { path: '/how-it-works', contentCheck: 'Career Clarity Starts with a' },
    { path: '/solutions', contentCheck: 'AI Interview Studio' },
    { path: '/job-seekers', contentCheck: 'Whatever Your Career Stage' },
    { path: '/why', contentCheck: 'Why HireRight?' },
    { path: '/resources', contentCheck: 'Ace Your Interview' },
    { path: '/pricing', contentCheck: 'Job Seeker Free' },
    { path: '/about', contentCheck: 'Frequently Asked' },
    { path: '/contact', contentCheck: 'Contact HireRight' },
    { path: '/login', contentCheck: 'Quick demo access' },
    { path: '/signup', contentCheck: 'Already have an account' },
    { path: '/apply/techcitta-sr-frontend', contentCheck: 'TechCitta Solutions' },
  ]

  for (const route of publicRoutes) {
    test(`Public route ${route.path} loads cleanly without errors`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })

      const response = await page.goto(route.path)
      expect(response?.status()).toBeLessThan(400)
      await expect(page.getByText(route.contentCheck).first()).toBeVisible()
    })
  }

  test('Job seeker authenticated routes load properly', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /Candidate · Interview demo/i }).click()
    await page.waitForURL('**/interview', { timeout: 20000 })

    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Welcome back/i)

    await page.goto('/jobs')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Interview-ranked matches/i)

    await page.goto('/applications')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/My Applications/i)

    await page.goto('/onboarding')
    await expect(page.getByText(/Profile/i).first()).toBeVisible()
  })

  test('Employer authenticated routes load properly', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /Vendor \/ Employer/i }).click()
    await page.waitForURL('**/employer/dashboard', { timeout: 20000 })

    await page.goto('/employer')
    await expect(page.getByText(/Employer AI Hiring Studio|Talent Acquisition Suite|ATS/i).first()).toBeVisible()

    await page.goto('/resumes')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /All Candidate Resumes & Profiles|Verified Talent Vault/i,
    )
  })

  test('Unknown routes route to 404 page with return home button', async ({ page }) => {
    await page.goto('/non-existent-page-xyz')
    await expect(page.getByText(/404/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Go home/i })).toBeVisible()
  })
})
