import test from 'node:test'
import assert from 'node:assert/strict'

/** Mirrors frontend/src/lib/interviewFinish.ts for unit coverage. */
function collectInterviewPairs(questions, finalAnswers, history) {
  const qOut = []
  const aOut = []
  const seen = new Set()
  for (const turn of history) {
    const a = String(turn.answer || '').trim()
    const text = String(turn.question?.text || '').trim()
    if (!a || !text || seen.has(text)) continue
    seen.add(text)
    qOut.push(turn.question)
    aOut.push(a)
  }
  for (let i = 0; i < Math.max(questions.length, finalAnswers.length); i++) {
    const a = String(finalAnswers[i] || '').trim()
    const q = questions[i]
    const text = String(q?.text || '').trim()
    if (!a || !text || seen.has(text)) continue
    seen.add(text)
    qOut.push(q)
    aOut.push(a)
  }
  return { questions: qOut, answers: aOut }
}

test('collectInterviewPairs merges history and in-progress answers', () => {
  const q1 = { text: 'Q1 about React', category: 'Technical', keywords: [], hint: '' }
  const q2 = { text: 'Q2 about Node', category: 'Technical', keywords: [], hint: '' }
  const history = [{ question: q1, answer: 'I built APIs with Node for two years.' }]
  const pairs = collectInterviewPairs([q1, q2], ['', 'Draft on second question here.'], history)
  assert.equal(pairs.questions.length, 2)
  assert.equal(pairs.answers.length, 2)
  assert.match(pairs.answers[0], /Node/)
  assert.match(pairs.answers[1], /Draft/)
})
