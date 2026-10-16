import { createRepository, actorForEmail } from './repository.mjs'
import { createAssessmentService } from './service.mjs'
import { check } from './contracts.mjs'
import { extractResume } from './resumes.mjs'

export function createAssessmentHandler({ databaseUrl, requireAuth, readBody, json, rateLimit }) {
  const repo = createRepository(databaseUrl)
  const service = createAssessmentService(repo)
  return async function handle(req, res, url) {
    const path = url.pathname
    if (!path.startsWith('/api/assessments/') && path !== '/api/assessments') return false
    try {
      const email = await requireAuth(req, res)
      if (!email) return true
      const actor = await actorForEmail(repo, email)
      check(rateLimit(`assessment:${actor.id}`, req.method === 'GET' ? 90 : 20), 'Too many assessment requests', 429)
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {}
      let result
      let status = 200
      if (path === '/api/assessments/jobs' && req.method === 'GET') {
        const orgId = url.searchParams.get('organization_id')
        if (orgId) result = await service.listJobs(actor, orgId)
        else result = await service.listOpenJobs(actor)
      } else if (path === '/api/assessments/jobs' && req.method === 'POST') { result = await service.createJob(actor, body); status = 201 }
      else if (path === '/api/assessments/resumes' && req.method === 'POST') {
        result = await service.saveResume(actor, body.filename, await extractResume(body)); status = 201
      } else if (path === '/api/assessments/resumes/text' && req.method === 'POST') {
        // Explicit correction/accessibility path; no fabricated extraction claims.
        result = await service.saveResume(actor, body.filename || 'candidate-corrected.txt', body.text); status = 201
      } else if (path === '/api/assessments/generate' && req.method === 'POST') { result = await service.generate(actor, body); status = 201 }
      else if (/^\/api\/assessments\/resumes\/[0-9a-f-]{36}\/analyze$/i.test(path) && req.method === 'POST') result = await service.analyzeResume(actor, path.split('/')[4])
      else if (/^\/api\/assessments\/resumes\/[0-9a-f-]{36}$/i.test(path) && req.method === 'DELETE') result = await service.deleteResume(actor, path.split('/')[4])
      else if (path === '/api/assessments' && req.method === 'GET') result = await service.list(actor, url.searchParams.get('organization_id'), Number(url.searchParams.get('limit') || 25), Number(url.searchParams.get('offset') || 0))
      else {
        const match = path.match(/^\/api\/assessments\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/i)
        check(match, 'Assessment endpoint not found', 404)
        const [, id, action] = match
        if (!action && req.method === 'GET') result = await service.get(actor, id)
        else if (action === 'plan' && req.method === 'GET') result = await service.plan(actor, id)
        else if (action === 'approve' && req.method === 'POST') result = await service.approve(actor, id, body)
        else if (['start', 'pause', 'cancel', 'complete'].includes(action) && req.method === 'POST') result = await service.transition(actor, id, action, body)
        else if (['messages', 'answers'].includes(action) && req.method === 'POST') result = await service.message(actor, id, body)
        else if (action === 'repeat-question' && req.method === 'POST') result = await service.message(actor, id, { message: 'repeat the question' })
        else if (action === 'skip-question' && req.method === 'POST') result = await service.message(actor, id, body, true)
        else if (action === 'retry-evaluation' && req.method === 'POST') result = await service.evaluateAnswer(actor, id, body.answer_id)
        else if (['report', 'export'].includes(action) && req.method === 'GET') result = await service.report(actor, id)
        else if (action === 'review' && req.method === 'POST') result = await service.review(actor, id, body)
        else check(false, 'Assessment endpoint not found', 404)
      }
      json(res, status, result)
    } catch (error) {
      const status = error.status || (['22P02', '23503', '23505', '23514'].includes(error.code) ? 400 : 500)
      json(res, status, { error: status === 500 ? 'Assessment operation failed' : error.status ? error.message : 'Invalid assessment data' })
    }
    return true
  }
}
