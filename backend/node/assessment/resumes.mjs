import { Worker } from 'node:worker_threads'
import { check, AssessmentError } from './contracts.mjs'

export async function extractResume(body) {
  const filename = typeof body.filename === 'string' ? body.filename : ''
  check(/\.(pdf|docx)$/i.test(filename) && filename.length <= 200, 'Only PDF and DOCX resumes are supported')
  check(typeof body.file_base64 === 'string' && body.file_base64.length <= 2800000 && /^[A-Za-z0-9+/]*={0,2}$/.test(body.file_base64), 'Invalid or oversized resume upload')
  const buffer = Buffer.from(body.file_base64, 'base64')
  check(buffer.length > 0 && buffer.length <= 2_000_000, 'Resume must be at most 2 MB')
  const pdf = /\.pdf$/i.test(filename)
  check(pdf ? buffer.subarray(0, 5).toString() === '%PDF-' : buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50, 'File content does not match its extension')
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./resumeWorker.mjs', import.meta.url), { workerData: { buffer, pdf }, resourceLimits: { maxOldGenerationSizeMb: 128 }, execArgv: [] })
    const timer = setTimeout(() => { void worker.terminate(); reject(new AssessmentError(422, 'Resume extraction timed out')) }, 15000)
    worker.once('message', message => {
      clearTimeout(timer)
      void worker.terminate()
      if (message.error) reject(new AssessmentError(422, message.error))
      else resolve(message.text)
    })
    worker.once('error', () => { clearTimeout(timer); reject(new AssessmentError(422, 'Resume extraction failed')) })
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new AssessmentError(422, 'Resume extraction stopped')) })
  })
}
