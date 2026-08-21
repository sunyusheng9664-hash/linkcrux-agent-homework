import { describe, expect, it } from 'vitest'

import { CaseRecordSchema, ContainmentExecutionRecordSchema, InitialPackSchema, ManagerDecisionSchema, RoutingSchema } from './case'

describe('risk and manager decision invariants', () => {
  it('rejects high-risk routing that attempts to disable human takeover', () => {
    expect(RoutingSchema.safeParse({ highRisk: true, requiresHuman: false }).success).toBe(false)
  })

  it('requires the manager outcome to be explicitly provided', () => {
    expect(ManagerDecisionSchema.safeParse({ severity: 'high', start8d: true, modificationReason: '人工判断' }).success).toBe(false)
  })
})

describe('CaseRecordSchema state invariants', () => {
  const base = {
    id: 'case-1', content: '客诉', attachments: [], createdBy: 'manager-1',
    createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z', version: 1,
  }
  const analysis = {
    facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
    slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [],
    routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const,
  }

  it('requires a positive server version on every record', () => {
    expect(CaseRecordSchema.safeParse({ ...base, status: 'intake', version: undefined }).success).toBe(false)
    expect(CaseRecordSchema.safeParse({ ...base, status: 'intake' }).success).toBe(true)
  })

  it('rejects analysis or decision fields that contradict the case status', () => {
    expect(CaseRecordSchema.safeParse({ ...base, status: 'analyzed' }).success).toBe(false)
    expect(CaseRecordSchema.safeParse({ ...base, status: 'analyzed', analysis }).success).toBe(false)
    expect(CaseRecordSchema.safeParse({
      ...base,
      status: 'intake',
      managerDecision: { outcome: 'accepted', severity: 'medium', start8d: false },
    }).success).toBe(false)
  })

  it('requires generation lease fields only while generating', () => {
    expect(CaseRecordSchema.safeParse({
      ...base,
      status: 'confirmed',
      initialPackStatus: 'generating',
    }).success).toBe(false)
    expect(CaseRecordSchema.safeParse({
      ...base,
      status: 'intake',
      initialPackGeneration: {
        generationId: 'gen-1', claimedAt: '2026-08-20T08:00:00.000Z', leaseUntil: '2026-08-20T08:05:00.000Z',
      },
    }).success).toBe(false)
    expect(CaseRecordSchema.safeParse({
      ...base,
      status: 'confirmed',
      analysis,
      analysisStatus: 'ai_completed',
      managerDecision: { outcome: 'accepted', severity: 'medium', start8d: false },
      initialPackStatus: 'generating',
      initialPackGeneration: {
        generationId: 'gen-1', claimedAt: '2026-08-20T08:05:00.000Z', leaseUntil: '2026-08-20T08:00:00.000Z',
      },
    }).success).toBe(false)
  })
})

describe('InitialPackSchema', () => {
  const initialPack = {
    customerReply: '已收到客诉，正在核查。',
    internalTicket: '请质量团队组织临时遏制。',
    d1: '质量经理牵头。',
    d2: '待确认批次和影响范围。',
    d3: {
      containmentActions: [
        {
          suggestedAction: '建议冻结同批库存',
          owner: '质量经理',
          dueAt: '2026-08-20T18:00:00+08:00',
        },
      ],
    },
    timeline24h14d30d: [
      { milestone: '24h', delivery: '首次响应与 D1–D3 更新' },
      { milestone: '14d', delivery: 'D4–D6 更新' },
      { milestone: '30d', delivery: 'D7–D8 闭环计划' },
    ],
    d4ToD8Plan: [
      { phase: 'D4', plan: '计划收集证据并验证可能原因' },
      { phase: 'D5', plan: '计划评估纠正措施' },
      { phase: 'D6', plan: '计划验证措施效果' },
      { phase: 'D7', plan: '计划预防复发' },
      { phase: 'D8', plan: '计划组织结案评审' },
    ],
  }

  it('defaults a suggested containment action to not executed and preserves empty evidence', () => {
    const result = InitialPackSchema.parse(initialPack)

    expect(result.d3.containmentActions[0]).toMatchObject({
      suggestedAction: '建议冻结同批库存',
      executionStatus: 'suggested',
      evidence: [],
    })
  })

  it('rejects unstructured D3 text that cannot distinguish suggestion from execution', () => {
    expect(InitialPackSchema.safeParse({ ...initialPack, d3: '建议冻结库存' }).success).toBe(false)
  })

  it('rejects an AI initial pack that labels a suggested action as executed', () => {
    expect(
      InitialPackSchema.safeParse({
        ...initialPack,
        d3: {
          containmentActions: [{ ...initialPack.d3.containmentActions[0], executionStatus: 'executed' }],
        },
      }).success,
    ).toBe(false)
  })

  it('rejects an execution record without evidence', () => {
    expect(
      ContainmentExecutionRecordSchema.safeParse({
        containmentActionId: 'action-1',
        confirmedBy: 'quality-manager-1',
        confirmedAt: '2026-08-20T18:00:00+08:00',
        evidence: [],
      }).success,
    ).toBe(false)
  })

  it('rejects a timeline that is missing or duplicates any required milestone', () => {
    expect(InitialPackSchema.safeParse({
      ...initialPack,
      timeline24h14d30d: [
        { milestone: '24h', delivery: '首次响应' },
        { milestone: '14d', delivery: '调查计划' },
        { milestone: '14d', delivery: '重复节点' },
      ],
    }).success).toBe(false)
  })

  it('rejects D4-D8 content represented as completed findings instead of plans', () => {
    expect(InitialPackSchema.safeParse({
      ...initialPack,
      d4ToD8Plan: [
        { phase: 'D4', plan: '计划验证原因' },
        { phase: 'D5', plan: '计划评估措施' },
        { phase: 'D6', plan: '已完成永久纠正' },
        { phase: 'D7', plan: '计划预防复发' },
        { phase: 'D8', plan: '计划组织评审' },
      ],
    }).success).toBe(false)
  })
})
