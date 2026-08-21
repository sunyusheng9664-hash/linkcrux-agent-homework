import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/offline.spec.ts',
  use: { browserName: 'chromium' },
})
