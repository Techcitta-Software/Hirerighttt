import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createFromOptions = vi.fn()
vi.mock('@mediapipe/tasks-vision', () => ({
  FaceLandmarker: { createFromOptions: (...args: unknown[]) => createFromOptions(...args) },
  FilesetResolver: { forVisionTasks: vi.fn() },
}))

const { CDN_WASM_BASE, LOCAL_FACE_MODEL_URL, MEDIAPIPE_VERSION, createFaceLandmarker } = await import('./mediapipeAssets')

const fileset = { wasmLoaderPath: 'x.js', wasmBinaryPath: 'x.wasm' }

describe('mediapipeAssets', () => {
  beforeEach(() => {
    createFromOptions.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('pins the CDN runtime to the installed npm version', () => {
    const require = createRequire(import.meta.url)
    const pkgDir = dirname(require.resolve('@mediapipe/tasks-vision/vision_wasm_internal.js'))
    const pkg = JSON.parse(readFileSync(join(pkgDir, '..', 'package.json'), 'utf8'))
    expect(MEDIAPIPE_VERSION).toBe(pkg.version)
    expect(CDN_WASM_BASE).toContain(`@mediapipe/tasks-vision@${pkg.version}/wasm`)
  })

  it('ships the self-hosted face model under public/', () => {
    const file = join(process.cwd(), 'public', LOCAL_FACE_MODEL_URL.replace(/^\//, ''))
    expect(statSync(file).size).toBeGreaterThan(1_000_000)
  })

  it('tries CPU then GPU, then falls back to the self-hosted copy, and reports the source', async () => {
    const states: string[] = []
    createFromOptions
      .mockRejectedValueOnce(new Error('cdn cpu blocked'))
      .mockRejectedValueOnce(new Error('cdn gpu blocked'))
      .mockResolvedValueOnce({ id: 'local-landmarker' })
    const out = await createFaceLandmarker(
      { runningMode: 'VIDEO' },
      (s) => states.push(`${s.status}:${s.source ?? ''}:${s.delegate ?? ''}`),
      [
        { source: 'cdn', fileset: async () => fileset, modelUrl: 'https://cdn/model.task' },
        { source: 'local', fileset: async () => fileset, modelUrl: '/mediapipe/face_landmarker.task' },
      ],
    )
    expect(out?.source).toBe('local')
    expect(createFromOptions.mock.calls.map((c) => [c[1].baseOptions.modelAssetPath, c[1].baseOptions.delegate])).toEqual([
      ['https://cdn/model.task', 'CPU'],
      ['https://cdn/model.task', 'GPU'],
      ['/mediapipe/face_landmarker.task', 'CPU'],
    ])
    expect(states.at(-1)).toBe('ready:local:CPU')
  })

  it('returns null with the reason when every source fails (no crash)', async () => {
    const states: { status: string; error?: string }[] = []
    createFromOptions.mockRejectedValue(new Error('nope'))
    const out = await createFaceLandmarker({ runningMode: 'VIDEO' }, (s) => states.push(s), [
      { source: 'cdn', fileset: () => Promise.reject(new Error('offline')), modelUrl: 'a' },
      { source: 'local', fileset: async () => fileset, modelUrl: 'b' },
    ])
    expect(out).toBeNull()
    expect(states.at(-1)?.status).toBe('failed')
    expect(states.at(-1)?.error).toContain('offline')
  })
})
