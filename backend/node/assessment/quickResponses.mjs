const PHRASES = {
  greeting: ['hi', 'hello', 'hey', 'hlo'],
  repeat_question: ['repeat', 'repeat question', 'repeat the question', 'can you repeat the question', 'please repeat the question'],
  clarification: ["i don't understand", 'i do not understand', 'please clarify', 'can you clarify the question'],
  apology: ["i'm sorry", 'i am sorry', 'sorry'],
  hint: ['hint', 'can you give me a hint', 'please give me a hint'],
  skip: ['skip', 'skip question', 'skip this question', 'can i skip this question'],
  help: ['help', 'what should i do'],
  thanks: ['thanks', 'thank you'],
  complete: ['finish interview', 'end the interview', 'complete interview'],
  cancel: ['exit', 'quit', 'cancel interview'],
}
export const RESPONSES = {
  greeting: "Hi! Welcome to HireRight. Answer the current question when you're ready.",
  clarification: 'Describe how you would approach the situation in the current question. You may explain which part is unclear; asking for clarification does not affect your score.',
  apology: "No worries. Take your time and answer when you're ready.",
  hint: 'You can describe your approach, explain your reasoning, and discuss how you would check the result. This general guidance does not reveal expected answers.',
  help: 'Answer in your own words. You can request repetition, pause, or report a transcription problem.',
  thanks: "You're welcome. Continue when you're ready.",
  skip: 'Please confirm skipping this question using the skip-question action.',
  complete: 'Please confirm completion using the complete action. Unanswered questions will remain unassessed.',
  cancel: 'Please confirm cancellation using the cancel action.',
}
export function detectIntent(message) {
  const normalized = String(message).normalize('NFKC').toLowerCase().replace(/[’]/g, "'").replace(/[?!.,]+$/g, '').trim().replace(/\s+/g, ' ')
  return Object.entries(PHRASES).find(([, phrases]) => phrases.includes(normalized))?.[0] || null
}
export function quickResponse(message, question) {
  const intent = detectIntent(message)
  if (!intent) return null
  return { intent, source: 'quick_response', used_llm: false, response: intent === 'repeat_question' ? `Of course! Here is the question again: ${question?.question_text || 'No active question.'}` : RESPONSES[intent], confirmation_required: ['skip', 'complete', 'cancel'].includes(intent) }
}
