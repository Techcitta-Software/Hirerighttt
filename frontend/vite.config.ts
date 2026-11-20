import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import type { Plugin } from 'vite'

const gzip = promisify(zlib.gzip)
const brotli = promisify(zlib.brotliCompress)

/**
 * Writes `<file>.gz` and `<file>.br` next to every compressible build output (>= 1 KB) so the web server can
 * serve them as-is (nginx `gzip_static on;` / `brotli_static on;`, or S3 objects with Content-Encoding). This
 * matters most for the 25 MB onnxruntime WASM: CloudFront only compresses responses up to 10 MB, so without a
 * precompressed copy it ships uncompressed (~4 MB as .br, ~6 MB as .gz). Brotli runs at quality 11; set
 * PRECOMPRESS_FAST=1 to use quality 9 for files over 4 MB (saves ~90 s of build time on the WASM, ~15% larger).
 */
function precompress(): Plugin {
  const compressible = /\.(js|mjs|css|html|svg|json|wasm|txt|xml|map|webmanifest)$/i
  let outDir = 'dist'
  return {
    name: 'hirerighttt:precompress',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const files: string[] = []
      const walk = async (dir: string) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) await walk(full)
          else if (compressible.test(entry.name)) files.push(full)
        }
      }
      await walk(outDir)
      const fast = process.env.PRECOMPRESS_FAST === '1'
      await Promise.all(
        files.map(async (file) => {
          if ((await stat(file)).size < 1024) return
          const input = await readFile(file)
          const quality = fast && input.length > 4 * 1024 * 1024 ? 9 : 11
          const [gz, br] = await Promise.all([
            gzip(input, { level: 9 }),
            brotli(input, {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: input.length,
              },
            }),
          ])
          // Only keep a variant that actually saves bytes (already-compressed formats are skipped above).
          if (gz.length < input.length * 0.95) await writeFile(`${file}.gz`, gz)
          if (br.length < input.length * 0.95) await writeFile(`${file}.br`, br)
        }),
      )
    },
  }
}

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
  plugins: [react(), precompress()],
  build: {
    rolldownOptions: {
      output: {
        // React, react-dom and the router change far less often than app code: keep them in one long-lived
        // chunk so a deploy only invalidates the app chunks. All of it is already on every route's initial path.
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/,
            },
          ],
        },
      },
    },
  },
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
