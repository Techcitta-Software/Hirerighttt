import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSkillsForRole } from '../roleSkillStore.mjs';
import { structuredPlanSummary, buildStructuredTurnQuestion, extractResumeProjects, experienceTierFromYears, selectProjectForInterview } from '../interviewQuestionPlan.mjs';
import { generateVendorJobQuestion } from '../prompts/vendorJobInterview.mjs';
const catalog = JSON.parse(readFileSync(new URL('../data/roleSkills.json', import.meta.url), 'utf8'));
test('both catalogs contain the same 100 roles with exactly three distinct skills', () => {
  const browser = JSON.parse(readFileSync(new URL('../../../frontend/src/data/roleSkills.json', import.meta.url), 'utf8'));
  assert.deepEqual(catalog, browser);
  assert.equal(Object.keys(catalog).length, 100);
  for (const [role, skills] of Object.entries(catalog)) {
    assert.equal(skills.length, 3, role);
    assert.equal(new Set(skills.map(s => s.toLowerCase())).size, 3, role);
    assert.ok(skills.every(s => typeof s === 'string' && s.trim()), role);
    assert.deepEqual(getSkillsForRole(role), skills);
    for (const level of ['Fresher', '6 months', '3 years', '7 years']) {
      const plan = structuredPlanSummary(role, {}, {currentRole: role, totalExperience: level}, level);
      assert.deepEqual(plan.topRoleSkills, skills);
      assert.ok(plan.recommendedSkills.every(s => skills.includes(s)), role);
    }
  }
});
test('role lookup handles seniority and aliases without accepting vague partial titles', () => {
  for (const [alias, canonical] of [['Senior Data Engineer', 'Data Engineer'], ['Junior Frontend Engineer', 'Frontend Developer'], ['Full Stack Engineer', 'Full Stack Developer'], ['SRE', 'Site Reliability Engineer (SRE)'], ['DBA', 'Database Administrator (DBA)']]) {
    assert.deepEqual(getSkillsForRole(alias), catalog[canonical]);
  }
  for (const vague of ['Engineer', 'Data', 'Developer', 'Unlisted Specialist']) assert.deepEqual(getSkillsForRole(vague), []);
});
const profile = {currentRole: 'Data Engineer', totalExperience: '6 months', projects: [{name: 'Orders pipeline', description: 'Built a PySpark pipeline to load daily orders.', technologies: ['PySpark', 'SQL']}, {name: 'Website', description: 'Built a React page.'}]};
const ctx = {skills: ['PySpark', 'SQL'], achievements: ['Won a chess tournament']};
test('explicit projects are used without inventing employers or converting unrelated awards into projects', () => {
  const projects = extractResumeProjects(profile, ctx, profile.currentRole);
  assert.ok(projects.some(p => p.label === 'Orders pipeline'));
  assert.ok(projects.every(p => p.employer === ''));
  assert.ok(projects.every(p => !p.label.includes('chess')));
  assert.deepEqual(extractResumeProjects(null, {skills: ['SQL']}), []);
});
test('project implementation and follow-up remain grounded and change depth with experience', () => {
  const seed = 'project-check';
  const selected = selectProjectForInterview(profile, ctx, profile.currentRole, seed);
  assert.equal(selected.label, 'Orders pipeline');
  for (const [level, difficulty, expected] of [['6 months', 'junior', /move data/], ['3 years', 'mid', /arrived late/], ['7 years', 'senior', /split and processed/]]) {
    const p = {...profile, totalExperience: level};
    const plan = structuredPlanSummary(p.currentRole, ctx, p, level);
    assert.equal(plan.difficulty, difficulty);
    const first = buildStructuredTurnQuestion({turnNumber: 5, first: '', level, profile: p, ctx, varietySeed: seed});
    const second = buildStructuredTurnQuestion({turnNumber: 6, first: '', level, profile: p, ctx, varietySeed: seed, lastAnswer: 'I tested invalid order records.'});
    assert.match(first.text, expected);
    assert.equal(first.resumeAnchor, selected.label);
    assert.equal(second.resumeAnchor, first.resumeAnchor);
    assert.notEqual(first.text, second.text);
    assert.ok(!/your most recent role|Company|stakeholders|end to end/.test(first.text));
  }
  assert.equal(experienceTierFromYears(0.5, 'Senior'), 'junior');
});
test('vendor AI receives numerical difficulty, top role skills and selected project evidence', async () => {
  let called = 0;
  await generateVendorJobQuestion({profile, ctx, level: 'Senior', varietySeed: 'project-check', history: Array.from({length:4}, (_,i)=>({question:{text:'Earlier '+i}})), lastAnswer:'I built the loader.'}, {callLlm: async ({user,system}) => {
    called++;
    const payload = JSON.parse(user);
    assert.equal(payload.experienceYears, 0.5);
    assert.equal(payload.difficulty, 'junior');
    assert.deepEqual(payload.topRoleSkills, catalog['Data Engineer']);
    assert.equal(payload.selectedProject.label, 'Orders pipeline');
    assert.match(system, /simple words/);
    return null;
  }});
  assert.ok(called > 0);
});

test('fresher skill slots remain stable when opening-answer metadata is supplied', () => {
  const seed = 'stable-session';
  const skills = catalog['Software Engineer'];
  const original = structuredPlanSummary('Software Engineer', {}, null, 'Fresher', skills, null, seed);
  const next = structuredPlanSummary('Software Engineer', {}, null, 'Fresher', skills, {matched: ['SQL'], orderedSkills: ['SQL', 'Git', 'JavaScript'], skillsFromJsonFallback: false}, seed);
  assert.deepEqual(next.recommendedSkills, original.recommendedSkills);
  assert.equal(next.recommendedSkills.length, 2);
});
