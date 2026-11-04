/** Interview question generation requires Google Gemini — no static question bank. */

export function createInterviewLlmError(code, message, status = 503) {
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

export function interviewLlmRequiredError(
  message = 'Interview questions require GEMINI_API_KEY (Google Gemini) on the API server.',
) {
  return createInterviewLlmError('LLM_QUESTION_REQUIRED', message)
}

export function interviewLlmGenerationFailedError(
  message = 'Gemini could not produce a valid interview question. Please try again.',
) {
  return createInterviewLlmError('LLM_QUESTION_FAILED', message)
}

export function isInterviewLlmError(err) {
  return Boolean(err && (err.code === 'LLM_QUESTION_REQUIRED' || err.code === 'LLM_QUESTION_FAILED'))
}
