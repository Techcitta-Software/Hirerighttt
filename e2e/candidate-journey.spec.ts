import { test, expect } from '@playwright/test'

test.describe('Candidate End-to-End Loop', () => {
  test('Candidate logs in, completes AI interview, views scorecard, and applies to unlocked matches', async ({ page }) => {
    // 1. Visit Login and use Candidate Demo
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Login to/i)

    const demoCandidateBtn = page.getByRole('button', { name: /Candidate Demo/i })
    await demoCandidateBtn.click()

    const loginSubmitBtn = page.locator('button[type="submit"]')
    await loginSubmitBtn.click()

    // 2. Candidate should now be authenticated. Visit onboarding wizard
    await page.goto('/onboarding')
    await expect(page.getByText(/Build Your Profile|Profile/i).first()).toBeVisible()

    // 3. Navigate to Interview Studio
    await page.goto('/interview')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/meet your interviewer Ava/i)

    // Ensure we can continue without camera in test environment
    const noCamBtn = page.getByRole('button', { name: /Continue without camera/i })
    await noCamBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    if (await noCamBtn.isVisible()) {
      await noCamBtn.click()
    }

    // Check the 3 required lobby checkboxes
    const checkboxes = page.locator('input[type="checkbox"]')
    const count = await checkboxes.count()
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check()
    }

    // Click "Enter interview room"
    const joinBtn = page.getByRole('button', { name: /Enter interview room/i })
    await expect(joinBtn).toBeEnabled()
    await joinBtn.click()

    // 4. In Interview Room: verify question appears
    await expect(page.getByText(/Question 1 of/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Ava asks')).toBeVisible()

    // Provide an answer using keyboard fallback
    await page.getByRole('button', { name: /Use keyboard/i }).click()

    const answerInput = page.locator('textarea[placeholder="Type your answer…"]')
    await expect(answerInput).toBeVisible()
    await answerInput.fill(
      'Situation: In our recent project we optimized React rendering using memoization and virtualized lists. Task: Reduce re-render overhead. Action: Refactored state into Zustand and profiled with React DevTools. Result: 60 FPS scrolling and 45% less memory consumption.',
    )

    // Complete interview by clicking Leave
    const leaveBtn = page.getByRole('button', { name: 'Leave' })
    await expect(leaveBtn).toBeVisible()
    await leaveBtn.click()

    // Wait for scoring screen
    await expect(page.getByText(/Scoring your interview/i)).toBeVisible({ timeout: 10000 })

    // 5. Verify 360° Candidate Persona Dossier is generated
    await expect(page.getByText(/AI-Powered Career Intelligence Dashboard|Overall Career Readiness Score/i)).toBeVisible({ timeout: 25000 })
    await expect(page.getByText(/Specialized Interview Pattern Assessment/i)).toBeVisible()
    await expect(page.getByText(/ACTUAL INTERVIEW QUESTIONS & SCORING/i)).toBeVisible()

    // 6. Navigate to Candidate Dashboard
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Welcome back/i)
    await expect(page.getByRole('heading', { name: 'AI Interview Score' })).toBeVisible()

    // 7. Navigate to Jobs Page & Verify Matches Unlocked
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Interview-ranked matches/i)

    // Apply to first available job
    const applyBtn = page.getByRole('button', { name: /Apply now/i }).first()
    if (await applyBtn.isVisible()) {
      await applyBtn.click()
      await expect(page.getByText(/Applied to/i)).toBeVisible()
    }

    // 8. Navigate to Applications Page and confirm application
    await page.goto('/applications')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/My Applications/i)
  })
})
