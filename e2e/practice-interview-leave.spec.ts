import { test, expect } from '@playwright/test'

test.describe('Practice interview — Leave → scorecard', () => {
  test('Leave scores and opens talent scorecard on /profile', async ({ page }) => {
    await page.goto('/login')
    const candidateDemo = page.getByRole('button', { name: /Candidate Demo/i })
    if (await candidateDemo.isVisible()) {
      await candidateDemo.click()
    }
    await page.locator('button[type="submit"]').click()
    await page.waitForURL('**/dashboard', { timeout: 20000 })

    await page.goto('/interview')
    await page.getByRole('button', { name: /Continue without camera/i }).click()
    await page.getByRole('button', { name: /Join interview|Start interview/i }).click()
    await page.waitForSelector('button:has-text("Leave")', { timeout: 60000 })

    const typeToggle = page.getByRole('button', { name: /Use keyboard|Hide keyboard/i })
    if (await typeToggle.isVisible()) {
      await typeToggle.click()
    }
    const textarea = page.locator('textarea[placeholder*="Type your answer"]')
    await expect(textarea).toBeVisible({ timeout: 10000 })
    await textarea.fill(
      'I led a full stack project using React and Node.js with measurable latency improvements.',
    )

    await page.getByRole('button', { name: 'Leave' }).click()
    await page.waitForURL('**/profile', { timeout: 90000 })
    await expect(page.getByRole('heading', { name: /Talent scorecard/i })).toBeVisible()
    await expect(page.getByText(/Overall|Interview certification/i).first()).toBeVisible()
  })
})
