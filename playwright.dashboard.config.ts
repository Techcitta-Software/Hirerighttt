import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './e2e', testMatch: 'candidate-dashboard.spec.ts', workers: 1, timeout: 60000, expect: { timeout: 10000 }, use: { baseURL: 'http://127.0.0.1:5174', channel: 'msedge' } })
