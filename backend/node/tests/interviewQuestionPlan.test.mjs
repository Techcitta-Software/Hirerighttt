import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStructuredTurnQuestion,
  structuredPlanSummary,
  recommendTopSkillsForRole,
  isPlanFresher,
  parseExperienceYears,
  questionMatchesPlan,
  MAX_ROLE_SKILLS,
  EXPERIENCED_INTERVIEW_TURN_COUNT,
  analyzeOpeningAnswerAlignment,
  extractResumeProjects,
} from '../interviewQuestionPlan.mjs'
import { generateAdaptiveQuestionLocal } from '../interviewAgent.mjs'
import { generateVendorJobQuestion } from '../prompts/vendorJobInterview.mjs'
import { getSkillsForRole } from '../roleSkillStore.mjs'

const experienced = {
  currentRole: 'Frontend Developer',
  totalExperience: '6 years',
  skills: ['Communication', 'React', 'TypeScript'],
  workExperiences: [{ jobTitle: 'Senior frontend engineer with platform responsibilities', company: 'Example Company' }],
  certifications: [{ name: 'Web Accessibility' }],
}
const fresh = { currentRole: 'Software Engineer', totalExperience: 'Fresher', skills: ['Communication', 'Python', 'React'], workExperiences: [] }
const ctxFor = (p) => ({
  name: 'Sam',
  role: p.currentRole,
  skills: p.skills,
  jobs: p.workExperiences.map((w) => `${w.jobTitle} at ${w.company}`),
  certs: p.certifications?.map((c) => c.name) || [],
  achievements: [],
  resumeSnippet: '',
})

test('experienced flow: opening, three skills, two projects, fallback, closing', () => {
  const ctx = ctxFor(experienced)
  const roleSkills = getSkillsForRole(experienced.currentRole)
  let plan = structuredPlanSummary(experienced.currentRole, ctx, experienced, '6 years', roleSkills)
  assert.equal(plan.totalTurns, EXPERIENCED_INTERVIEW_TURN_COUNT)
  const history = []
  const questions = []
  const varietySeed = 'test-seed-1'
  for (let turnNumber = 1; turnNumber <= plan.totalTurns; turnNumber++) {
    const openingAnalysis =
      history[0]?.answer ? analyzeOpeningAnswerAlignment(history[0].answer, roleSkills, ctx) : null
    if (openingAnalysis) plan = structuredPlanSummary(experienced.currentRole, ctx, experienced, '6 years', roleSkills, openingAnalysis)
    const args = {
      turnNumber,
      first: 'Sam',
      level: '6 years',
      profile: experienced,
      ctx,
      history,
      planSummary: plan,
      roleSkills,
      varietySeed,
      openingAnalysis,
      lastAnswer: history[history.length - 1]?.answer || '',
    }
    const q = buildStructuredTurnQuestion(args)
    assert.equal(questionMatchesPlan(q, plan, turnNumber), true)
    questions.push(q)
    history.push({
      question: q,
      answer:
        turnNumber === 1
          ? 'I worked with React and TypeScript building UI platforms at Example Company with clear ownership.'
          : 'A detailed response about the question.',
    })
  }
  assert.equal(questions[0].focus, 'structured-opening-generic')
  assert.equal(questions[0].scoringProfile, 'opening_generic')
  assert.equal(questions.filter((q) => q.focus?.startsWith('structured-theory')).length, MAX_ROLE_SKILLS)
  assert.equal(questions[EXPERIENCED_INTERVIEW_TURN_COUNT - 1].focus, 'structured-closing')
  assert.match(questions[0].text, /responsibilit|experience|exposure/i)
})

test('project questions anchor to résumé bullets and target role', () => {
  const profile = {
    currentRole: 'Data Engineer',
    totalExperience: '4 years',
    skills: ['PySpark', 'Airflow', 'SQL'],
    workExperiences: [
      {
        jobTitle: 'Data Engineer',
        company: 'Acme Data',
        description:
          'Built a PySpark ETL pipeline migrating 2TB daily from legacy Oracle to Snowflake with Airflow orchestration.',
      },
    ],
  }
  const ctx = ctxFor(profile)
  const projects = extractResumeProjects(profile, ctx, 'Data Engineer')
  assert.ok(projects.length >= 1)
  assert.match(projects[0].label, /PySpark|ETL|pipeline/i)
  const plan = structuredPlanSummary(profile.currentRole, ctx, profile, profile.totalExperience, getSkillsForRole('Data Engineer'))
  const q = buildStructuredTurnQuestion({
    turnNumber: 2 + MAX_ROLE_SKILLS,
    first: 'Alex',
    level: profile.totalExperience,
    profile,
    ctx,
    planSummary: plan,
    roleSkills: getSkillsForRole('Data Engineer'),
    varietySeed: 'proj-resume-test',
  })
  assert.equal(q.focus, 'structured-recent-project-1')
  assert.match(q.text, /Data Engineer/i)
  assert.match(q.text, /PySpark|ETL|pipeline|Acme/i)
})

