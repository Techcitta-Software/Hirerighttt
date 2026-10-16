const REPORT_ID = 'career-intelligence-dashboard'

/** A4 width in PDF points. Page height grows so the whole report stays on one page. */
const PAGE_WIDTH = 595.28
const PAGE_MARGIN = 28

function safeFileName(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${base || 'hireright'}-career-report.pdf`
}

/**
 * Download the career report as one PDF page. The whole dashboard is captured
 * and scaled to fit that single page so nothing is split onto a second page.
 */
export async function downloadElementAsPdf(
  elementId: string,
  downloadName: string,
  title = 'HireRight report',
): Promise<void> {
  const root = document.getElementById(elementId)
  if (!root) throw new Error('Report is not on the page.')

  const [{ default: html2canvas }, { PDFDocument }] = await Promise.all([
    import('html2canvas'),
    import('pdf-lib'),
  ])

  const canvas = await html2canvas(root, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: Math.max(root.scrollWidth, 900),
    onclone: (doc) => {
      doc.querySelectorAll('[data-download-exclude]').forEach((node) => {
        ;(node as HTMLElement).style.display = 'none'
      })
    },
  })

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the report.'))),
      'image/png',
    )
  })
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())

  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('HireRight')
  const image = await pdf.embedPng(pngBytes)
  const drawWidth = PAGE_WIDTH - PAGE_MARGIN * 2
  const drawHeight = (image.height / image.width) * drawWidth
  const page = pdf.addPage([PAGE_WIDTH, drawHeight + PAGE_MARGIN * 2])
  page.drawImage(image, {
    x: PAGE_MARGIN,
    y: PAGE_MARGIN,
    width: drawWidth,
    height: drawHeight,
  })

  const saved = await pdf.save()
  const pdfBytes = saved.slice()
  const file = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = downloadName.endsWith('.pdf') ? downloadName : `${downloadName}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function downloadScorecardPdf(candidateName = 'candidate'): Promise<void> {
  const root = document.getElementById(REPORT_ID)
  if (!root) throw new Error('Report is not on the page.')

  await downloadElementAsPdf(REPORT_ID, safeFileName(candidateName), 'HireRight career report')
}
