import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const clientKey =
    env.VITE_EXPERIENTIALLABS_API_KEY ||
    env.VITE_GEMINI_API_KEY ||
    env.VITE_OPENAI_API_KEY ||
    ''
  const googleKey = clientKey.startsWith('AIza') || clientKey.startsWith('AQ.')
  const experientialBase =
    !googleKey && env.VITE_EXPERIENTIALLABS_BASE_URL?.replace(/\/$/, '')
  const aiProxyTarget = googleKey
    ? 'https://generativelanguage.googleapis.com'
    : experientialBase
      ? experientialBase.replace(/\/v1$/, '')
      : 'https://generativelanguage.googleapis.com'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/ai-proxy': {
          target: aiProxyTarget,
          changeOrigin: true,
          rewrite: (path) =>
            googleKey || !experientialBase
              ? path.replace(/^\/ai-proxy/, '/v1beta/openai')
              : path.replace(/^\/ai-proxy/, '/v1'),
          secure: false,
        },
      },
    },
  }
})
