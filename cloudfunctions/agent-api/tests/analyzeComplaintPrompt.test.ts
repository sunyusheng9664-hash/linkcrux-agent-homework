import { describe, expect, it } from 'vitest'

import { buildAnalyzeComplaintMessages } from '../src/prompts/analyzeComplaint'

describe('buildAnalyzeComplaintMessages', () => {
  it('向模型提供完整且可执行的分析 JSON 合同', () => {
    const [system] = buildAnalyzeComplaintMessages({
      content: '客户反馈工业传感器外壳有划痕。',
      facts: { product: '工业传感器外壳' },
      attachments: [],
    })

    expect(system.content).toContain('"facts"')
    expect(system.content).toContain('"customer"')
    expect(system.content).toContain('"missingFields"')
    expect(system.content).toContain('"riskSuggestion"')
    expect(system.content).toContain('SAFETY | COMPLIANCE | LINE_STOPPAGE | BATCH_FAILURE')
    expect(system.content).toContain('"routing":{"highRisk":false,"requiresHuman":false}')
    expect(system.content).toContain('highRisk 为 true 时 requiresHuman 必须为 true')
  })
})