test('data engineer skill questions use PySpark and experience-calibrated prompts', () => {
  const de = {
    currentRole: 'Data Engineer',
    totalExperience: '3 – 5 Years',
    skills: ['PySpark', 'Airflow', 'SQL'],
    workExperiences: [{ jobTitle: 'Data Engineer', company: 'Acme Data' }],
  }
  const ctx = ctxFor(de)
  const skills = recommendTopSkillsForRole(de.currentRole, ctx, getSkillsForRole('Data Engineer'))
  assert.ok(skills.some((s) => /pyspark/i.test(s)))
  const plan = structuredPlanSummary(de.currentRole, ctx, de, de.totalExperience, skills)
  const q = buildStructuredTurnQuestion({
    turnNumber: 2,
    first: 'Alex',
    level: de.totalExperience,
    profile: de,
    ctx,
    planSummary: plan,
    roleSkills: skills,
    varietySeed: 'de-test',
  })
  assert.match(q.text, /Data Engineer/i)
  assert.match(q.text, /PySpark/i)
  assert.match(q.text, /DataFrame|Spark|shuffle|transformation/i)
})

test('when opening mentions no role skills, technical questions use JSON skills only', () => {
  const roleSkills = getSkillsForRole('Data Engineer')
  const analysis = analyzeOpeningAnswerAlignment(
    'I managed stakeholders and delivered pipelines on time with my team.',
    roleSkills,
    { skills: ['Communication', 'Leadership'] },
  )
  assert.equal(analysis.skillsFromJsonFallback, true)
  assert.deepEqual(analysis.orderedSkills, roleSkills)
  const plan = structuredPlanSummary('Data Engineer', {}, { currentRole: 'Data Engineer', totalExperience: '4 years' }, '4 years', roleSkills, analysis)
  assert.deepEqual(plan.recommendedSkills, roleSkills)
})

test('opening analysis reorders matched skills first', () => {
  const roleSkills = getSkillsForRole('Frontend Developer')
  const analysis = analyzeOpeningAnswerAlignment('I used React.js daily and TypeScript for components.', roleSkills, {})
  assert.ok(analysis.matched.some((s) => /react/i.test(s)))
  assert.equal(analysis.orderedSkills[0].toLowerCase().includes('react'), true)
})

test('freshers sample role skills without assuming past employment', () => {
  const ctx = ctxFor(fresh)
  const questions = Array.from({ length: 6 }, (_, i) =>
    buildStructuredTurnQuestion({ turnNumber: i + 1, first: 'Sam', level: '0–1 years', profile: fresh, ctx }),
  )
  assert.ok(questions.slice(0, 2).every(q => getSkillsForRole(fresh.currentRole).includes(q.topic)))
  assert.deepEqual(questions.slice(2, 4).map((q) => q.focus), ['structured-project-3', 'structured-project-4'])
  assert.match(questions[4].text, /improve/)
  assert.ok(questions.every((q) => !/your employer|your work as|responsibilities did you own/i.test(q.text)))
})

test('role skills ignore unrelated profile keywords; months do not become senior years', () => {
  assert.deepEqual(
    recommendTopSkillsForRole('Frontend Developer', { skills: ['Cooking', 'Communication'], resumeSnippet: 'Cooking and communication' }, getSkillsForRole('Frontend Developer')).slice(0, 2),
    ['React.js', 'TypeScript'],
  )
  const plan = structuredPlanSummary('Frontend Developer', ctxFor(experienced), experienced, '6 months', getSkillsForRole('Frontend Developer'))
  const q = buildStructuredTurnQuestion({
    turnNumber: 2,
    first: '',
    level: '6 months',
    profile: { ...experienced, totalExperience: '6 months' },
    ctx: ctxFor(experienced),
    planSummary: plan,
    roleSkills: getSkillsForRole('Frontend Developer'),
  })
  assert.match(q.text, /React|TypeScript/i)
  assert.equal(isPlanFresher({ totalExperience: '4 years' }, {}, '4 years'), false)
  assert.equal(isPlanFresher({ totalExperience: '0' }, {}, ''), true)
})

