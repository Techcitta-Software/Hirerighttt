import { getSkillsForRole } from './roleSkillStore'
import { describe, it, expect } from 'vitest'
import {
  parseExperienceYears,
  buildStructuredTurnQuestion,
  analyzeOpeningAnswerAlignment,
  structuredPlanSummary,
  questionMatchesPlan,
  planRoleAlignedInterviewSkills,
  isScenarioStyleInterviewQuestion,
} from './interviewQuestionPlan'

describe('experience and neutral question policy', () => {
  it('parses months, mixed units, ranges and minimum years accurately', () => {
    for (const [input, years] of [['6 months', 0.5], ['1 year 6 months', 1.5], ['6-12 months', 0.75], ['3–5 years', 4], ['4+ years', 4], ['0.5 years', 0.5]] as const) {
      expect(parseExperienceYears(input)).toBe(years)
    }
  })
  it('keeps junior skill questions junior even when mentioned in the opening', () => {
    const roleSkills = ['PySpark', 'SQL', 'Python']
    const ctx = { skills: ['Python', 'SQL', 'PySpark'] }
    const openingAnalysis = analyzeOpeningAnswerAlignment('PySpark SQL Python', roleSkills)
    for (let seed = 0; seed < 20; seed++) {
      const q = buildStructuredTurnQuestion({
        turnNumber: 2,
        first: '',
        level: '6 months',
        profile: null,
        ctx,
        roleOverride: 'Data Engineer',
        roleSkills,
        openingAnalysis,
        varietySeed: String(seed),
      })
      expect(q?.keywords).toContain('junior')
      expect(q?.text.toLowerCase()).toMatch(/pyspark|spark|dataframe|lazy|null/)
    }
  })
  it('rejects proof demands in opening and skill questions', () => {
    const plan = structuredPlanSummary('Data Engineer', {}, null, '3 years')
    expect(questionMatchesPlan({ text: 'Prove your work experience and responsibilities.' }, plan, 1)).toBe(false)
    expect(questionMatchesPlan({ text: 'You have worked with SQL; explain it.' }, plan, 2)).toBe(false)
  })
})


describe('profile-based fresher topics', () => {
  it('asks about yourself, then coding language, SQL, another skill, then projects', () => {
    const ctx = { skills: ['React', 'JavaScript', 'HTML', 'CSS'] }
    const plan = structuredPlanSummary('Frontend Developer', ctx, null, 'Fresher')
    expect(plan.totalTurns).toBe(7)
    expect(plan.recommendedSkills[1]).toBe('SQL')
    expect(plan.recommendedSkills.some((s) => /react/i.test(s))).toBe(true)
    const intro = buildStructuredTurnQuestion({
      turnNumber: 1,
      first: '',
      level: 'Fresher',
      profile: null,
      ctx,
      roleOverride: 'Frontend Developer',
    })
    expect(intro?.text).toContain('Thanks for joining today — I am Ava')
    expect(intro?.text.toLowerCase()).toContain('about yourself')
    expect(questionMatchesPlan(intro!, plan, 1)).toBe(true)
    const language = buildStructuredTurnQuestion({
      turnNumber: 2,
      first: '',
      level: 'Fresher',
      profile: null,
      ctx,
      roleOverride: 'Frontend Developer',
    })
    expect(language?.topic).toMatch(/react|javascript|typescript/i)
    expect(questionMatchesPlan(language!, plan, 2)).toBe(true)
    const sql = buildStructuredTurnQuestion({
      turnNumber: 3,
      first: '',
      level: 'Fresher',
      profile: null,
      ctx,
      roleOverride: 'Frontend Developer',
    })
    expect(sql?.topic).toBe('SQL')
    expect(questionMatchesPlan(sql!, plan, 3)).toBe(true)
    const other = buildStructuredTurnQuestion({
      turnNumber: 4,
      first: '',
      level: 'Fresher',
      profile: null,
      ctx,
      roleOverride: 'Frontend Developer',
    })
    expect(other?.topic).toMatch(/react|typescript|javascript/i)
    expect(questionMatchesPlan(other!, plan, 4)).toBe(true)
    const thanks = buildStructuredTurnQuestion({
      turnNumber: 7,
      first: '',
      level: 'Fresher',
      profile: null,
      ctx,
      roleOverride: 'Frontend Developer',
    })
    expect(thanks?.text).toContain('Thank you for your time today')
    expect(questionMatchesPlan(thanks!, plan, 7)).toBe(true)
  })

  it('fresher project questions use resume projects in plain language', () => {
    const ctx = {
      skills: ['React', 'JavaScript'],
      resumeSnippet: 'Built a React task board for college — users add cards and filter by status.',
    }
    const profile = null
    const p1 = buildStructuredTurnQuestion({
      turnNumber: 5,
      first: '',
      level: 'Fresher',
      profile,
      ctx,
      roleOverride: 'Frontend Developer',
      varietySeed: 'seed-a',
    })
    expect(p1?.text.toLowerCase()).not.toContain('as a ')
    expect(p1?.text).toMatch(/react|task board|built/i)
    expect(p1?.text).toMatch(/build|tools|languages/i)
    const p2 = buildStructuredTurnQuestion({
      turnNumber: 6,
      first: '',
      level: 'Fresher',
      profile,
      ctx,
      roleOverride: 'Frontend Developer',
      varietySeed: 'seed-a',
      lastAnswer: 'I used React hooks and local state for the board.',
    })
    expect(p2?.text.toLowerCase()).not.toContain('delve')
    expect(p2?.text).toMatch(/same project|staying on|on that same project/i)
  })
})


