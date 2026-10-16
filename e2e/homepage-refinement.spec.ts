import { test, expect } from '@playwright/test'

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`homepage fits ${width}px and sample report supports keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Understanding You')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    const trigger = page.getByRole('button', { name: 'View Sample 360° Report' })
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close Sample Report' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('link')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    if (width <= 860) {
      const menu = page.getByRole('button', { name: /Open menu|Close menu/ })
      await menu.click()
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('Escape')
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
    }
  })
}

test('invalid resumes stay on the homepage with an actionable error', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=file]').setInputFiles({ name: 'resume.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') })
  await expect(page.getByRole('alert')).toContainText('PDF, DOC or DOCX')
  await expect(page).toHaveURL('/')
})


