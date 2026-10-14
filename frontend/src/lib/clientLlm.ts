/**
 * Browser-side LLM calls are disabled in production builds unless explicitly allowed.
 * Production must use the Node API (/api/*) with server-only API keys.
 */
export function clientLlmAllowed(): boolean {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_ALLOW_CLIENT_LLM === 'true'
  }
  return Boolean(
    import.meta.env.VITE_EXPERIENTIALLABS_API_KEY?.trim() ||
      import.meta.env.VITE_GEMINI_API_KEY?.trim() ||
      import.meta.env.VITE_OPENAI_API_KEY?.trim(),
  )
}

