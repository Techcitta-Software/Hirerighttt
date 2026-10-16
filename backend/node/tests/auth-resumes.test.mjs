import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hashPassword, verifyPassword } from '../authPasswords.mjs'
import { extractResume } from '../assessment/resumes.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'

test('scrypt passwords, legacy verification and malformed hashes', async () => {
  const hash = await hashPassword('example-password')
  assert.ok(hash.startsWith('scrypt$'))
  assert.equal(await verifyPassword('example-password', hash), true)
  assert.equal(await verifyPassword('wrong-password', hash), false)
  const legacy = `salt$${createHash('sha256').update('salt:example-password').digest('hex')}`
  assert.equal(await verifyPassword('example-password', legacy), true)
  assert.equal(await verifyPassword('wrong-password', legacy), false)
  assert.equal(await verifyPassword('example-password', 'scrypt$bad$bad'), false)
})
test('extracts text-only PDF in a bounded worker', async () => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage().drawText('Candidate has customer support experience.', { font })
  const bytes = await pdf.save()
  const text = await extractResume({ filename: 'resume.pdf', file_base64: Buffer.from(bytes).toString('base64') })
  assert.match(text, /customer support experience/)
})
test('extracts DOCX text and rejects oversized expanded archives', async () => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Customer support experience</w:t></w:r></w:p></w:body></w:document>')
  let bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  assert.match(await extractResume({ filename: 'resume.docx', file_base64: bytes.toString('base64') }), /Customer support experience/)
  zip.file('large.txt', 'x'.repeat(21000000))
  bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await assert.rejects(extractResume({ filename: 'resume.docx', file_base64: bytes.toString('base64') }), /safely extract/)
})
