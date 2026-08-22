import { describe, expect, it, vi } from 'vitest'

import type { InitialPack, CaseAnalysis } from '../../../src/contracts/case'
import { CaseRepository, InMemoryCaseAdapter } from '../src/repositories/caseRepository'
import { InMemoryKnowledgeAdapter, KnowledgeRepository } from '../src/repositories/knowledgeRepository'
import { InMemoryModelUsageAdapter, ModelUsageRepository } from '../src/repositories/modelUsageRepository'
import { createRouter } from '../src/router'
import { createAttachmentVerifier } from '../src/services/attachmentVerifier'

const pack: InitialPack = {
  customerReply: '已收到投诉。', internalTicket: '工单。', d1: '计划。', d2: '描述。',
  d3: { containmentActions: [{ suggestedAction: '隔离库存', owner: '质量经理', dueAt: '24 小时内', executionStatus: 'suggested', evidence: [] }] },
  timeline24h14d30d: [{ milestone: '24h', delivery: '首响' }, { milestone: '14d', delivery: '调查' }, { milestone: '30d', delivery: '闭环' }],
  d4ToD8Plan: [{ phase: 'D4', plan: '计划' }, { phase: 'D5', plan: '计划' }, { phase: 'D6', plan: '计划' }, { phase: 'D7', plan: '计划' }, { phase: 'D8', plan: '计划' }],
}

const analysis: CaseAnalysis = {
  facts: { customer: '华东精工', product: 'BR-2045', batch: 'A240819', defect: '尺寸超差', impact: '停线 4 小时' },
  missingFields: [], informationCompleteness: 100,
  riskSuggestion: [{ code: 'LINE_STOPPAGE', label: '重大停线风险', evidence: '停线 4 小时', requiresHuman: true }],
  departmentSuggestion: ['质量部'], slaSuggestion: '24 小时', start8dSuggestion: true, confidence: 0.9,
  evidenceSpans: [{ field: 'impact', text: '停线 4 小时' }],
  routing: { highRisk: true, requiresHuman: true }, analysisStatus: 'ai_completed',
}

function createTestRouter() {
  const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
  const knowledgeRepository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
  const router = createRouter({
    caseRepository,
    knowledgeRepository,
    modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
    attachmentVerifier: createAttachmentVerifier({
      async inspect() { return { size: 1 } },
      async download() { throw new Error('ATTACHMENT_NOT_FOUND') },
    }),
    analyzeComplaint: async () => analysis,
    generateInitialPack: vi.fn().mockResolvedValue(pack),
  })
  return { caseRepository, knowledgeRepository, router }
}

type Manager = { userId: string }

async function driveToInitialPack(router: ReturnType<typeof createTestRouter>['router'], manager: Manager): Promise<string> {
  const created = await router.route({ action: 'cases.create', payload: { content: '华东精工反馈 BR-2045 尺寸超差，停线 4 小时。' } }, manager)
  const id = (created as { data: { id: string } }).data.id
  await router.route({ action: 'cases.analyze', payload: { id } }, manager)
  await router.route({
    action: 'cases.confirm',
    payload: { id, decision: { outcome: 'modified', severity: 'critical', start8d: true, modificationReason: '客户产线停线' } },
  }, manager)
  await router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)
  return id
}

