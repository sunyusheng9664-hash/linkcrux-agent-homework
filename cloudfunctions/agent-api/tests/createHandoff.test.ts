import { describe, expect, it } from 'vitest'

import { createHandoff } from '../src/actions/createHandoff'
import { CaseRepository, InMemoryCaseAdapter } from '../src/repositories/caseRepository'

describe('createHandoff', () => {
  it('creates a traceable packet and records a case event instead of only returning a transfer message', async () => {
    const adapter = new InMemoryCaseAdapter()
    const repository = new CaseRepository(adapter)
    const caseRecord = await repository.create('quality-manager-1', {
      content: '客户反馈 BR-2045 批次 A2408 尺寸超差，产线停线',
      facts: { product: 'BR-2045', batch: 'A2408', defect: '尺寸超差', impact: '客户产线停线' },
    })

    const packet = await createHandoff({ repository }, caseRecord.id, 'quality-manager-1', {
      reason: 'HIGH_RISK', searchedKnowledge: ['knowledge-1'], suggestedTeam: '质量与生产应急响应',
    })

    expect(packet).toMatchObject({
      caseId: caseRecord.id, reason: 'HIGH_RISK', suggestedTeam: '质量与生产应急响应',
      confirmedFacts: { product: 'BR-2045', batch: 'A2408' }, searchedKnowledge: ['knowledge-1'],
      transitionReply: expect.stringContaining('已转交'),
    })
    await expect(adapter.eventsFor(caseRecord.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'case.handoff', actorId: 'quality-manager-1', data: expect.objectContaining({ reason: 'HIGH_RISK' }) }),
    ]))
  })
})
