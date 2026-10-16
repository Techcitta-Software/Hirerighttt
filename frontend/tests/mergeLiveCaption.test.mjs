import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendGroqDelta,
  mergeLiveCaption,
} from '../src/lib/mergeLiveCaption.ts'

test('mergeLiveCaption combines groq, browser, and partial text', () => {
  assert.equal(
    mergeLiveCaption('Hello world', 'testing now', ''),
    'Hello world testing now',
  )
  assert.equal(
    mergeLiveCaption('Hello', '', 'partial'),
    'Hello partial',
  )
})

test('appendGroqDelta extends text and replaces when incoming is superset', () => {
  assert.equal(appendGroqDelta('hello', 'hello there'), 'hello there')
  assert.equal(appendGroqDelta('hello world', 'again'), 'hello world again')
  assert.equal(appendGroqDelta('', 'first'), 'first')
})
