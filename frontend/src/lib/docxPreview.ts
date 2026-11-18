/**
 * In-app preview for Word (.docx) resumes. Browsers cannot show DOCX in an iframe like a PDF, so the file is
 * converted to HTML with mammoth (already used by the resume parser) and sanitized before it is shown.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'span',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'img', 'blockquote', 'hr',
])
/** Elements removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'form'])

/** Links may only go to web pages or email. */
export function isSafeLinkUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim())
}

/** Images may only be the pictures embedded in the document (mammoth inlines them as data URIs). */
export function isSafeImageSrc(src: string): boolean {
  return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(src.trim())
}

/** Keep only plain document markup: no scripts, event handlers, styles or unsafe URLs. */
export function sanitizeDocxHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

  const clean = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase()
      if (DROP_WITH_CONTENT.has(tag)) {
        child.remove()
        continue
      }
      clean(child)
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes)) // keep the text, drop the unknown wrapper
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        const keep =
          (tag === 'a' && name === 'href' && isSafeLinkUrl(attr.value)) ||
          (tag === 'img' && name === 'src' && isSafeImageSrc(attr.value)) ||
          (tag === 'img' && name === 'alt') ||
          ((tag === 'td' || tag === 'th') && (name === 'colspan' || name === 'rowspan') && /^\d{1,2}$/.test(attr.value))
        if (!keep) child.removeAttribute(attr.name)
      }
      if (tag === 'a' && !child.getAttribute('href')) {
        child.replaceWith(...Array.from(child.childNodes)) // unsafe link: keep its text only
        continue
      }
      if (tag === 'a') {
        child.setAttribute('target', '_blank')
        child.setAttribute('rel', 'noopener noreferrer nofollow')
      }
      if (tag === 'img' && !child.getAttribute('src')) child.remove()
    }
  }
  clean(doc.body)
  return doc.body.innerHTML
}

export function isDocxDocument(contentType: string | undefined, filename: string | undefined): boolean {
  const type = (contentType || '').toLowerCase()
  return type.includes('officedocument.wordprocessingml') || (filename || '').toLowerCase().endsWith('.docx')
}

/** DOCX bytes -> safe HTML. Throws when the file is not a readable Word document. */
export async function docxToSafeHtml(data: ArrayBuffer): Promise<string> {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.convertToHtml({ arrayBuffer: data })
  const html = sanitizeDocxHtml(value || '')
  if (!html.replace(/<[^>]+>/g, '').trim()) throw new Error('This Word file has no readable text.')
  return html
}
