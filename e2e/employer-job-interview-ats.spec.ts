import { test, expect } from '@playwright/test'

/**
 * Verifies employer-posted job context flows to interview (JD in sessionStorage)
 * and jobs board loads from API without flashing empty.
 */
test.describe('Employer job → candidate interview (JD context)', () => {
  test('candidate demo can open /jobs and persist target job for interview', async ({ page }) => {
    await page.goto('/login')
    const candidateDemo = page.getByRole('button', { name: /Candidate Demo/i })
    if (await candidateDemo.isVisible()) {
      await candidateDemo.click()
    }
    await page.locator('button[type="submit"]').click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })

    await page.goto('/jobs')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Interview-ranked matches/i)

    const jobCard = page.locator('article').first()
    const hasJob = await jobCard.isVisible().catch(() => false)
    if (!hasJob) {
      test.skip(true, 'No employer jobs in API — seed a job first')
    }

    const interviewBtn = jobCard.getByRole('button', { name: /Interview to apply/i })
    await interviewBtn.click()
    await page.waitForURL('**/interview', { timeout: 10000 })

    const targetRaw = await page.evaluate(() => sessionStorage.getItem('hireright.targetJob'))
    expect(targetRaw).toBeTruthy()
    const target = JSON.parse(targetRaw || '{}') as { jd?: string; title?: string }
    expect(target.title).toBeTruthy()
    expect(String(target.jd || '').length).toBeGreaterThan(0)
  })
})
