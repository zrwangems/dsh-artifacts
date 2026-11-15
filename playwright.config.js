import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:43189', headless: true, viewport: { width: 1440, height: 950 } },
  webServer: { command: 'node tests/browser-server.mjs', url: 'http://127.0.0.1:43189/dsh-artifacts/api/list?sessionId=session-1', reuseExistingServer: false },
})
