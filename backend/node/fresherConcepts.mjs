const PROGRAMMING_CONCEPTS = [
  'how function parameters and return values work',
  'how local and global variable scope differ',
  'how recursion works and why it needs a base case',
  'how loops and conditional statements control program flow',
  'how you would choose a collection for looking up values by key',
  'how exception handling separates normal flow from errors',
  'how modules help organize and reuse code',
  'how you would test a function with boundary inputs',
];
const OBJECT_CONCEPTS = [
  'how a class differs from an object',
  'how encapsulation protects the internal state of an object',
  'how inheritance and composition differ',
  'how polymorphism lets different objects share an interface',
  'how constructors initialize an object',
];
const SQL_CONCEPTS = [
  'how INNER JOIN differs from LEFT JOIN',
  'how WHERE differs from HAVING',
  'how GROUP BY works with aggregate functions',
  'how primary keys and foreign keys differ',
  'how NULL affects comparisons and COUNT',
  'how a subquery differs from a join',
  'why normalization helps prevent inconsistent data',
  'how indexes speed up reads and affect writes',
  'how COMMIT and ROLLBACK affect a transaction',
  'how UNION differs from UNION ALL',
  'how ORDER BY and limiting rows work together',
  'how unique and not-null constraints protect data quality',
];
const SKILL_CONCEPTS = [
  [/react/i, ['how props and state differ', 'why list items need keys', 'how a component handles a button click', 'how a component shares data with its parent']],
  [/html/i, ['why headings should follow a clear order', 'how a label helps someone fill in a form', 'how a link differs from a button', 'why images need alternative text']],
  [/css/i, ['how margin differs from padding', 'how flexbox arranges items', 'how a media query changes a page for small screens', 'how CSS decides which style to use']],
  [/excel/i, ['how a formula uses cell references', 'how sorting differs from filtering', 'how a pivot table summarizes data', 'how you would find duplicate values']],
  [/git/i, ['why a commit is useful', 'how a branch helps you try a change', 'how a merge conflict happens', 'how you would check what changed in a file']],
];
export function selectFresherConcept(skill, varietySeed = "", turn = 1, priorTexts = []) {
  const programming = /^(python|java|javascript|typescript|c\+\+|c#|c|go|golang|ruby|kotlin|swift|php|dart|rust|scala|r|a programming language you know)$/i.test(skill);
  const objects = /^(python|java|javascript|typescript|c\+\+|c#|ruby|kotlin|swift|php|dart|scala)$/i.test(skill);
  const concepts = /sql|postgres|mysql/i.test(skill) ? SQL_CONCEPTS
    : programming ? [...PROGRAMMING_CONCEPTS, ...(objects ? OBJECT_CONCEPTS : []),
      ...(/python/i.test(skill) ? ['how lists and tuples differ', 'how generators produce values lazily', 'how mutable default arguments behave', 'how a context manager closes a file reliably'] : [])]
    : SKILL_CONCEPTS.find(([pattern]) => pattern.test(skill))?.[1] || ['how its main components work together', 'how you would identify and fix a basic error', 'how you would test a simple result', 'how you would choose between two common approaches'];
  const unused = concepts.filter(concept => !priorTexts.some(text => text.toLowerCase().includes(concept.toLowerCase())));
  const pool = unused.length ? unused : concepts;
  let hash = 2166136261;
  const seed = varietySeed || String(Math.random());
  for (const char of seed + '|' + skill + '|' + turn) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return pool[(hash >>> 0) % pool.length];
}

// Choose only skills supported by the profile; the role never invents proficiency.
export function selectFresherSkills(skills = [], resumeText = '', roleSkills = [], varietySeed = '') {
  const canonical = value => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9+#]/g, '');
  const explicit = skills.map(s => String(s).trim()).filter(Boolean);
  const catalog = ['Python', 'JavaScript', 'TypeScript', 'Java', 'React', 'Node.js', 'HTML', 'CSS', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Excel', 'Statistics', 'Figma', 'Git', 'Linux', 'Docker', 'AWS', 'Kotlin', 'Swift', 'Flutter', 'C++', 'C#'];
  const evidence = explicit.length ? explicit : catalog.filter(skill => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + escaped + '(?=$|[^a-z0-9])', 'i').test(resumeText);
  });
  const seen = new Set();
  const known = evidence.filter(skill => {
    const key = canonical(skill);
    if (!key || seen.has(key) || /^(communication|teamwork|leadership|problem solving|time management)$/i.test(skill)) return false;
    seen.add(key);
    return true;
  });
  if (!known.length) return ['a skill you know', 'a skill you know'];
  const relevant = known.filter(skill => roleSkills.some(roleSkill => canonical(roleSkill) === canonical(skill) || roleSkill.split(/[&,/]/).some(part => canonical(part).replace(/^html5$/, 'html').replace(/^css3$/, 'css') === canonical(skill))));
  const pool = relevant.length >= 2 ? relevant : known;
  const hash = text => { let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return h >>> 0; };
  const ranked = [...pool].sort((a, b) => hash(varietySeed + '|skill|' + a) - hash(varietySeed + '|skill|' + b));
  return [ranked[0], ranked[1] || ranked[0]];
}
