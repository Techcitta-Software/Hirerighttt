import { test, expect } from '@playwright/test'

test.describe('Marketing & Informational Pages', () => {
  test('Home page loads with brand, hero, and navigation', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/HIRERIGHTTT|HireRight/i)

    await expect(page.getByRole('link', { name: /HireRighttt Home/i }).first()).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'Main Navigation' })
    await expect(nav.getByRole('link', { name: /HOW IT WORKS/i })).toBeVisible()
    await expect(nav.getByRole('link', { name: /FAQS/i })).toBeVisible()
  })

  test('How It Works page shows the four-step career clarity flow', async ({ page }) => {
    await page.goto('/how-it-works')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Career Clarity Starts with a/i)

    await expect(page.getByText('Talk for 15 Minutes')).toBeVisible()
    await expect(page.getByText('Discover Your 360° View')).toBeVisible()
    await expect(page.getByText('AI Interview Practice')).toBeVisible()
  })

  test('Resources Hub provides interactive STAR builder, rubrics, and FAQs', async ({ page }) => {
    await page.goto('/resources')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Ace Your Interview/i)

    await expect(page.getByRole('heading', { name: 'The STAR Response Framework' })).toBeVisible()

    const textarea = page.locator('textarea')
    await textarea.fill(
      'Situation: During our cloud migration, latency spiked. Task: I needed to optimize query cache. Action: I added Redis with write-through cache. Result: p99 latency dropped by 50% across 200k daily active users.',
    )

    await expect(page.getByText(/words/i).first()).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Technical Depth' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Communication Clarity' })).toBeVisible()

    const firstFaqQuestion = page.getByRole('button', { name: /Can I retake my AI interview/i })
    await firstFaqQuestion.click()
    await expect(page.getByText(/HireRight encourages continuous improvement/i)).toBeVisible()
  })

  test('Job Seekers page highlights career-stage messaging', async ({ page }) => {
    await page.goto('/job-seekers')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Whatever Your Career Stage/i)
    await expect(page.getByText(/WHO IT’S FOR|WHO IT'S FOR/i).first()).toBeVisible()
  })

  test('Why page provides comparison matrix and recruiter ROI calculator', async ({ page }) => {
    await page.goto('/why')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Why HireRight/i)

    await expect(page.getByText('Resume Boards vs. HireRight')).toBeVisible()
    await expect(page.getByText('Calculate Your Monthly ROI')).toBeVisible()
    await expect(page.getByText('Recruiter Hours Reclaimed:')).toBeVisible()
  })

  test('Pricing page displays all 3 tiers with features', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Hire the best/i)

    await expect(page.getByRole('heading', { name: 'Job Seeker Free' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pro Recruiter & ATS' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Enterprise Agency' })).toBeVisible()
  })

  test('About route shows FAQ hub content', async ({ page }) => {
    await page.goto('/about')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Frequently Asked Questions/i)
    await expect(page.getByText(/FAQS/i).first()).toBeVisible()
  })

  test('Contact page submits inquiry and shows confirmation', async ({ page }) => {
    await page.goto('/contact')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Contact HireRight/i)

    await page.locator('input').first().fill('Aarav Mehta')
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('aarav@example.com')
    await page.locator('textarea').fill('Interested in scheduling a platform demonstration for our engineering team.')

    await page.getByRole('button', { name: /Send message/i }).click()
    await expect(page.getByText(/Thanks Aarav Mehta/i)).toBeVisible()
  })
})
