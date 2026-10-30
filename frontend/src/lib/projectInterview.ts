// Question depth changes with experience; project facts always come from supplied evidence.

function shortProjectName(label: string): string {
  const t = String(label || '').trim()
  if (!t) return ''
  if (t.length <= 72) return t
  return `${t.slice(0, 69).trim()}…`
}

function projectKind(evidence: string): 'pipeline' | 'api' | 'ui' | 'ml' | 'general' {
  if (/pipeline|etl|spark|airflow|warehouse/i.test(evidence)) return 'pipeline'
  if (/api|endpoint|authentication|backend|rest/i.test(evidence)) return 'api'
  if (/react|frontend|front.end|interface|web page|html|css/i.test(evidence)) return 'ui'
  if (/model|machine learning|prediction|classifier|tensorflow|pytorch/i.test(evidence)) return 'ml'
  return 'general'
}

/** Fresher project turns: simple words, one idea, tied to résumé text when we have it. */
export function fresherProjectTechnicalQuestion(
  label: string,
  summary: string,
  slot: 1 | 2,
  seed = '',
  lastAnswer = '',
): string {
  const name = shortProjectName(label)
  const evidence = `${summary} ${slot === 2 ? lastAnswer : ''}`.toLowerCase()
  const kind = projectKind(evidence)
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0

  if (slot === 1) {
    const withName = [
      `I see ${name} on your background. What part did you build yourself, and which tools or languages did you use?`,
      `Tell me about ${name} — what was your piece, and how did you build it?`,
      `On ${name}, what did you actually implement, and what stack did you use?`,
    ]
    if (name) return withName[hash % withName.length]
    return 'Pick one college or personal project. What was your part, and what did you use to build it?'
  }

  const followByKind: Record<typeof kind, string[]> = {
    ui: [
      'when a button or form did not behave the way you expected, how did you track down the cause?',
      'how did you check that the screen showed the right data after you changed something?',
    ],
    api: [
      'when a request failed or returned the wrong data, how did you debug it?',
      'how did you test an endpoint before you considered that part done?',
    ],
    pipeline: [
      'when data looked wrong in your pipeline step, how did you find where it broke?',
      'how did you test your part with messy or missing input?',
    ],
    ml: [
      'how did you check that your model or script worked on data it had not seen in training?',
      'what did you do when predictions or outputs looked off?',
    ],
    general: [
      'when something in that project failed, how did you figure out what went wrong?',
      'how did you test your part before you said it was finished?',
      'what was the trickiest bug or mistake you hit, and how did you fix it?',
    ],
  }
  const pool = followByKind[kind]
  const follow = pool[hash % pool.length]
  if (name) {
    const stems = [
      `Staying on ${name} — ${follow}`,
      `Same project (${name}): ${follow}`,
    ]
    return stems[hash % stems.length]
  }
  return `On that same project, ${follow}`
}

export function projectTechnicalQuestion(
  label: string,
  summary: string,
  role: string,
  years: number,
  slot: number,
  seed = '',
  lastAnswer = '',
) {
  if (years === 0) {
    return fresherProjectTechnicalQuestion(label, summary, slot === 2 ? 2 : 1, seed, lastAnswer)
  }

  const evidence = summary + ' ' + (slot === 2 ? lastAnswer : '')
  const kind = projectKind(evidence)
  const junior = years < 2
  const senior = years >= 5
  const scope = label ? 'the project “' + label.slice(0, 95) + '”' : 'a project from your background'
  const implementation = {
    pipeline: junior
      ? 'how did you move data through the part you built'
      : senior
        ? 'why did you choose the way data is split and processed'
        : 'how did you handle data that arrived late or in the wrong format',
    api: junior
      ? 'how did you handle a request and send back a response'
      : senior
        ? 'how did you decide where to check access to data'
        : 'how did you handle failed requests without losing data',
    ui: junior
      ? 'how did you connect a user action to a screen update'
      : senior
        ? 'how did you decide which parts of the interface should share state'
        : 'how did you keep the screen in sync with data from the server',
    ml: junior
      ? 'how did you prepare the data for the model'
      : senior
        ? 'how did you decide whether the model was ready to use'
        : 'how did you keep training data separate from test data',
    general: junior
      ? 'how did you build or carry out the part you worked on'
      : senior
        ? 'why did you choose your approach over another option'
        : 'how did you handle a difficult part of the implementation',
  }
  const followUps = junior
    ? [
        kind === 'pipeline'
          ? 'how did you test the pipeline with missing or repeated data'
          : kind === 'api'
            ? 'how did you test the API with an invalid request'
            : kind === 'ui'
              ? 'how did you test that a user action updated the correct part of the screen'
              : kind === 'ml'
                ? 'how did you test the model with data it had not seen before'
                : 'how did you test your part with an input that might cause an error',
        'how did you find the cause when your part did not work as expected',
      ]
    : senior
      ? [
          'what design change would make the project more reliable, and why',
          'how would you check whether your main design choice still works at a much larger scale',
        ]
      : [
          'how did you find the cause of a failure in your part',
          'how did you test that your change worked without breaking another part',
        ]
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const question = slot === 1 ? implementation[kind] : followUps[hash % followUps.length]
  return slot === 1
    ? 'As a ' + role + ', for ' + scope + ', ' + question + '?'
    : 'Going deeper into ' + scope + ', ' + question + '?'
}
