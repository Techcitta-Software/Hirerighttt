/** Interview questions are Gemini-only — no static templates in the product path. */

export class InterviewLlmError extends Error {
  code: 'LLM_QUESTION_REQUIRED' | 'LLM_QUESTION_FAILED'
  status: number

  constructor(code: InterviewLlmError['code'], message: string, status = 503) {
    super(message)
    this.name = 'InterviewLlmError'
    this.code = code
    this.status = status
  }
}

export function interviewLlmRequiredError(
  message = 'We couldn’t start your interview right now — please try again in a minute.',
) {
  return new InterviewLlmError('LLM_QUESTION_REQUIRED', message)
}

export function interviewLlmGenerationFailedError(
  message = 'We couldn’t prepare the next question right now — please try again in a minute.',
) {
  return new InterviewLlmError('LLM_QUESTION_FAILED', message)
}
