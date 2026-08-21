import { describe, expect, it } from 'vitest'

import { routeComplaint } from '../src/services/complaintRouter'

describe('routeComplaint', () => {
  it('uses the fixed order of scope, high-risk, missing information, then system query', () => {
    expect(routeComplaint({ content: '请给我报价', facts: { product: 'BR-2045', batch: 'A1', defect: '尺寸超差' } })).toMatchObject({ decision: 'handoff', reason: 'OUT_OF_SCOPE' })
    expect(routeComplaint({ content: '客户人员受伤', facts: {} })).toMatchObject({ decision: 'urgent_handoff', reason: 'HIGH_RISK' })
    expect(routeComplaint({ content: '客户反馈异常', facts: { product: 'BR-2045' } })).toMatchObject({ decision: 'ask', reason: 'INFORMATION_INSUFFICIENT' })
    expect(routeComplaint({ content: '请查询 ERP 订单状态', facts: { product: 'BR-2045', batch: 'A1', defect: '尺寸超差' } })).toMatchObject({ decision: 'handoff', reason: 'SYSTEM_QUERY_REQUIRED' })
  })
})
