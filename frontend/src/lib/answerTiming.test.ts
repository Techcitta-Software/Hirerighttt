import { describe, expect, it } from 'vitest'
import {
  answerDoneCommand,
  isEndInterviewRequest,
  silenceAdvanceMs,
  stripAnswerDoneCommand,
} from './answerTiming'

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

describe('silence before moving on', () => {
  it('waits the full 5 s on a short answer (the candidate may still be thinking)', () => {
    expect(silenceAdvanceMs(words(8))).toBe(5000)
  })
  it('moves on sooner once the answer is substantial', () => {
    expect(silenceAdvanceMs(words(25))).toBe(3800)
    expect(silenceAdvanceMs(words(60))).toBe(2800)
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
