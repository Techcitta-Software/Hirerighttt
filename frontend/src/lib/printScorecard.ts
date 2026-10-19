const REPORT_ID = 'career-intelligence-dashboard'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const PAGE_MARGIN = 36
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2
const CONTENT_HEIGHT = A4_HEIGHT - PAGE_MARGIN * 2

function safeFileName(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${base || 'hireright'}-career-report.pdf`
}

type StyleBackup = { el: HTMLElement; overflow: string; maxHeight: string; height: string }

function unlockScrollAncestors(root: HTMLElement): () => void {
  const backups: StyleBackup[] = []
  let el: HTMLElement | null = root
  while (el && el !== document.documentElement) {
    backups.push({
      el,
      overflow: el.style.overflow,
      maxHeight: el.style.maxHeight,
      height: el.style.height,
    })
    el.style.overflow = 'visible'
    el.style.maxHeight = 'none'
    if (el.tagName === 'BODY') {
      el.style.height = 'auto'
    }
    el = el.parentElement
  }
  document.documentElement.style.overflow = 'visible'
  document.body.style.overflow = 'visible'

  return () => {
    for (const b of backups) {
      b.el.style.overflow = b.overflow
      b.el.style.maxHeight = b.maxHeight
      b.el.style.height = b.height
    }
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the report.'))),
      'image/png',
    )
  })
}

async function captureElementCanvas(root: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas')

  root.setAttribute('data-pdf-export', 'true')
  root.scrollTop = 0
  window.scrollTo(0, 0)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  const captureWidth = Math.max(root.scrollWidth, root.offsetWidth, 900)
  const captureHeight = root.scrollHeight
  const scale = Math.min(2, 2400 / captureWidth)

  try {
    return await html2canvas(root, {
      backgroundColor: '#ffffff',
      scale,
      width: captureWidth,
      height: captureHeight,
      windowWidth: captureWidth,
      windowHeight: captureHeight,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      logging: false,
      onclone: (doc) => {
        const cloned = doc.getElementById(root.id) ?? doc.querySelector('[data-pdf-export]')
        if (cloned instanceof HTMLElement) {
          cloned.setAttribute('data-pdf-export', 'true')
          cloned.style.overflow = 'visible'
          cloned.style.maxHeight = 'none'
          cloned.style.height = 'auto'
          cloned.style.width = `${captureWidth}px`
          cloned.style.maxWidth = `${captureWidth}px`
        }
        doc.querySelectorAll('[data-download-exclude]').forEach((node) => {
          ;(node as HTMLElement).style.display = 'none'
        })
        doc.body.style.overflow = 'visible'
        doc.body.style.height = 'auto'
        doc.documentElement.style.overflow = 'visible'
      },
    })
  } finally {
    root.removeAttribute('data-pdf-export')
  }
}

async function buildMultiPagePdfFromCanvas(
  canvas: HTMLCanvasElement,
  title: string,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('HireRight')

  const pxToPt = CONTENT_WIDTH / canvas.width
  const sliceHeightPx = Math.floor(CONTENT_HEIGHT / pxToPt)

  let offsetY = 0
  while (offsetY < canvas.height) {
    const chunkHeight = Math.min(sliceHeightPx, canvas.height - offsetY)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = chunkHeight
    const ctx = slice.getContext('2d')
    if (!ctx) throw new Error('Could not render report page.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, slice.height)
    ctx.drawImage(canvas, 0, offsetY, canvas.width, chunkHeight, 0, 0, canvas.width, chunkHeight)

    const pngBytes = new Uint8Array(await (await canvasToBlob(slice)).arrayBuffer())
    const image = await pdf.embedPng(pngBytes)
    const drawHeight = chunkHeight * pxToPt

    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
    page.drawImage(image, {
      x: PAGE_MARGIN,
      y: A4_HEIGHT - PAGE_MARGIN - drawHeight,
      width: CONTENT_WIDTH,
      height: drawHeight,
    })

    offsetY += chunkHeight
  }

  return pdf.save()
}

/**
 * Download report as a multi-page A4 PDF (full content, readable layout).
 */
export async function downloadElementAsPdf(
  elementId: string,
  downloadName: string,
  title = 'HireRight report',
): Promise<void> {
  const root = document.getElementById(elementId)
  if (!root) throw new Error('Report is not on the page.')

  const restoreScroll = unlockScrollAncestors(root)
  try {
    const canvas = await captureElementCanvas(root)
    const pdfBytes = await buildMultiPagePdfFromCanvas(canvas, title)
    const file = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = downloadName.endsWith('.pdf') ? downloadName : `${downloadName}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } finally {
    restoreScroll()
  }
}

export async function downloadScorecardPdf(candidateName = 'candidate'): Promise<void> {
  const root = document.getElementById(REPORT_ID)
  if (!root) throw new Error('Report is not on the page.')

  await downloadElementAsPdf(REPORT_ID, safeFileName(candidateName), 'HireRight career report')
}
