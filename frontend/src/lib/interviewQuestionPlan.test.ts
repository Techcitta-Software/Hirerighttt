import { getSkillsForRole } from './roleSkillStore'
import { describe, it, expect } from 'vitest'
import { parseExperienceYears, buildStructuredTurnQuestion, analyzeOpeningAnswerAlignment, structuredPlanSummary, questionMatchesPlan } from './interviewQuestionPlan'

describe('experience and neutral question policy', () => {
  it('parses months, mixed units, ranges and minimum years accurately', () => {
    for (const [input, years] of [['6 months', 0.5], ['1 year 6 months', 1.5], ['6-12 months', 0.75], ['3–5 years', 4], ['4+ years', 4], ['0.5 years', 0.5]] as const) {
      expect(parseExperienceYears(input)).toBe(years)
    }
  })
  it('keeps junior skill questions junior even when mentioned in the opening', () => {
    const roleSkills = ['PySpark', 'SQL', 'React.js']
    const openingAnalysis = analyzeOpeningAnswerAlignment('PySpark SQL React.js', roleSkills)
    for (let seed = 0; seed < 20; seed++) {
      const q = buildStructuredTurnQuestion({ turnNumber: 2, first: '', level: '6 months', profile: null, ctx: {}, roleSkills, openingAnalysis, varietySeed: String(seed) })
      expect(q?.keywords).toContain('junior')
      expect(q?.text).toContain('DataFrame')
    }
  })
  it('rejects proof demands in opening and skill questions', () => {
    const plan = structuredPlanSummary('Data Engineer', {}, null, '3 years')
    expect(questionMatchesPlan({ text: 'Prove your work experience and responsibilities.' }, plan, 1)).toBe(false)
    expect(questionMatchesPlan({ text: 'You have worked with SQL; explain it.' }, plan, 2)).toBe(false)
  })
})


describe('profile-based fresher topics', () => {
  it('varies known skills across sessions without forcing SQL', () => {
    const ctx = {skills: ['React', 'JavaScript', 'HTML', 'CSS']};
    const combinations = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const seed = 'session-' + i;
      const plan = structuredPlanSummary('Frontend Developer', ctx, null, 'Fresher', null, null, seed);
      combinations.add(plan.recommendedSkills.join('|'));
      expect(plan.recommendedSkills.every(s => getSkillsForRole('Frontend Developer').includes(s))).toBe(true);
      expect(new Set(plan.recommendedSkills).size).toBe(2);
      for (let turnNumber = 1; turnNumber <= 2; turnNumber++) {
        const q = buildStructuredTurnQuestion({turnNumber, first: '', level: 'Fresher', profile: null, ctx, roleOverride: 'Frontend Developer', varietySeed: seed});
        expect(q?.topic).toBe(plan.recommendedSkills[turnNumber - 1]);
        expect(questionMatchesPlan(q!, plan, turnNumber)).toBe(true);
      }
    }
    expect(combinations.size).toBeGreaterThan(3);
  });
  it('uses role fundamentals without inventing a personal work history', () => {
    expect(structuredPlanSummary('Sales Executive', {}, null, 'Fresher').recommendedSkills.every(skill => getSkillsForRole('Sales Executive').includes(skill))).toBe(true);
  });
});


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
    expect(junior?.text).toContain('move data');
    expect(senior?.text).toContain('split and processed');
    expect(next?.resumeAnchor).toBe(junior?.resumeAnchor);
    expect(junior?.resumeAnchor).toContain('PySpark');
  });
});