test('missing profile skills still allow neutral role fundamentals in six slots', () => {
  const plan = structuredPlanSummary('Software Engineer', {}, null, 'Fresher')
  assert.ok(plan.recommendedSkills.every(skill => getSkillsForRole('Software Engineer').includes(skill)))
  assert.equal(plan.turnPlan.length, 6)
  assert.equal(plan.turnPlan[5].startsWith('Q6'), true)
})

test('adaptive local fallback stays in every planned slot even for a long employer title', () => {
  const ctx = ctxFor(experienced)
  const roleSkills = getSkillsForRole(experienced.currentRole)
  let plan = structuredPlanSummary(experienced.currentRole, ctx, experienced, '6 years', roleSkills)
  const history = []
  for (let turn = 1; turn <= plan.totalTurns; turn++) {
    const openingAnalysis = history[0]?.answer ? analyzeOpeningAnswerAlignment(history[0].answer, roleSkills, ctx) : null
    if (openingAnalysis) plan = structuredPlanSummary(experienced.currentRole, ctx, experienced, '6 years', roleSkills, openingAnalysis)
    const q = generateAdaptiveQuestionLocal({
      profile: experienced,
      role: experienced.currentRole,
      level: '6 years',
      history,
      lastAnswer: history[history.length - 1]?.answer || '',
      roleSkills,
      planSummary: plan,
      totalTurns: plan.totalTurns,
      varietySeed: 'local-fallback',
      openingAnalysis,
    })
    assert.equal(questionMatchesPlan(q, plan, turn), true)
    history.push({
      question: q,
      answer: turn === 1 ? 'React and TypeScript at Example Company with platform work.' : 'A complete answer.',
    })
  }
})

test('vendor model retries résumé-based theory and falls back to the correct concept', async () => {
  let calls = 0
  const history = [1, 2].map((n) => ({ question: { text: `Earlier work question ${n}` }, answer: 'Work answer' }))
  const q = await generateVendorJobQuestion(
    { profile: experienced, ctx: ctxFor(experienced), role: experienced.currentRole, level: '6 years', history },
    {
      callLlm: async ({ user }) => {
        calls++
        const payload = JSON.parse(user)
        assert.equal(payload.candidateSummary, undefined)
        return { text: JSON.stringify({ question: { text: 'In your project, explain how you used React.js to build the interface.', topic: 'React.js' } }) }
      },
    },
  )
  assert.equal(calls, 2)
  assert.match(q.focus || '', /structured-theory/)
  assert.match(q.text, /React|JavaScript|TypeScript/i)
})


test('skill mentions and random seeds never promote candidates above their experience tier', () => {
  for (const [experience, tier] of [['6 months', 'junior'], ['1 year', 'junior'], ['3 years', 'mid'], ['6 years', 'senior']]) {
    const profile = { ...experienced, totalExperience: experience }
    const ctx = ctxFor(profile)
    const roleSkills = ['PySpark', 'SQL', 'React.js']
    const openingAnalysis = analyzeOpeningAnswerAlignment('PySpark SQL React.js', roleSkills)
    for (let seed = 0; seed < 20; seed++) {
      const q = buildStructuredTurnQuestion({ turnNumber: 2, first: '', level: 'Senior', profile, ctx, roleSkills, openingAnalysis, varietySeed: String(seed) })
      assert.equal(q.keywords.at(-1), tier)
      if (tier === 'junior') assert.match(q.text, /DataFrame/)
      if (tier === 'mid') assert.match(q.text, /transformation/)
      if (tier === 'senior') assert.match(q.text, /skew/)
      assert.doesNotMatch(q.text, /junior-level|mid-level|senior-level/)
    }
  }
})

test('all slots reject proof demands and resume-claim lead-ins', () => {
  const plan = structuredPlanSummary(experienced.currentRole, ctxFor(experienced), experienced)
  for (let turn = 1; turn <= plan.totalTurns; turn++) {
    for (const text of ['Prove your experience with React.js.', 'You said you used React.js; explain your role.', 'You have worked with SQL; explain a project.', 'Give evidence that you worked on this project.']) {
      assert.equal(questionMatchesPlan({ text }, plan, turn), false)
    }
  }
  assert.equal(questionMatchesPlan({ text: 'How does SQL LEFT JOIN work?' }, { ...plan, recommendedSkills: ['SQL'] }, 2), true)
})

test('vendor rejects proof-seeking work questions and returns a neutral fallback', async () => {
  let calls = 0
  const q = await generateVendorJobQuestion({ profile: experienced, ctx: ctxFor(experienced), role: experienced.currentRole, level: '6 years', history: [] }, {
    callLlm: async ({ system }) => {
      calls++
      assert.match(system, /simple, everyday words/)
      return { text: JSON.stringify({ question: { text: 'Prove your experience and responsibilities at Example Company.' } }) }
    },
  })
  assert.equal(calls, 2)
  assert.match(q.text, /main responsibilities/)
  assert.doesNotMatch(q.text, /prove|proof/i)
})


