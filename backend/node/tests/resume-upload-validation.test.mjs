import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseResumeUploadBody,
  MAX_RESUME_BYTES,
  inferResumeContentType,
} from '../storage/resumeUploadValidation.mjs'

test('parseResumeUploadBody accepts pdf and docx within size limit', () => {
  const pdf = parseResumeUploadBody({
    filename: 'resume.pdf',
    file_base64: Buffer.from('%PDF-1.4').toString('base64'),
  })
  assert.equal(pdf.filename, 'resume.pdf')
  assert.ok(pdf.buffer.length > 0)

  const docx = parseResumeUploadBody({
    filename: 'cv.docx',
    file_base64: Buffer.from('PK').toString('base64'),
  })
  assert.equal(docx.filename, 'cv.docx')
})

test('parseResumeUploadBody rejects bad extension, payload, and oversize files', () => {
  assert.throws(() => parseResumeUploadBody({ filename: 'resume.exe', file_base64: 'AA==' }), /PDF or DOCX/)
  assert.throws(() => parseResumeUploadBody({ filename: 'resume.pdf', file_base64: '***' }), /Invalid file_base64/)
  const big = Buffer.alloc(MAX_RESUME_BYTES + 1)
  assert.throws(
    () =>
      parseResumeUploadBody({
        filename: 'resume.pdf',
        file_base64: big.toString('base64'),
      }),
    /2 MB/,
  )
})

test('inferResumeContentType maps extensions', () => {
  assert.equal(inferResumeContentType('a.pdf', ''), 'application/pdf')
  assert.equal(inferResumeContentType('a.docx', ''), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(inferResumeContentType('a.pdf', 'application/custom'), 'application/custom')
})
