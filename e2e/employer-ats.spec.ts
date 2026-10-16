import { test, expect } from '@playwright/test'

test.describe('Employer ATS & Talent Studio', () => {
  test('Employer logs in, creates private opening, manages pipeline, inspects vault & admin ATS', async ({ page }) => {
    // 1. Log in with Employer Demo
    await page.goto('/login')
    await page.getByRole('button', { name: /Vendor \/ Employer/i }).click()

    // 2. Lands on Employer Studio
    await page.waitForURL('**/employer/dashboard', { timeout: 20000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Employer AI Hiring Studio/i)

    // Check stats are rendered
    await expect(page.getByText('Active Openings')).toBeVisible()
    await expect(page.getByText('Total Candidates')).toBeVisible()

    // 3. Create Private Job Opening
    const createJobBtn = page.getByRole('button', { name: /Create Private Job Opening/i })
    await createJobBtn.click()

    // Fill form
    await page.locator('input[placeholder*="Senior Frontend Developer"]').fill('Staff Distributed Systems Engineer')
    await page.locator('textarea[placeholder*="Paste the full job description"]').fill(
      'Lead design and implementation of distributed event streaming architecture using Kafka, Redis, and Go.',
    )

    const submitCreateJob = page.getByRole('button', { name: /Generate Shareable Job Link/i })
    await submitCreateJob.click()

    // Verify job appears in openings list
    await expect(page.getByRole('heading', { name: 'Staff Distributed Systems Engineer' })).toBeVisible()

    // Verify "Copy Link" button is present
    await expect(page.getByRole('button', { name: /Copy Link/i }).first()).toBeVisible()

    // 4. Update applicant status in Employer Studio
    const statusSelect = page.locator('select').first()
    if (await statusSelect.isVisible()) {
      await statusSelect.selectOption('Shortlisted')
    }

    // 5. Navigate to Talent Vault
    await page.goto('/talent-vault')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/All Candidate Resumes/i)

    // Search for candidates by skill
    const searchInput = page.getByPlaceholder(/Search platform talent|Search by candidate name/i)
    await searchInput.fill('Sneha')

    // Verify Sneha Iyer is found
    await expect(page.getByText('Sneha Iyer').first()).toBeVisible()

    // 6. Navigate to Admin ATS Pipeline
    await page.goto('/admin')
    await expect(page.getByText(/Admin dashboard|Recruiter operations/i).first()).toBeVisible()

    // Verify tabs
    const nav = page.locator('nav')
    await expect(nav.getByRole('button', { name: 'Dashboard' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Candidates' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Pipeline' })).toBeVisible()
    await expect(nav.locator('button').filter({ hasText: 'AI Matcher' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Analytics' })).toBeVisible()

    // Click Pipeline tab
    await nav.getByRole('button', { name: 'Pipeline' }).click()
    await expect(page.getByRole('heading', { level: 4, name: 'Applied' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 4, name: 'Shortlisted' })).toBeVisible()

    // Click AI Matcher tab
    await nav.locator('button').filter({ hasText: 'AI Matcher' }).click()
    await expect(page.getByText(/AI Match/i).first()).toBeVisible()

    // Click Analytics tab
    await nav.getByRole('button', { name: 'Analytics' }).click()
    await expect(page.getByRole('heading', { level: 1, name: /Recruiter analytics/i })).toBeVisible()
    await expect(page.getByText(/Monthly applications vs hires/i)).toBeVisible()
  })
})
