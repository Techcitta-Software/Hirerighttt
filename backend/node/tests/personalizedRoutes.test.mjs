import test from 'node:test'
import assert from 'node:assert/strict'
import { createPersonalizedHandler } from '../assessment/personalizedRoutes.mjs'

function mockRes() {
  return { statusCode: 0, payload: null }
}

test('POST /api/interview/start without consent passes through with parsed body', async () => {
  const handler = createPersonalizedHandler({
    databaseUrl: '',
    requireAuth: async () => 'candidate@test.com',
    readBody: async (req) => req.parsedBody ?? { role: 'X' },
    json: (res, status, data) => {
      res.statusCode = status
      res.payload = data
    },
    rateLimit: () => true,
    onResult: async () => {},
  })
  const req = { method: 'POST', parsedBody: undefined }
  const res = mockRes()
  const handled = await handler(req, res, new URL('http://localhost/api/interview/start'))
  assert.equal(handled, false)
  assert.deepEqual(req.parsedBody, { role: 'X' })
})

test('POST /api/interview/start with consent is handled by personalized router', async () => {
  const handler = createPersonalizedHandler({
    databaseUrl: '',
    requireAuth: async () => 'candidate@test.com',
    readBody: async () => ({ consent: true, requestId: 'req-1', role: 'Engineer', level: '1-3' }),
    json: (res, status, data) => {
      res.statusCode = status
      res.payload = data
    },
    rateLimit: () => true,
    onResult: async () => {},
  })
  const req = { method: 'POST' }
  const res = mockRes()
  const handled = await handler(req, res, new URL('http://localhost/api/interview/start'))
  assert.equal(handled, true)
})
