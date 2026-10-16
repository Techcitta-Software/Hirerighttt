import { check, text, strings, validatePlan, VERSION, BLUEPRINT } from './contracts.mjs'
import { PLAN_PROMPT } from './prompts.mjs'
import { structuredCall } from './provider.mjs'
import { createAssessmentService } from './service.mjs'
import { loadSession, sessionDetails, audit, usage } from './repository.mjs'

const LABELS = ['Project ownership', 'Role fundamentals', 'Practical application', 'Problem solving', 'Troubleshooting', 'Role specialization', 'Design and trade-offs']
function category(id) {
  return id === 'ownership' ? 'Experience' : ['problem_solving', 'troubleshooting', 'deeper_reasoning'].includes(id) ? 'Problem Solving' : 'Technical'
}
function questionView(q) {
  return q ? { id: q.question_id, text: q.question_text, category: category(q.competency), keywords: [], hint: '', topic: q.competency } : null
}

/** Adapter from the existing live-interview UI to the transactional assessment engine. */
export function createPersonalizedInterviews(repo, callAI = structuredCall) {
  const assessments = createAssessmentService(repo, callAI)
  async function owned(actor, id) {
    check(actor.role === 'jobseeker', 'Candidate account required', 403)
    const session = await loadSession(repo, id, actor, { candidateOnly: true })
    const { rows } = await repo.query('SELECT * FROM personalized_interview_links WHERE session_id=$1 AND candidate_id=$2', [id, actor.id])
    check(rows[0], 'Interview not found', 404)
    return { session, link: rows[0], ...await sessionDetails(repo, session) }
  }
  async function get(actor, id) {
    const { session, link, questions, job } = await owned(actor, id)
    const { answers } = await assessments.get(actor, id)
    const visible = questions.slice(0, Math.min(7, session.current_index + 1)).map(questionView)
    return { sessionId: id, role: job.title, level: job.experience_level, status: session.status, version: session.version,
      questionIndex: session.current_index, question: questionView(questions[session.current_index]), questions: visible,
      answers: questions.map(q => answers.find(a => a.question_id === q.question_id)?.answer_text).filter(a => a !== undefined),
      total: 7, adaptive: true, llm: true, agent: 'rubric-assessment', jobId: link.job_id, applicationId: link.application_id }
  }
  return {
    get,
    async start(actor, body) {
      check(actor.role === 'jobseeker', 'Candidate account required', 403)
      check(body.consent === true, 'Accept the interview instructions before starting')
      const requestId = text(body.requestId, 'start request ID', 100)
      const previous = await repo.query('SELECT session_id FROM personalized_interview_links WHERE candidate_id=$1 AND request_id=$2', [actor.id, requestId])
      if (previous.rows[0]) return get(actor, previous.rows[0].session_id)
      const stored = await repo.query('SELECT data FROM profiles WHERE user_id=$1 OR email=$2', [actor.id, actor.email])
      const profile = { ...(stored.rows[0]?.data || {}), ...(body.profile || {}) }
      const resumeText = text(profile.resumeText, 'resume text (upload your resume first)', 100000)
      const skills = strings(profile.skills, 'core skills', 80)
      check(skills.length > 0, 'Add at least one core skill before starting')
      let title = text(body.role || profile.currentRole, 'target role', 200)
      let level = text(body.level || profile.totalExperience || 'Not specified', 'experience level', 200)
      let organizationId = 'org-platform'
      let description = `Target role: ${title}. Candidate core skills: ${skills.join(', ')}.`
      let requiredSkills = skills
      let application = null
      let sourceJob = null
      if (body.jobId || body.applicationId) {
        const found = await repo.query(`SELECT a.*,j.title,j.role_track,j.experience_level,j.job_description,j.required_skills,j.status AS job_status
          FROM employer_applications a JOIN jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
          JOIN organizations o ON o.id=j.organization_id AND o.status='active'
          WHERE a.id=$1 AND a.candidate_user_id=$2 AND a.candidate_email=$3`, [body.applicationId || '', actor.id, actor.email])
        application = found.rows[0]
        check(application && ['active', 'published'].includes(application.job_status), 'Your active job application was not found', 404)
        check(!body.jobId || body.jobId === application.job_id, 'Job and application do not match', 409)
        sourceJob = application.job_id
        organizationId = application.organization_id
        title = application.role_track || application.title
        level = application.experience_level || level
        description = application.job_description
        requiredSkills = application.required_skills || []
      }
      const competencies = BLUEPRINT.map((id, i) => ({ id, name: LABELS[i], weight: i === 6 ? 10 : 15,
        requirement: `${LABELS[i]} for ${title}. Essential skills: ${requiredSkills.join(', ')}.`.slice(0, 2000) }))
      const job = { title, description, experience_level: level, required_skills: requiredSkills, competencies }
      const generated = await callAI({ system: PLAN_PROMPT + '\nCover the essential JD requirements across the plan. Use actual projects/work experience to personalize scenarios. Calibrate the depth using candidate experience; do not assume experience they do not have. Questions must be role-relevant, including nontechnical roles. Candidate core skills do not override employer requirements.',
        payload: { job, resume_text: resumeText, candidate: { core_skills: skills, experience: profile.totalExperience || '', work_experiences: profile.workExperiences || [], projects: profile.projects || [], achievements: profile.achievements || [] }, blueprint: BLUEPRINT },
        purpose: 'plan', validate: value => validatePlan(value, job, resumeText) })
      let id
      try {
        id = await repo.transaction(async db => {
          const snapshot = await db.query(`INSERT INTO assessment_jobs(organization_id,created_by,title,description,experience_level,competencies,personal_candidate_id)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$2) RETURNING id`, [organizationId, actor.id, title, description, level, JSON.stringify(competencies)])
          // Published job links and practice interviews use automatic validated plans.
          // Do not claim these have been manually approved by a recruiter.
          const plan = await db.query(`INSERT INTO interview_plans(organization_id,candidate_id,job_id,model,prompt_version,status)
            VALUES($1,$2,$3,$4,$5,'ready') RETURNING id`, [organizationId, actor.id, snapshot.rows[0].id, generated.model, VERSION])
          for (const q of generated.data.questions) await db.query('INSERT INTO interview_questions(plan_id,question_id,position,data) VALUES($1,$2,$3,$4::jsonb)', [plan.rows[0].id, q.question_id, q.position, JSON.stringify(q)])
          const session = await db.query(`INSERT INTO assessment_sessions(plan_id,organization_id,candidate_id,status,consent_at,started_at)
            VALUES($1,$2,$3,'in_progress',NOW(),NOW()) RETURNING id`, [plan.rows[0].id, organizationId, actor.id])
          const sessionId = session.rows[0].id
          await db.query('INSERT INTO personalized_interview_links(session_id,candidate_id,job_id,application_id,request_id) VALUES($1,$2,$3,$4,$5)', [sessionId, actor.id, sourceJob, application?.id || null, requestId])
          await usage(db, organizationId, 'personalized_plan', generated)
          await audit(db, actor, organizationId, sessionId, 'validated_plan_started', { approval_policy: 'automatic', job_id: sourceJob })
          return sessionId
        })
      } catch (error) {
        if (error.code !== '23505') throw error
        const retry = await repo.query('SELECT session_id FROM personalized_interview_links WHERE candidate_id=$1 AND request_id=$2', [actor.id, requestId])
        check(retry.rows[0], 'Could not create interview; retry', 409)
        id = retry.rows[0].session_id
      }
      return get(actor, id)
    },
    async next(actor, body) {
      const { session, questions } = await owned(actor, body.sessionId)
      const question = questions.find(q => q.question_id === body.lastQuestion?.id || q.question_text === body.lastQuestion?.text)
      check(question, 'Question does not belong to this interview', 409)
      const result = await assessments.message(actor, session.id, { message: body.lastAnswer, question_id: question.question_id,
        request_id: `${session.id}:${question.question_id}`, version: session.version })
      const current = await get(actor, session.id)
      return { ...current, question: { ...current.question, advanced: !result.source, response: result.response || '' }, evaluation_status: result.evaluation_status }
    },
    async score(actor, body) {
      let { session, link, questions } = await owned(actor, body.sessionId)
      check(Array.isArray(body.answers) && body.answers.length === 7, 'Complete all seven questions before requesting the final report', 422)
      const existing = await assessments.get(actor, session.id)
      for (let i = 0; i < 7; i++) {
        const answer = text(body.answers[i], 'answer', 20000)
        const saved = existing.answers.find(a => a.question_id === questions[i].question_id)
        if (saved) check(saved.answer_text === answer, 'A submitted answer cannot be replaced', 409)
        else {
          const result = await assessments.message(actor, session.id, { message: answer, question_id: questions[i].question_id,
            request_id: `${session.id}:${questions[i].question_id}`, version: session.version })
          check(!result.source, 'Please answer the question before finishing', 422)
          session = await loadSession(repo, session.id, actor, { candidateOnly: true })
        }
      }
      const latest = await assessments.get(actor, session.id)
      for (const answer of latest.answers) await assessments.evaluateAnswer(actor, session.id, answer.id)
      const report = await assessments.report(actor, session.id, { candidateAccess: true })
      check(report.overall !== null, 'Answers saved. AI evaluation is temporarily unavailable; retry the report shortly.', 503)
      const analyses = report.questions.map(q => {
        const answer = report.answers.find(a => a.question_id === q.question_id)
        const evaluation = report.evaluations.find(e => e.answer_id === answer.id)
        return { question: q.question_text, answer: answer.answer_text, score: evaluation.data.score * 25,
          wordCount: answer.answer_text.split(/\s+/).length, keywordsHit: [], feedback: evaluation.data.reasoning,
          evidence: evaluation.data.evidence, category: category(q.competency), strengths: evaluation.data.strengths,
          gaps: evaluation.data.gaps, improvements: evaluation.data.improvements || evaluation.data.gaps,
          model: evaluation.model, needsHumanReview: evaluation.data.needs_human_review }
      })
      const categories = [...new Set(analyses.map(a => a.category))].map(label => {
        const scores = analyses.filter(a => a.category === label)
        return { label, score: Math.round(scores.reduce((sum, a) => sum + a.score, 0) / scores.length) }
      })
      const result = { sessionId: session.id, role: report.job.title, level: report.job.experience_level, date: report.completed_at,
        overall: report.overall, categories, strengths: [...new Set(analyses.flatMap(a => a.strengths))].slice(0, 7),
        weaknesses: [...new Set(analyses.flatMap(a => a.gaps))].slice(0, 7), improvements: [...new Set(analyses.flatMap(a => a.improvements))].slice(0, 7),
        answers: analyses, agent: 'ai-rubric-assessment', needsHumanReview: report.needs_human_review, notice: report.notice,
        competencies: report.competencies, rubricVersion: VERSION }
      return { result, link, organizationId: session.organization_id }
    },
  }
}
