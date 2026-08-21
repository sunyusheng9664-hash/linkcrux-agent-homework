import { describe, expect, it } from 'vitest'

import config from './playwright.config'
import { assertProductionBuildMode } from './scripts/productionBuildGuard'

describe('Playwright acceptance server isolation', () => {
  it('always starts the current local demo server instead of reusing a process on the same port', () => {
    const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer

    expect(webServer).toMatchObject({
      command: 'npm run dev:e2e',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
    })
  })
})

describe('production build boundary', () => {
  it('rejects a production build configured to bundle the local Demo runtime', () => {
    expect(() => assertProductionBuildMode('build', 'mock')).toThrow('LOCAL_DEMO_BUILD_FORBIDDEN')
  })

  it('allows the normal CloudBase production build', () => {
    expect(() => assertProductionBuildMode('build', 'cloudbase')).not.toThrow()
  })

  it('allows mock only for the explicitly selected offline build mode', () => {
    expect(() => assertProductionBuildMode('build', 'mock', 'true', 'offline')).not.toThrow()
    expect(() => assertProductionBuildMode('build', 'mock', 'true', 'production')).toThrow('LOCAL_DEMO_BUILD_FORBIDDEN')
    expect(() => assertProductionBuildMode('build', 'mock')).toThrow('LOCAL_DEMO_BUILD_FORBIDDEN')
  })
})