describe('same résumé, different sessions', () => {
  it('varies AI Associate Engineer questions across varietySeed values', () => {
    const ctx = {
      skills: ['Python', 'Machine Learning', 'SQL', 'RAG', 'scikit-learn', 'FastAPI'],
      resumeSnippet:
        'Built a support-ticket classifier using Python, scikit-learn and SQL. Developed an internal-document RAG assistant with embeddings and FastAPI.',
    }
    const profile = {
      currentRole: 'AI Associate Engineer',
      totalExperience: '2 years',
      workExperiences: [
        {
          jobTitle: 'AI Associate Engineer',
          company: 'Example AI Labs',
          description: 'Classifier and RAG assistant work.',
        },
      ],
      projects: [
        { name: 'Support-ticket classifier', description: 'Python, scikit-learn, SQL, macro F1.' },
        { name: 'Internal-document RAG assistant', description: 'Embeddings, chunking, FastAPI.' },
      ],
    } as import('./store').SavedProfile
    const roleSkills = getSkillsForRole('AI Associate Engineer')
    const questionTexts = new Set<string>()
    const skillTopics = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const varietySeed = `associate-ai-${i}-7f3a`
      for (const turnNumber of [1, 2, 3, 4, 5] as const) {
        const q = buildStructuredTurnQuestion({
          turnNumber,
          first: 'Arjun',
          level: '2 years',
          profile,
          ctx,
          roleOverride: 'AI Associate Engineer',
          roleSkills,
          varietySeed,
        })
        expect(q?.text).toBeTruthy()
        questionTexts.add(q!.text)
        if (turnNumber >= 2 && turnNumber <= 4) skillTopics.add(q!.topic || '')
      }
    }
    expect(questionTexts.size).toBeGreaterThan(15)
    expect(skillTopics.size).toBeGreaterThan(3)
  })
})

describe('conceptual theory turns', () => {
  it('rejects scenario-style technical questions on theory slots', () => {
    expect(isScenarioStyleInterviewQuestion('Tell me about a time you used Python at work.')).toBe(true)
    const plan = structuredPlanSummary('AI Associate Engineer', { skills: ['Python'] }, { totalExperience: '2 years' } as import('./store').SavedProfile, '2 years', getSkillsForRole('AI Associate Engineer'))
    expect(
      questionMatchesPlan(
        { text: 'What would you do if production RAG retrieval returned empty chunks?', topic: 'RAG' },
        plan,
        2,
      ),
    ).toBe(false)
    const skill = plan.recommendedSkills[0]
    expect(
      questionMatchesPlan(
        {
          text: `How do embeddings differ from one-hot features in ${skill}?`,
          topic: skill,
        },
        plan,
        2,
      ),
    ).toBe(true)
  })
})

