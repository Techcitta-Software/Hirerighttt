const REPORT_ID = 'career-intelligence-dashboard'
const CAPTURE_WIDTH = 900

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

/**
 * Pack whole blocks onto pages of `pageContentPx`.
 * A block stays on the current page when it fits in the remaining height.
 * A block that fits on an empty page, but not in the remainder, starts a new page.
 * A block taller than one page is sliced onto its own pages (the index repeats).
 * The next block starts after that slice, even when the last slice still has room.
 */
export function planPdfPages(blockHeightsPx: number[], pageContentPx: number): number[][] {
  if (!(pageContentPx > 0)) return blockHeightsPx.map((_, index) => [index])

  const pages: number[][] = []
  let current: number[] = []
  let used = 0

  const commit = () => {
    if (current.length === 0) return
    pages.push(current)
    current = []
    used = 0
  }

  for (let index = 0; index < blockHeightsPx.length; index++) {
    const height = blockHeightsPx[index]!
    if (height > pageContentPx) {
      commit()
      const slices = Math.ceil(height / pageContentPx)
      for (let slice = 0; slice < slices; slice++) pages.push([index])
      continue
    }
    if (current.length > 0 && used + height > pageContentPx) commit()
    current.push(index)
    used += height
  }

  commit()
  return pages
}

function applyCaptureStyles(cloned: HTMLElement, captureWidth: number): void {
  cloned.setAttribute('data-pdf-export', 'true')
  cloned.style.overflow = 'visible'
  cloned.style.maxHeight = 'none'
  cloned.style.height = 'auto'
  cloned.style.minHeight = '0'
  cloned.style.width = `${captureWidth}px`
  cloned.style.minWidth = `${captureWidth}px`
  cloned.style.maxWidth = `${captureWidth}px`
  cloned.style.display = 'block'
  cloned.style.position = 'relative'
  cloned.style.transform = 'none'
  let parent = cloned.parentElement
  while (parent) {
    parent.style.overflow = 'visible'
    parent.style.maxHeight = 'none'
    parent.style.height = 'auto'
    parent.style.transform = 'none'
    parent.style.animation = 'none'
    if (parent !== parent.ownerDocument.body && parent !== parent.ownerDocument.documentElement) {
      parent.style.position = 'static'
    }
    parent = parent.parentElement
  }
}

async function captureElementCanvas(root: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas')

  const dashboard = root.id === REPORT_ID ? root : root.closest<HTMLElement>(`#${REPORT_ID}`)
  const markedDashboard = Boolean(dashboard && dashboard !== root && !dashboard.hasAttribute('data-pdf-export'))
  if (markedDashboard) dashboard!.setAttribute('data-pdf-export', 'true')

  root.setAttribute('data-pdf-export', 'true')
  root.setAttribute('data-pdf-capture', 'true')
  root.scrollTop = 0
  window.scrollTo(0, 0)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  // The export stylesheet lays the scorecard out at 900px. A wider windowWidth
  // (scrollWidth from an overflowing grid) reflows the clone after the height
  // was measured, and html2canvas then paints the sections on top of each other.
  const captureWidth = CAPTURE_WIDTH
  const captureHeight = Math.max(root.scrollHeight, root.offsetHeight)
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
        const dash = doc.getElementById(REPORT_ID)
        if (dash) dash.setAttribute('data-pdf-export', 'true')
        const cloned =
          doc.querySelector('[data-pdf-capture]') ?? (root.id ? doc.getElementById(root.id) : null)
        if (cloned instanceof HTMLElement) applyCaptureStyles(cloned, captureWidth)
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
    root.removeAttribute('data-pdf-capture')
    if (markedDashboard) dashboard!.removeAttribute('data-pdf-export')
  }
}

function blockHasSize(node: HTMLElement): boolean {
  return Math.max(node.scrollHeight, node.offsetHeight) > 0 && Math.max(node.scrollWidth, node.offsetWidth) > 0
}

