import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routes', 'apiDispatch.mjs')
let text = fs.readFileSync(file, 'utf8')

const strips = [
  /    if \(await assessmentHandler\(req, res, url\)\) return\n    if \(await personalizedHandler\(req, res, url\)\) return\n/,
  /    if \(req\.method === 'GET' && path === '\/api\/health'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'GET' && path === '\/api\/plans'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'GET' && path === '\/api\/mail\/status'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'GET' && path === '\/api\/organization'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'GET' && path === '\/api\/llm-status'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'POST' && path === '\/api\/signup'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'POST' && path === '\/api\/login'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'POST' && path === '\/api\/logout'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'GET' && path === '\/api\/me'\) \{[\s\S]*?    \}\n\n/,
  /    if \(req\.method === 'PUT' && path === '\/api\/profile'\) \{[\s\S]*?    \}\n\n/,
]

for (const re of strips) {
  text = text.replace(re, '')
}

text = text.replace(
  /    assessmentHandler,\n    personalizedHandler,\n/,
  '',
)
text = text.replace(/    isProdLike,\n/, '')
text = text.replace(
  /export function createApiDispatchMiddleware\(ctx\) \{\n  const \{\n    config,\n/,
  'export function createApiDispatchMiddleware(ctx) {\n  const {\n    config,\n    isProdLike,\n',
)

fs.writeFileSync(file, text)
console.log('stripped apiDispatch')
