import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const devPort = Number(process.env.VITE_DEV_PORT || 5173)

export default defineConfig(({ command }) => {
  // The shared repo-root .env sets NODE_ENV=development for the backend. Vite would apply it to
  // `vite build` too and bundle React's development runtime (jsx-dev-runtime, StrictMode double
  // effects). Builds must always use the production runtime.
  // Vite copies NODE_ENV from .env into VITE_USER_NODE_ENV (only when it is unset) and switches the build
  // to development when it says so; pinning it here keeps `vite build` on the production runtime.
  if (command === 'build') {
    process.env.NODE_ENV = 'production'
    process.env.VITE_USER_NODE_ENV = 'production'
  }
  return {
  envDir: repoRoot,
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  server: {
    port: devPort,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        // Override to point a second dev server at another API (e.g. a throwaway test database).
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/ai-proxy': {
        target: 'https://generativelanguage.googleapis.com/v1beta/openai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai-proxy/, ''),
        secure: false,
      },
    },
  },
}
})
