import { test, expect } from '@playwright/test'

async function loginAsJobseeker(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const email = `profile-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`
  const password = 'ExamplePass123!'

  const apiBase = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:8787'
  let signup
  try {
    signup = await request.post(`${apiBase}/api/signup`, {
      data: {
        name: 'E2E Profile',
        email,
        password,
        role: 'jobseeker',
        phone: '+15550002001',
      },
    })
  } catch {
    test.skip(true, 'Local API on :8787 required for profile e2e')
    return
  }
  test.skip(signup.status() !== 201, 'Local API on :8787 required for profile e2e')

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/^password$/i).fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/dashboard', { timeout: 25000 })
  await page.goto('/profile')
}

test.describe('Profile section edits', () => {
  test('Edit skills saves via API and clears updating state', async ({ page, request }) => {
    await loginAsJobseeker(page, request)

    await page.getByTestId('skills-edit-btn').click()
    await page.getByTestId('skills-add-input').fill('Playwright Testing')
    await page.getByTestId('skills-add-btn').click()
    await expect(page.getByTestId('skill-pill-Playwright-Testing')).toBeVisible()

    await page.getByTestId('skills-done-btn').click()
    await expect(page.getByTestId('skills-saving-notice')).toBeVisible()
    await expect(page.getByTestId('skills-saving-notice')).toBeHidden({ timeout: 15000 })
    await expect(page.getByTestId('skills-edit-btn')).toBeVisible()
  })

  test('Edit basics saves and clears updating state', async ({ page, request }) => {
    await loginAsJobseeker(page, request)

    await page.getByTestId('basics-edit-btn').click()
    await page.getByTestId('basics-full-name').fill('Basics Updated Name')
    await page.getByTestId('basics-city').fill('Chennai')

    await page.getByTestId('basics-done-btn').click()
    await expect(page.getByTestId('basics-saving-notice')).toBeVisible()
    await expect(page.getByTestId('basics-saving-notice')).toBeHidden({ timeout: 15000 })
    await expect(page.getByTestId('basics-edit-btn')).toBeVisible()
    await expect(page.getByTestId('basics-full-name')).toHaveValue('Basics Updated Name')
    await expect(page.getByTestId('basics-city')).toHaveValue('Chennai')
  })

  test('Edit role and experience saves and clears updating state', async ({ page, request }) => {
    await loginAsJobseeker(page, request)

    await page.getByTestId('role-edit-btn').click()
    await page.getByTestId('role-target').fill('Platform Engineer')
    await page.getByTestId('role-experience').selectOption('3 - 5 years')

    await page.getByTestId('role-done-btn').click()
    await expect(page.getByTestId('role-saving-notice')).toBeVisible()
    await expect(page.getByTestId('role-saving-notice')).toBeHidden({ timeout: 15000 })
    await expect(page.getByTestId('role-edit-btn')).toBeVisible()
    await expect(page.getByTestId('role-target')).toHaveValue('Platform Engineer')
    await expect(page.getByTestId('role-experience')).toHaveValue('3 - 5 years')
  })
})