/** Each top-level section of the career report, skipping empty nodes. */
async function captureReportBlocks(root: HTMLElement): Promise<HTMLCanvasElement[]> {
  root.setAttribute('data-pdf-export', 'true')
  root.scrollTop = 0
  window.scrollTo(0, 0)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  try {
    const canvases: HTMLCanvasElement[] = []
    for (const node of root.children) {
      if (!(node instanceof HTMLElement) || !blockHasSize(node)) continue
      const canvas = await captureElementCanvas(node)
      if (canvas.width > 0 && canvas.height > 0) canvases.push(canvas)
    }
    if (canvases.length === 0) throw new Error('Could not capture the report.')
    return canvases
  } finally {
    root.removeAttribute('data-pdf-export')
  }
}

async function buildPdfFromBlockCanvases(
  canvases: HTMLCanvasElement[],
  title: string,
): Promise<Uint8Array> {
  if (canvases.length === 0) throw new Error('Could not capture the report.')

  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('HireRight')

  const refWidth = canvases[0]!.width
  const pxToPt = CONTENT_WIDTH / refWidth
  const pageContentPx = Math.max(1, Math.floor(CONTENT_HEIGHT / pxToPt))
  const heights = canvases.map((canvas) =>
    Math.max(0, Math.round((canvas.height * refWidth) / Math.max(1, canvas.width))),
  )
  const groups = planPdfPages(heights, pageContentPx)
  const consumed = heights.map(() => 0)

  for (const group of groups) {
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
    let usedPx = 0
    for (const index of group) {
      const canvas = canvases[index]!
      const remaining = heights[index]! - consumed[index]!
      const chunkRef = Math.min(remaining, pageContentPx - usedPx)
      if (chunkRef <= 0) continue

      const scaleToRef = refWidth / Math.max(1, canvas.width)
      const offsetY = Math.min(canvas.height, Math.round(consumed[index]! / scaleToRef))
      const chunkHeight = Math.min(canvas.height - offsetY, Math.max(1, Math.round(chunkRef / scaleToRef)))
      if (chunkHeight <= 0) continue

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
      const drawHeight = chunkHeight * (CONTENT_WIDTH / canvas.width)
      page.drawImage(image, {
        x: PAGE_MARGIN,
        y: A4_HEIGHT - PAGE_MARGIN - usedPx * pxToPt - drawHeight,
        width: CONTENT_WIDTH,
        height: drawHeight,
      })

      consumed[index] = consumed[index]! + chunkRef
      usedPx += chunkRef
    }
  }

  return pdf.save()
}

function triggerPdfDownload(pdfBytes: Uint8Array, downloadName: string): void {
  const file = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = downloadName.endsWith('.pdf') ? downloadName : `${downloadName}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Download report as a multi-page A4 PDF (full content, readable layout).
 * The career report is captured one section at a time so page breaks fall between blocks.
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
    const canvases =
      elementId === REPORT_ID ? await captureReportBlocks(root) : [await captureElementCanvas(root)]
    const pdfBytes = await buildPdfFromBlockCanvases(canvases, title)
    triggerPdfDownload(pdfBytes, downloadName)
  } finally {
    restoreScroll()
  }
}

export async function downloadScorecardPdf(candidateName = 'candidate'): Promise<void> {
  const root = document.getElementById(REPORT_ID)
  if (!root) throw new Error('Report is not on the page.')

  await downloadElementAsPdf(REPORT_ID, safeFileName(candidateName), 'HireRight career report')
}

/** PDF bytes for S3 upload (s3.md §4 F). */
export async function buildScorecardPdfBase64(): Promise<string> {
  const root = document.getElementById(REPORT_ID)
  if (!root) throw new Error('Report is not on the page.')
  const restoreScroll = unlockScrollAncestors(root)
  try {
    const pdfBytes = await buildPdfFromBlockCanvases(
      await captureReportBlocks(root),
      'HireRight career report',
    )
    let binary = ''
    for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]!)
    return btoa(binary)
  } finally {
    restoreScroll()
  }
}