describe('complaint workflow close loop', () => {
  it('rejects out-of-order advancement and missing stage evidence', async () => {
    const { router } = createTestRouter()
    const manager = { userId: 'manager-1' }
    const id = await driveToInitialPack(router, manager)

    await expect(router.route({ action: 'cases.advance', payload: { id, stage: 'root_cause' } }, manager)).rejects.toThrow('WORKFLOW_TRANSITION_INVALID')
    await expect(router.route({ action: 'cases.advance', payload: { id, stage: 'containment' } }, manager)).rejects.toThrow('CONTAINMENT_EVIDENCE_REQUIRED')
    await expect(router.route({ action: 'cases.close', payload: { id } }, manager)).rejects.toThrow('WORKFLOW_NOT_READY_FOR_CLOSE')
  })

  it('advances through containment, root cause, corrective and customer confirmation', async () => {
    const { router } = createTestRouter()
    const manager = { userId: 'manager-1' }
    const id = await driveToInitialPack(router, manager)

    const containment = await router.route({ action: 'cases.advance', payload: { id, stage: 'containment', containmentEvidence: ['已隔离 3 箱，照片见附件'] } }, manager)
    expect((containment as { data: { workflow: { stage: string } } }).data.workflow.stage).toBe('containment')

    const rootCause = await router.route({ action: 'cases.advance', payload: { id, stage: 'root_cause', rootCause: '夹具磨损导致尺寸超差' } }, manager)
    expect((rootCause as { data: { workflow: { rootCause: string; rootCauseConfirmedBy: string } } }).data.workflow).toMatchObject({
      stage: 'root_cause', rootCause: '夹具磨损导致尺寸超差', rootCauseConfirmedBy: 'manager-1',
    })

    const corrective = await router.route({ action: 'cases.advance', payload: { id, stage: 'corrective', correctiveAction: '更换夹具并调整点检频次', correctiveVerification: '连续 5 批测量合格' } }, manager)
    expect((corrective as { data: { workflow: { correctiveVerification: string } } }).data.workflow.correctiveVerification).toBe('连续 5 批测量合格')

    const customer = await router.route({ action: 'cases.advance', payload: { id, stage: 'customer_confirm', customerAccepted: true, customerFeedback: '客户已验收' } }, manager)
    expect((customer as { data: { workflow: { customerAccepted: boolean } } }).data.workflow.customerAccepted).toBe(true)
  })

  it('blocks closing until every close-gate condition is met', async () => {
    const { router } = createTestRouter()
    const manager = { userId: 'manager-1' }
    const id = await driveToInitialPack(router, manager)
    await router.route({ action: 'cases.advance', payload: { id, stage: 'containment', containmentEvidence: ['已隔离'] } }, manager)
    await router.route({ action: 'cases.advance', payload: { id, stage: 'root_cause', rootCause: '夹具磨损' } }, manager)
    await router.route({ action: 'cases.advance', payload: { id, stage: 'corrective', correctiveAction: '更换夹具', correctiveVerification: '验证通过' } }, manager)
    // 到达客户确认但仍有未清零高风险 -> 关单被拦
    await router.route({ action: 'cases.advance', payload: { id, stage: 'customer_confirm', customerAccepted: true, unresolvedHighRisks: 1 } }, manager)
    await expect(router.route({ action: 'cases.close', payload: { id } }, manager)).rejects.toThrow('CLOSE_GATE_BLOCKED')

    // 停留在客户确认阶段修正高风险为 0 后即可关单
    await router.route({ action: 'cases.advance', payload: { id, stage: 'customer_confirm', customerAccepted: true, unresolvedHighRisks: 0 } }, manager)
    const closed = await router.route({ action: 'cases.close', payload: { id } }, manager)
    expect((closed as { data: { workflow: { stage: string; closedAt: string; knowledgeSedimentation: string } } }).data.workflow).toMatchObject({
      stage: 'closed', knowledgeSedimentation: 'pending',
    })
    expect((closed as { data: { workflow: { closedAt: string } } }).data.workflow.closedAt).toBeTruthy()
  })

  it('generates a pending knowledge card only after close and only once', async () => {
    const { router, knowledgeRepository } = createTestRouter()
    const manager = { userId: 'manager-1' }
    const id = await driveToInitialPack(router, manager)

    await expect(router.route({ action: 'cases.generateKnowledgeCard', payload: { id } }, manager)).rejects.toThrow('CASE_NOT_CLOSED')

    await router.route({ action: 'cases.advance', payload: { id, stage: 'containment', containmentEvidence: ['已隔离'] } }, manager)
    await router.route({ action: 'cases.advance', payload: { id, stage: 'root_cause', rootCause: '夹具磨损' } }, manager)
    await router.route({ action: 'cases.advance', payload: { id, stage: 'corrective', correctiveAction: '更换夹具', correctiveVerification: '验证通过' } }, manager)
    await router.route({ action: 'cases.advance', payload: { id, stage: 'customer_confirm', customerAccepted: true } }, manager)
    await router.route({ action: 'cases.close', payload: { id } }, manager)

    const generated = await router.route({ action: 'cases.generateKnowledgeCard', payload: { id } }, manager)
    expect(generated).toMatchObject({ ok: true })
    expect((generated as { data: { item: { status: string; type: string } } }).data.item).toMatchObject({ status: 'pending_review', type: 'case' })

    const pending = await knowledgeRepository.listPendingReview()
    expect(pending.map((item) => item.title)).toEqual(expect.arrayContaining([expect.stringContaining('案例沉淀')]))

    await expect(router.route({ action: 'cases.generateKnowledgeCard', payload: { id } }, manager)).rejects.toThrow('KNOWLEDGE_CARD_ALREADY_GENERATED')
  })
})
