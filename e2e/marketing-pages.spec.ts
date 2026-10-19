import { test, expect } from '@playwright/test'

test.describe('Marketing & Informational Pages', () => {
  test('Home page loads with brand, hero, and navigation', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/HIRERIGHTTT|HireRight/i)

    // Check brand logo and navigation
    const brand = page.locator('header a').filter({ hasText: 'HIRERIGHT' }).first()
    await expect(brand).toBeVisible()

    // Check main navigation links in Primary navbar
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: 'How It Works' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Resources' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Pricing' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'About' })).toBeVisible()
  })

  test('How It Works page allows toggling between Candidate and Employer journeys', async ({ page }) => {
    await page.goto('/how-it-works')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/How HireRighttt Works/i)

    // Verify candidate journey cards are displayed
    await expect(page.getByText('Smart Ingestion & Resume Parsing')).toBeVisible()

    // Toggle to Employer Journey
    const employerBtn = page.getByRole('button', { name: /Employer & Recruiter Journey/i })
    await employerBtn.click()

    // Verify employer steps appear
    await expect(page.getByText('Create Private Job Openings')).toBeVisible()
    await expect(page.getByText('Generate Shareable Apply Links')).toBeVisible()
  })

  test('Resources Hub provides interactive STAR builder, rubrics, and FAQs', async ({ page }) => {
    await page.goto('/resources')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Ace Your Interview/i)

    // Check STAR Builder is present
    await expect(page.getByRole('heading', { name: 'The STAR Response Framework' })).toBeVisible()

    // Test typing in the simulator
    const textarea = page.locator('textarea')
    await textarea.fill('Situation: During our cloud migration, latency spiked. Task: I needed to optimize query cache. Action: I added Redis with write-through cache. Result: p99 latency dropped by 50% across 200k daily active users.')

    // Check word count status is visible
    await expect(page.getByText(/words/i).first()).toBeVisible()

    // Check rubrics section
    await expect(page.getByRole('heading', { name: 'Answer Correctness' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Communication' })).toBeVisible()

    // Test FAQ expansion
    const firstFaqQuestion = page.getByRole('button', { name: /Can I retake my AI interview/i })
    await firstFaqQuestion.click()
    await expect(page.getByText(/HireRighttt encourages continuous improvement/i)).toBeVisible()
  })

  test('Job Seekers page features interactive Talent Value Calculator', async ({ page }) => {
    await page.goto('/job-seekers')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Your Resume Isn't Enough/i)

    // Check calculator
    await expect(page.getByText('TALENT VALUE ESTIMATOR')).toBeVisible()
    const devOpsBtn = page.getByRole('button', { name: 'DevOps & Cloud' })
    await devOpsBtn.click()
    await expect(page.getByText('Certified Top 8% in DevOps & Cloud')).toBeVisible()

    // Check 4-step path
    await expect(page.getByText('The 4-Step Path from Candidate to Hired')).toBeVisible()
  })

  test('Legal pages and cookie consent are reachable', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Privacy Policy/i)

    await page.goto('/terms')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Terms/i)

    await page.goto('/cookies')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Cookie Policy/i)
    await expect(page.getByRole('button', { name: /Accept essential only/i })).toBeVisible()
  })

  test('Why page provides comparison matrix and recruiter ROI calculator', async ({ page }) => {
    await page.goto('/why')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Why HireRighttt/i)

    // Check comparison table
    await expect(page.getByText('Resume Boards vs. HireRighttt')).toBeVisible()
    await expect(page.getByText('Candidate Evaluation Basis')).toBeVisible()

    // Check ROI calculator
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

  test('About page shows mission, leadership, and security trust center', async ({ page }) => {
    await page.goto('/about')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Reinventing the Initial Screen/i)

    await expect(page.getByText('Our Mission & Technological Architecture')).toBeVisible()
    await expect(page.getByText('Meet the Builders Behind Ava')).toBeVisible()
    await expect(page.getByText('Security, Ethics & Compliance')).toBeVisible()
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
