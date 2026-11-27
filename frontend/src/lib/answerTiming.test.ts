import { describe, expect, it } from 'vitest'
import {
  answerClockRunning,
  answerDoneCommand,
  decideAnswerTick,
  isClosingQuestionAt,
  isEndInterviewRequest,
  silenceAdvanceMs,
  stripAnswerDoneCommand,
  stripEchoOfQuestion,
} from './answerTiming'

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

describe('silence before moving on (scales with the answer)', () => {
  it('waits 4.5 s under 25 words (the candidate may still be thinking)', () => {
    expect(silenceAdvanceMs(words(8))).toBe(4500)
    expect(silenceAdvanceMs(words(24))).toBe(4500)
  })
  it('3 s for 25 through 60 words, 2 s after that', () => {
    expect(silenceAdvanceMs(words(25))).toBe(3000)
    expect(silenceAdvanceMs(words(60))).toBe(3000)
    expect(silenceAdvanceMs(words(61))).toBe(2000)
  })
})

describe('"next question" command', () => {
  it('detects it at the end and keeps the real answer', () => {
    expect(answerDoneCommand('I used Redis for caching the sessions. Next question.')).toBe(
      'I used Redis for caching the sessions.',
    )
    expect(answerDoneCommand("We shipped it in two sprints, that's my answer")).toBe('We shipped it in two sprints')
    expect(answerDoneCommand("let's move on")).toBe('')
  })
  it('ignores the words in the middle of an answer', () => {
    expect(answerDoneCommand('The next question we asked the client was about scale and cost')).toBeNull()
    expect(answerDoneCommand('I built the API')).toBeNull()
  })
  it('strips the command from what is saved', () => {
    expect(stripAnswerDoneCommand('Kafka for events. Next question')).toBe('Kafka for events.')
    expect(stripAnswerDoneCommand('Kafka for events.')).toBe('Kafka for events.')
  })
})

describe('echo of Ava’s question', () => {
  const question = 'Can you walk me through how you would design a rate limiter for a public API?'

  it('drops a leading fragment that is only the tail of her question', () => {
    expect(
      stripEchoOfQuestion('design a rate limiter for a public API I would use a token bucket', question),
    ).toBe('I would use a token bucket')
  })

  it('drops a final that is only her question, and leaves a real answer alone', () => {
    expect(stripEchoOfQuestion('how you would design a rate limiter for a public API', question)).toBe('')
    expect(stripEchoOfQuestion('I would use a token bucket and Redis', question)).toBe(
      'I would use a token bucket and Redis',
    )
  })
})

describe('closing question at the live index', () => {
  it('treats a closing question appended at the current index as a closing statement', () => {
    const stale = [{ focus: 'structured-theory-2' }]
    const current = 0
    const live = stale.slice()
    live.splice(current, 0, { focus: 'structured-closing' })
    expect(isClosingQuestionAt(stale, current)).toBe(false)
    expect(isClosingQuestionAt(live, current)).toBe(true)
    expect(
      answerClockRunning({
        answerWindowStartedAt: 5_000,
        aiSpeaking: false,
        closing: isClosingQuestionAt(live, current),
      }),
    ).toBe(false)
    // The same silence would nudge a normal question. The tick must not do that for the closing line.
    expect(
      decideAnswerTick({
        now: 25_000,
        transcript: '',
        sttPhase: 'idle',
        lastSpeechAt: 0,
        answerWindowStartedAt: 5_000,
        nudged: false,
      }),
    ).toBe('nudge')
  })
})

describe('ending the whole interview', () => {
  it('accepts explicit requests and a bare "I am done"', () => {
    expect(isEndInterviewRequest('Please end the interview')).toBe(true)
    expect(isEndInterviewRequest('okay that is all')).toBe(true)
    expect(isEndInterviewRequest("I'm done.")).toBe(true)
  })
  it('does not end the interview because an answer contains "that\'s all" or "I\'m done"', () => {
    expect(isEndInterviewRequest("I wrote the migration and that's all I handled there, the rest was the team")).toBe(false)
    expect(isEndInterviewRequest("Once I'm done with testing I deploy through the pipeline to staging")).toBe(false)
  })
})
