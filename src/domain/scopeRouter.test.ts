import { describe, expect, it } from 'vitest'

import { routeComplaintScope } from './scopeRouter'

describe('routeComplaintScope', () => {
  it('routes non-complaint requests away from the quality complaint workflow', () => {
    expect(routeComplaintScope({ content: '请给我最新报价和合同模板' })).toMatchObject({ decision: 'handoff', reason: 'OUT_OF_SCOPE', suggestedTeam: '销售、合同或客户服务团队' })
  })

  it('upgrades safety and recall risks before asking for missing fields', () => {
    expect(routeComplaintScope({ content: '客户反馈人员受伤，要求立即召回', facts: {} })).toMatchObject({ decision: 'urgent_handoff', reason: 'HIGH_RISK' })
  })

  it('asks only for the minimum missing complaint facts before ordinary handling', () => {
    expect(routeComplaintScope({ content: '客户反馈产品异常', facts: { product: 'BR-2045' } })).toMatchObject({ decision: 'ask', reason: 'INFORMATION_INSUFFICIENT', missingFields: expect.arrayContaining(['batch', 'defect']) })
  })
})
