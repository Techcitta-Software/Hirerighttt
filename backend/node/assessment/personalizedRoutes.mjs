import { createRepository, actorForEmail } from './repository.mjs'
import { createPersonalizedInterviews } from './personalized.mjs'
import { check } from './contracts.mjs'

export function createPersonalizedHandler({ databaseUrl, requireAuth, readBody, json, rateLimit, onResult }) {
  const repo = createRepository(databaseUrl)
  const service = createPersonalizedInterviews(repo)
  return async (req, res, url) => {
    const path = url.pathname
    const recovery = path.match(/^\/api\/interview\/session\/([0-9a-f-]{36})$/i)
    if (!(recovery && req.method === 'GET') && !(req.method === 'POST' && ['/api/interview/start', '/api/interview/next', '/api/interview/score', '/api/interview/turn'].includes(path))) return false
    const email = await requireAuth(req, res)
    if (!email) return true
    try {
      const body = recovery ? {} : await readBody(req)
      // Legacy adaptive start (vendor jobs, practice) — only personalized assessment when opted in.
      if (!recovery && path === '/api/interview/start') {
        const consentOk =
          body.consent === true &&
          typeof body.requestId === 'string' &&
          String(body.requestId).trim().length > 0
        if (!consentOk) {
          req.parsedBody = body
          return false
        }
      }
      // Keep old saved sessions readable by the legacy handlers without reading the body twice.
      if (!recovery && path !== '/api/interview/start' && !/^[0-9a-f-]{36}$/i.test(body.sessionId || '')) {
        req.parsedBody = body
        return false
      }
      check(rateLimit(`personalized:${email}`, 30), 'Too many interview requests. Please wait a minute.', 429)
      const actor = await actorForEmail(repo, email)
      if (recovery) json(res, 200, await service.get(actor, recovery[1]))
      else if (path.endsWith('/start')) json(res, 200, await service.start(actor, body))
      else if (path.endsWith('/next')) json(res, 200, await service.next(actor, body))
      else if (path.endsWith('/turn')) {
        await service.get(actor, body.sessionId)
        json(res, 200, { spoken: 'Thank you. Let’s continue.', source: 'quick_response' })
      } else {
        const { result, link, organizationId } = await service.score(actor, body)
        await onResult(email, result, link, organizationId)
        json(res, 200, { interview: result })
      }
    } catch (error) {
      const status = error.status || (['22P02', '23503', '23505'].includes(error.code) ? 400 : 500)
      json(res, status, { error: error.status ? error.message : 'Could not process the interview. Please retry.' })
    }
    return true
  }
}
