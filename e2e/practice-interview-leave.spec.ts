import { test, expect, type Page } from '@playwright/test'

async function enterInterviewRoom(page: Page) {
  await page.goto('/login')
  const cookies = page.getByRole('button', { name: /Accept essential only/i })
  if (await cookies.isVisible()) await cookies.click()
  await page.getByRole('button', { name: /Candidate · Interview demo/i }).click()
  await page.waitForURL('**/interview', { timeout: 30000 })
  page.on('console', (msg) => {
    if (/\[InterviewPage\]|\[interview\]/.test(msg.text())) console.log('[browser]', msg.text())
  })
  // Fake media device: wait for the lobby camera stream so the recorder has something to capture.
  await page.waitForFunction(
    () => [...document.querySelectorAll('video')].some((v) => v.srcObject),
    undefined,
    { timeout: 20000 },
  )
  // The synthetic camera has no face, so bypass the face gate; the stream stays live for recording.
  await page.getByRole('button', { name: /Continue without camera/i }).click()
  for (const label of [
    'I am alone in a quiet place',
    'My face is visible and facing the camera',
    'I will answer out loud',
  ]) {
    await page.getByRole('checkbox', { name: label }).check()
  }

  const startResponse = page.waitForResponse(
    (r) => r.url().includes('/api/interview/start') && r.request().method() === 'POST',
    { timeout: 90000 },
  )
  await page.getByRole('button', { name: /Enter interview room/i }).click()
  const start = await startResponse
  expect(start.status(), 'server interview session (not offline fallback)').toBe(200)
  await page.waitForSelector('button:has-text("Leave")', { timeout: 90000 })
}

async function typeAnswer(page: Page, text: string) {
  const textarea = page.locator('textarea[placeholder*="Type your answer"]')
  const useKeyboard = page.getByRole('button', { name: /Use keyboard/i })
  if (!(await textarea.isVisible())) {
    await expect(useKeyboard).toBeVisible({ timeout: 15000 })
    await useKeyboard.click()
  }
  await expect(textarea).toBeVisible({ timeout: 15000 })
  await textarea.fill(text)
}

test.describe('Practice interview — Leave → report', () => {
  test('Leave uploads the recording to S3 and opens the career report', async ({ page }) => {
    test.setTimeout(240000)
    const reviewFailures: number[] = []
    page.on('response', (r) => {
      if (r.url().includes('/api/interview/review-events') && !r.ok()) reviewFailures.push(r.status())
    })

    await enterInterviewRoom(page)
    // Let the recorder and the 5s review-event sync run at least once.
    await page.waitForTimeout(7000)
    await typeAnswer(
      page,
      'I led a full stack project using React and Node.js with measurable latency improvements.',
    )

    const recordingComplete = page.waitForResponse(
      (r) => r.url().includes('/api/interview/recordings/complete'),
      { timeout: 120000 },
    )
    await page.getByRole('button', { name: 'Leave' }).click()

    const complete = await recordingComplete
    expect(complete.status(), 'recording HeadObject verified in S3').toBe(200)
    const body = (await complete.json()) as { storageKey?: string; key?: string }
    console.log('[e2e] recording stored at', body.storageKey || body.key || JSON.stringify(body))

    await page.waitForURL('**/dashboard/report', { timeout: 120000 })
    await expect(page.getByRole('button', { name: /Download Report/i })).toBeVisible()
    await expect(page.getByText(/Career Intelligence|AI-Powered Career Intelligence/i).first()).toBeVisible()
    expect(reviewFailures, 'review-event sync responses').toEqual([])
  })

  test('Leave with no answer exits the room without looping', async ({ page }) => {
    test.setTimeout(180000)
    await enterInterviewRoom(page)
    await page.getByRole('button', { name: 'Leave' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/interview'), { timeout: 30000 })
  })
})
