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
  message = 'Interview questions require the API server with GEMINI_API_KEY (Google Gemini).',
) {
  return new InterviewLlmError('LLM_QUESTION_REQUIRED', message)
}

export function interviewLlmGenerationFailedError(
  message = 'Gemini could not generate a valid question. Check GEMINI_API_KEY and try again.',
) {
  return new InterviewLlmError('LLM_QUESTION_FAILED', message)
}