describe('Python Programming variety', () => {
  it('rotates Python theory prompts across varietySeed values', () => {
    const ctx = { skills: ['Python', 'FastAPI'] }
    const profile = {
      totalExperience: '1 year',
      currentRole: 'AI Associate Engineer',
    } as import('./store').SavedProfile
    const roleSkills = getSkillsForRole('AI Associate Engineer')
    const texts = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const varietySeed = `python-variety-${i}`
      for (const turnNumber of [2, 3, 4] as const) {
        const q = buildStructuredTurnQuestion({
          turnNumber,
          first: 'Bharath',
          level: '1 year',
          profile,
          ctx,
          roleOverride: 'AI Associate Engineer',
          roleSkills,
          varietySeed,
        })
        if (!/python/i.test(q?.topic || '')) continue
        texts.add(q!.text)
      }
    }
    expect(texts.size).toBeGreaterThan(4)
    const joined = [...texts].join(' ')
    expect(joined).toMatch(/mutable|lists and tuples|generators|context manager|dictionaries/i)
  })
})

describe('role-aligned skills and session variety', () => {
  it('maps Python on résumé to PySpark for Data Engineer and rotates skills by varietySeed', () => {
    const ctx = { skills: ['Python', 'SQL'], resumeSnippet: 'Python pipelines for batch jobs.' }
    const a = planRoleAlignedInterviewSkills('Data Engineer', ctx, 'session-a', null)
    const b = planRoleAlignedInterviewSkills('Data Engineer', ctx, 'session-b', null)
    expect(a.some((s) => /PySpark/i.test(s))).toBe(true)
    expect(a).toContain('SQL')
    const q2a = buildStructuredTurnQuestion({
      turnNumber: 2,
      first: '',
      level: '2 years',
      profile: null,
      ctx,
      roleOverride: 'Data Engineer',
      varietySeed: 'session-rotate-1111',
    })
    const q2b = buildStructuredTurnQuestion({
      turnNumber: 2,
      first: '',
      level: '2 years',
      profile: null,
      ctx,
      roleOverride: 'Data Engineer',
      varietySeed: 'session-rotate-9999',
    })
    expect(q2a?.topic).toMatch(/PySpark/i)
    expect(q2a?.text).not.toBe(q2b?.text)
    expect(q2a?.text.toLowerCase()).toMatch(/explain|how|what/)
    expect(q2a?.text.toLowerCase()).not.toMatch(/what you did/)
  })
})

describe('role catalog and project integration', () => {
  it('maps aliases to the catalog without matching vague roles', () => {
    expect(getSkillsForRole('Senior Data Engineer')).toEqual(['PySpark', 'SQL', 'Python']);
    expect(getSkillsForRole('Full Stack Engineer')).toEqual(getSkillsForRole('Full Stack Developer'));
    expect(getSkillsForRole('Engineer')).toEqual([]);
  });
  it('asks different project depths using real resume evidence and keeps the same anchor', () => {
    const ctx = {skills: ['PySpark'], resumeSnippet: 'Built a PySpark pipeline to load daily orders.'};
    const junior = buildStructuredTurnQuestion({turnNumber: 5, first: '', level: '6 months', profile: null, ctx, roleOverride: 'Data Engineer', varietySeed: 'one'});
    const senior = buildStructuredTurnQuestion({turnNumber: 5, first: '', level: '7 years', profile: null, ctx, roleOverride: 'Data Engineer', varietySeed: 'one'});
    const next = buildStructuredTurnQuestion({turnNumber: 6, first: '', level: '6 months', profile: null, ctx, roleOverride: 'Data Engineer', varietySeed: 'one'});
    expect(junior?.text.toLowerCase()).toMatch(/move data|validate row counts|pipeline/)
    expect(senior?.text.toLowerCase()).toMatch(/split and processed|schema drift|downstream/)
    expect(next?.resumeAnchor).toBe(junior?.resumeAnchor);
    expect(junior?.resumeAnchor).toContain('PySpark');
  });
});
