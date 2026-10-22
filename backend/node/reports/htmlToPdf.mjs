/**
 * Renders HTML to PDF using Playwright (Chromium print). Requires browsers installed:
 * npx playwright install chromium
 */
export async function htmlToPdfBuffer(html, options = {}) {
  if (process.env.SCORECARD_PDF_DISABLED === '1') {
    const err = new Error('SCORECARD_PDF_DISABLED')
    err.code = 'PDF_DISABLED'
    throw err
  }
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    const err = new Error('Playwright is required for server scorecard PDFs. Run: npx playwright install chromium')
    err.code = 'PLAYWRIGHT_MISSING'
    throw err
  }
  const browser = await chromium.launch({
    headless: true,
    args: ['--font-render-hinting=none'],
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      margin: options.margin || { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
      preferCSSPageSize: false,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
