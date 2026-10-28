// Keep backend and frontend role matching identical. Never match a vague substring such as "engineer".
export function normalizeRoleKey(role) {
  return String(role ?? '').trim().toLowerCase().replace(/\([^)]*\)/g, '').replace(/\b(senior|junior|sr\.?|jr\.?|entry[ -]level)\s+/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}
const ROLE_ALIASES = {
  'software developer': 'Software Engineer', 'full stack engineer': 'Full Stack Developer',
  'fullstack developer': 'Full Stack Developer', 'fullstack engineer': 'Full Stack Developer',
  'front end developer': 'Frontend Developer', 'front end engineer': 'Frontend Developer', 'frontend engineer': 'Frontend Developer',
  'back end developer': 'Backend Developer', 'back end engineer': 'Backend Developer', 'backend engineer': 'Backend Developer',
  'sre': 'Site Reliability Engineer (SRE)', 'dba': 'Database Administrator (DBA)',
  'ml engineer': 'Machine Learning Engineer', 'nlp engineer': 'Natural Language Processing (NLP) Engineer',
  'bi developer': 'Business Intelligence (BI) Developer', 'qa tester': 'QA Engineer',
  'dotnet developer': 'C#/.NET Developer', '.net developer': 'C#/.NET Developer',
};
export function findRoleSkills(role, map) {
  const raw = String(role ?? '').trim();
  if (!raw) return [];
  if (Array.isArray(map[raw])) return map[raw].slice(0, 3);
  const key = normalizeRoleKey(raw);
  const alias = ROLE_ALIASES[key];
  if (alias && map[alias]) return map[alias].slice(0, 3);
  const exact = Object.keys(map).find(display => normalizeRoleKey(display) === key);
  if (exact) return map[exact].slice(0, 3);
  const match = Object.keys(map).sort((a, b) => b.length - a.length).find(display => {
    const candidate = normalizeRoleKey(display);
    return candidate.length > 5 && (' ' + key + ' ').includes(' ' + candidate + ' ');
  });
  return match ? map[match].slice(0, 3) : [];
}
