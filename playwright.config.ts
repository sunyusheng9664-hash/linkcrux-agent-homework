import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/offline.spec.ts',
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
  },
})
