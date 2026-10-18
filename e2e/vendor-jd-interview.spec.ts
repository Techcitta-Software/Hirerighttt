import { test, expect } from '@playwright/test'

const AI_ENGINEER_JD = `
We are hiring an AI Engineer to build production LLM features.
Build RAG pipelines with LangChain, embeddings in pgvector or Pinecone,
fine-tune transformer models with PyTorch and Hugging Face, evaluate LLM output quality,
deploy with MLOps and MLflow. Strong Python required.
`.trim()

const FULL_STACK_RESUME = `
Jane Candidate — React, TypeScript, Node.js, Express, PostgreSQL, REST APIs, Docker. No AI stack listed.
`.trim()

test.describe('Vendor AI job → share link → JD interview', () => {
  test('role track expands and interview uses vendor_jd mode', async ({ browser }) => {
    const vendorContext = await browser.newContext()
    const vendorPage = await vendorContext.newPage()

    await vendorPage.goto('/login')
    const employerDemo = vendorPage.getByRole('button', { name: /Employer Demo|Recruiter Demo/i })
    if (await employerDemo.isVisible()) {
      await employerDemo.click()
    } else {
      test.skip(true, 'Employer demo login not available')
    }
    await vendorPage.locator('button[type="submit"]').click()
    await vendorPage.waitForURL('**/employer**', { timeout: 20000 }).catch(() => {})

    await vendorPage.getByRole('button', { name: /Create Private Job Opening/i }).click()
    await vendorPage.getByLabel('Job Title').fill('AI Engineer')
    const roleSelect = vendorPage.getByLabel('Role Track')
    await expect(roleSelect).toHaveValue('AI Engineer')
    const optionCount = await roleSelect.locator('option').count()
    expect(optionCount).toBeGreaterThanOrEqual(35)
    await expect(roleSelect.locator('option', { hasText: 'Data Scientist' })).toHaveCount(1)
    await expect(roleSelect.locator('option', { hasText: 'Sales / Account Executive' })).toHaveCount(1)
    await vendorPage.getByLabel(/Job Description|Description/i).fill(AI_ENGINEER_JD)
    await vendorPage.getByRole('button', { name: /Create|Post|Save/i }).click()

    const shareLink = vendorPage.locator('a[href*="/apply/"]').first()
    await expect(shareLink).toBeVisible({ timeout: 20000 })
    const applyUrl = await shareLink.getAttribute('href')
    assertApplyUrl(applyUrl)

    const candidateContext = await browser.newContext()
    const page = await candidateContext.newPage()
    await page.goto(applyUrl!)

    await page.getByLabel(/Full name|Name/i).fill('Jane Candidate')
    await page.getByLabel(/Email/i).fill(`jd-cand-${Date.now()}@example.test`)
    await page.getByLabel(/Phone/i).fill('+15551234567')
    await page.getByLabel(/Experience/i).fill('5')

    const resumeInput = page.locator('input[type="file"]')
    if (await resumeInput.count()) {
      await resumeInput.setInputFiles({
        name: 'resume.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(FULL_STACK_RESUME),
      })
    } else {
      const resumeArea = page.locator('textarea').first()
      if (await resumeArea.isVisible()) {
        await resumeArea.fill(FULL_STACK_RESUME)
      }
    }

    const startPromise = page.waitForResponse(
      (res) => res.url().includes('/api/interview/start') && res.request().method() === 'POST',
    )
    await page.getByRole('button', { name: /Apply|Submit/i }).click()
    await page.getByRole('button', { name: /Continue to AI interview/i }).click({ timeout: 30000 })

    const startResponse = await startPromise
    const startBody = startResponse.request().postDataJSON() as { applicationId?: string }
    expect(startBody.applicationId).toBeTruthy()
    const startJson = (await startResponse.json()) as { questionMode?: string; question?: { text?: string } }
    expect(startJson.questionMode).toBe('vendor_jd')

    const q1 = startJson.question?.text || ''
    expect(/rag|langchain|pytorch|llm|embedding|mlops|hugging|vector|python/i.test(q1)).toBeTruthy()

    await vendorContext.close()
    await candidateContext.close()
  })
})

function assertApplyUrl(url: string | null): asserts url is string {
  if (!url) throw new Error('Share link not found')
}