test('experience parsing respects units and does not inflate minimum years', () => {
  for (const [value, years] of [['6 months', 0.5], ['1 year 6 months', 1.5], ['6-12 months', 0.75], ['3–5 years', 4], ['4+ years', 4], ['0.5 years', 0.5]]) {
    assert.equal(parseExperienceYears(value), years)
  }
})

test('fresher skills vary by session and remain grounded in the profile', () => {
  const ctx = { skills: ['Python', 'JavaScript', 'Git', 'SQL'] };
  const combinations = new Set();
  let withoutSql = false;
  for (let i = 0; i < 40; i++) {
    const seed = 'session-' + i;
    const plan = structuredPlanSummary('Software Engineer', ctx, null, 'Fresher', null, null, seed);
    combinations.add(plan.recommendedSkills.join('|'));
    assert.equal(new Set(plan.recommendedSkills).size, 2);
    assert.ok(plan.recommendedSkills.every(skill => ctx.skills.includes(skill)));
    withoutSql ||= !plan.recommendedSkills.includes('SQL');
    for (let turnNumber = 1; turnNumber <= 2; turnNumber++) {
      const q = buildStructuredTurnQuestion({turnNumber, first: '', level: 'Fresher', profile: null, ctx, roleOverride: 'Software Engineer', varietySeed: seed});
      assert.equal(q.topic, plan.recommendedSkills[turnNumber - 1]);
      assert.equal(questionMatchesPlan(q, plan, turnNumber), true);
    }
  }
  assert.ok(combinations.size > 3);
  assert.ok(withoutSql);
});
test('resume-only and non-programming freshers do not inherit SQL', () => {
  const resumePlan = structuredPlanSummary('Frontend Developer', {resumeSnippet: 'Built a React project using HTML and CSS.'}, null, 'Fresher');
  assert.ok(resumePlan.recommendedSkills.every(s => getSkillsForRole('Frontend Developer').includes(s)));
  const salesPlan = structuredPlanSummary('Sales Executive', {skills: ['Customer discovery', 'Negotiation']}, null, 'Fresher');
  assert.ok(salesPlan.recommendedSkills.every(skill => getSkillsForRole('Sales Executive').includes(skill)));
});
test('freshers with one listed skill still receive distinct neutral role questions', () => {
  const ctx = {skills: ['Python']};
  const first = buildStructuredTurnQuestion({turnNumber: 1, first: '', level: 'Fresher', profile: null, ctx, varietySeed: 'single'});
  const second = buildStructuredTurnQuestion({turnNumber: 2, first: '', level: 'Fresher', profile: null, ctx, varietySeed: 'single', history: [{question: first}]});
  assert.ok(getSkillsForRole('Software Engineer').includes(first.topic));
  assert.ok(getSkillsForRole('Software Engineer').includes(second.topic));
  assert.notEqual(first.text, second.text);
});
test('vendor fresher prompt and fallback use the same profile-supported skills', async () => {
  const profile = {currentRole: 'Frontend Developer', totalExperience: 'Fresher', skills: ['React', 'HTML', 'CSS']};
  const ctx = {skills: profile.skills};
  const plan = structuredPlanSummary(profile.currentRole, ctx, profile, 'Fresher', null, null, 'vendor-seed');
  const q = await generateVendorJobQuestion({profile, ctx, level: 'Fresher', varietySeed: 'vendor-seed', history: [{question: {text: 'An earlier question'}}]}, {callLlm: async ({system, user}) => {
    assert.ok(!system.includes('skill two is SQL'));
    assert.equal(JSON.parse(user).slotExample.topic, plan.recommendedSkills[1]);
    return null;
  }});
  assert.equal(q.topic, plan.recommendedSkills[1]);
  assert.ok(!/sql/i.test(q.text));
});

test('single-skill local fallback stays technical after duplicate normalization', () => {
  const input = {profile: {currentRole: 'Software Engineer', totalExperience: 'Fresher', skills: ['Python']}, level: 'Fresher', varietySeed: 'one', history: []};
  const first = generateAdaptiveQuestionLocal(input);
  const second = generateAdaptiveQuestionLocal({...input, history: [{question: first, answer: 'An answer.'}]});
  assert.ok(getSkillsForRole('Software Engineer').includes(second.topic));
  assert.equal(second.focus, 'structured-theory-2');
  assert.notEqual(first.text, second.text);
});
