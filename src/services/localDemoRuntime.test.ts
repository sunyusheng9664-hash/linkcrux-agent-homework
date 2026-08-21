import { beforeEach, describe, expect, it } from 'vitest'

import { MAIN_COMPLAINT } from '../../tests/fixtures/main-complaint'
import { createLocalDemoServices } from './localDemoRuntime'

describe('local demo runtime', () => {
  beforeEach(() => window.localStorage.clear())

  it('authenticates only the documented local demo account without calling CloudBase', async () => {
    const { auth } = createLocalDemoServices()

    await expect(auth.signIn('linghe', 'wrong-password')).rejects.toThrow('LOCAL_DEMO_LOGIN_FAILED')
    expect(await auth.isSignedIn()).toBe(false)

    await auth.signIn('linghe', 'shuzhi')
    expect(await auth.isSignedIn()).toBe(true)
    expect(await auth.getCurrentUserId()).toBe('local-demo-linghe')
  })

  it('rejects arbitrary free text and deterministically completes the preset manager-decision journey', async () => {
    const { api } = createLocalDemoServices()

    await expect(api.createCase({ content: '任意客诉', attachments: [] })).rejects.toThrow('LOCAL_DEMO_PRESET_ONLY')

    const created = await api.createCase({ content: MAIN_COMPLAINT.content, attachments: [] })
    const analyzed = await api.analyzeCase(created.id)
    expect(analyzed.analysis).toMatchObject({
      facts: MAIN_COMPLAINT.expectedFacts,
      routing: { highRisk: true, requiresHuman: true },
      analysisStatus: 'ai_completed',
    })

    const confirmed = await api.confirmCase({
      id: created.id,
      outcome: 'modified',
      severity: 'critical',
      start8d: true,
      modificationReason: '客户产线停线，需升级处置',
    })
    expect(confirmed.managerDecision?.outcome).toBe('modified')

    const generated = await api.generateInitialPack(created.id)
    expect(generated.initialPack).toMatchObject({
      timeline24h14d30d: [
        { milestone: '24h' },
        { milestone: '14d' },
        { milestone: '30d' },
      ],
      d4ToD8Plan: [
        { phase: 'D4' },
        { phase: 'D5' },
        { phase: 'D6' },
        { phase: 'D7' },
        { phase: 'D8' },
      ],
    })
  })

  it('rejects an accepted decision that changes the Agent baseline', async () => {
    const { api } = createLocalDemoServices()
    const created = await api.createCase({ content: MAIN_COMPLAINT.content, attachments: [] })
    await api.analyzeCase(created.id)

    await expect(api.confirmCase({
      id: created.id,
      outcome: 'accepted',
      severity: 'critical',
      start8d: true,
    })).rejects.toThrow('MANAGER_DECISION_MISMATCH')
    await expect(api.confirmCase({
      id: created.id,
      outcome: 'accepted',
      severity: 'high',
      start8d: false,
    })).rejects.toThrow('MANAGER_DECISION_MISMATCH')
  })

  it('renders the manager severity in the simulated internal ticket instead of assuming a fixed decision', async () => {
    const { api } = createLocalDemoServices()
    const created = await api.createCase({ content: MAIN_COMPLAINT.content, attachments: [] })
    await api.analyzeCase(created.id)
    await api.confirmCase({
      id: created.id,
      outcome: 'modified',
      severity: 'low',
      start8d: true,
      modificationReason: '仅用于验证 Demo 判断映射',
    })

    const generated = await api.generateInitialPack(created.id)
    expect(generated.initialPack?.internalTicket).toContain('严重度调整为低')
    expect(generated.initialPack?.internalTicket).not.toContain('严重度调整为严重')
  })
})
