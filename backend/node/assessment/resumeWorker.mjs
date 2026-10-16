import { parentPort, workerData } from 'node:worker_threads'

try {
  const buffer = Buffer.from(workerData.buffer)
  let text = ''
  if (workerData.pdf) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false })
    const document = await task.promise
    try {
      if (document.numPages > 30) throw new Error('Too many pages')
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        text += content.items.map(item => item.str || '').join(' ') + '\n'
        if (text.length > 100000) throw new Error('Too much text')
        page.cleanup()
      }
    } finally { await task.destroy() }
  } else {
    // Reject ZIP64, encrypted archives, and excessive expanded sizes before extraction.
    let end = -1
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break }
    }
    if (end < 0) throw new Error('Invalid DOCX archive')
    const count = buffer.readUInt16LE(end + 10)
    let pos = buffer.readUInt32LE(end + 16)
    let expanded = 0
    if (count > 500 || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) throw new Error('Unsupported archive')
    let hasDocument = false
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid archive entry')
      if (buffer.readUInt16LE(pos + 8) & 1) throw new Error('Encrypted archive')
      expanded += buffer.readUInt32LE(pos + 24)
      if (expanded > 20000000) throw new Error('Archive too large')
      const nameLength = buffer.readUInt16LE(pos + 28)
      const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString()
      if (name === 'word/document.xml') hasDocument = true
      pos += 46 + nameLength + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32)
    }
    if (!hasDocument || pos !== end) throw new Error('Invalid DOCX contents')
    const mammoth = await import('mammoth')
    text = (await mammoth.default.extractRawText({ buffer })).value
  }
  if (!text.trim() || text.length > 100000) throw new Error('No usable text')
  parentPort.postMessage({ text: text.trim() })
} catch {
  parentPort.postMessage({ error: 'Could not safely extract resume text. Use a text-based PDF or DOCX, or provide corrected extracted text.' })
}
