import { describe, expect, it, vi } from 'vitest'

import type { InitialPack } from '../../../src/contracts/case'
import { generateInitialPack, type InitialPackSource } from '../src/actions/generateInitialPack'
import { CaseRepository, InMemoryCaseAdapter } from '../src/repositories/caseRepository'
import { InMemoryModelUsageAdapter, ModelUsageRepository } from '../src/repositories/modelUsageRepository'
import { createRouter } from '../src/router'
import { createAttachmentVerifier } from '../src/services/attachmentVerifier'
import type { ModelClient, ModelMessage } from '../src/services/modelClient'

const modelPack: InitialPack = {
  customerReply: '已收到投诉，当前正在核实批次与影响范围，将按节点同步进展。',
  internalTicket: '请质量经理组织初步响应并补齐缺失信息。',
  d1: '计划由质量经理牵头，协调生产与客服参与。',
  d2: '当前已知问题为 BR-2045 制动异常；影响范围待核实。',
  d3: {
    containmentActions: [
      {
        suggestedAction: '建议隔离待核批次库存',
        owner: '质量经理',
        dueAt: '2026-08-20T18:00:00+08:00',
        executionStatus: 'suggested',
        evidence: [],
      },
    ],
  },
  timeline24h14d30d: [
    { milestone: '24h', delivery: '首次响应及 D1–D3 建议更新' },
    { milestone: '14d', delivery: 'D4–D6 调查与验证计划更新' },
    { milestone: '30d', delivery: 'D7–D8 预防与闭环计划更新' },
  ],
  d4ToD8Plan: [
    { phase: 'D4', plan: '计划收集证据并验证可能原因。' },
    { phase: 'D5', plan: '计划评估纠正措施选项。' },
    { phase: 'D6', plan: '计划在人工批准后验证措施效果。' },
    { phase: 'D7', plan: '计划评估预防复发机制。' },
    { phase: 'D8', plan: '计划在证据齐备后组织结案评审。' },
  ],
}
const modelProposal = {
  proposals: [{
    actionType: 'isolate' as const,
    targetScope: 'suspected_inventory' as const,
    dueWithinHours: 24,
  }],
}

const source: InitialPackSource = {
  caseId: 'case-1',
  content: '客户反馈 BR-2045 制动异常，操作员受伤。',
  facts: { product: 'BR-2045', defect: '制动异常', impact: '操作员受伤' },
  analysis: {
    facts: { product: 'BR-2045', defect: '制动异常', impact: '操作员受伤' },
    missingFields: ['customer', 'batch', 'quantity', 'request'],
    informationCompleteness: 45,
    riskSuggestion: [{ code: 'SAFETY' as const, label: '人员安全风险', evidence: '操作员受伤', requiresHuman: true as const }],
    departmentSuggestion: ['质量部'],
    slaSuggestion: '24 小时内首次响应',
    start8dSuggestion: true,
    confidence: 0.8,
    evidenceSpans: [{ field: 'impact', text: '操作员受伤' }],
    routing: { highRisk: true, requiresHuman: true },
    analysisStatus: 'ai_completed' as const,
  },
  managerDecision: {
    outcome: 'modified' as const,
    severity: 'critical' as const,
    start8d: true,
    modificationReason: '客户报告人员受伤',
  },
}

describe('generateInitialPack', () => {
  it('asks the model only for D3 and assembles all other sections from controlled server templates', async () => {
    let calls = 0
    let receivedMessages: ModelMessage[] = []
    const generateStructured: ModelClient['generateStructured'] = async <T>(_schema: Parameters<ModelClient['generateStructured']>[0], messages: ModelMessage[]) => {
      calls += 1
      receivedMessages = messages
      return modelProposal as T
    }

    const result = await generateInitialPack({ createModelClient: () => ({ generateStructured }) }, source)

    expect(result.d3.containmentActions).toEqual([{
      suggestedAction: '建议隔离并标识待核对象；适用范围：疑似受影响库存',
      owner: '仓储负责人',
      dueAt: '建议在 24 小时内完成',
      executionStatus: 'suggested',
      evidence: [],
    }])
    expect(result.customerReply).toContain('根因、责任、召回与赔偿均尚未确认')
    expect(result.internalTicket).toContain('质量经理')
    expect(result.d1).toContain('计划')
    expect(result.d2).toContain('当前案件记录（待质量经理逐项核实）')
    expect(result.d2).toContain('产品：[案件输入·待验证] BR-2045')
    expect(result.d2).toContain('缺陷：[案件输入·待验证] 制动异常')
    expect(result.d2).toContain('批次：待确认')
    expect(result.timeline24h14d30d.map((entry) => entry.milestone)).toEqual(['24h', '14d', '30d'])
    expect(result.d4ToD8Plan.every((entry) => entry.plan.startsWith('计划'))).toBe(true)
    expect(calls).toBe(1)
    expect(receivedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: expect.stringContaining('只输出 D3') }),
      expect.objectContaining({ role: 'user', content: expect.stringContaining('客户报告人员受伤') }),
    ]))
    expect(receivedMessages.map((message) => message.content).join('\n')).not.toContain('case-1')
    expect(receivedMessages.map((message) => message.content).join('\n')).not.toContain('ownerRole')
  })

  it.each([
    ['isolate', 'suspected_inventory', '仓储负责人'],
    ['hold_shipment', 'related_shipments', '仓储负责人'],
    ['inspect', 'affected_process', '质量经理'],
    ['preserve_evidence', 'complaint_evidence', '质量经理'],
    ['notify_quality', 'complaint_evidence', '客服负责人'],
  ] as const)('derives a fixed owner for %s on %s', async (actionType, targetScope, owner) => {
    const proposal = { proposals: [{ actionType, targetScope, dueWithinHours: 24 }] }

    const result = await generateInitialPack(
      { createModelClient: () => ({ generateStructured: async <T>() => proposal as T }) },
      source,
    )

    expect(result.d3.containmentActions[0].owner).toBe(owner)
  })

  it.each([
    ['isolate', 'affected_process', 'customer_service'],
    ['hold_shipment', 'related_shipments', 'customer_service'],
    ['preserve_evidence', 'complaint_evidence', 'warehouse_manager'],
  ] as const)('rejects model-controlled owner %s/%s/%s', async (actionType, targetScope, ownerRole) => {
    const proposal = { proposals: [{ actionType, targetScope, ownerRole, dueWithinHours: 24 }] }

    await expect(generateInitialPack(
      { createModelClient: () => ({ generateStructured: async <T>() => proposal as T }) },
      source,
    )).rejects.toThrow('INITIAL_PACK_MODEL_FAILED')
  })

  it('does not allow dangerous model-controlled sections into the assembled pack', async () => {
    const output = { ...modelProposal, customerReply: '根因已确认，承担责任并赔偿' }

    await expect(generateInitialPack(
      { createModelClient: () => ({ generateStructured: async <T>() => output as T }) },
      source,
    )).rejects.toThrow('INITIAL_PACK_MODEL_FAILED')
  })

  it.each([
    '已查明根因',
    '承担责任',
    '召回',
    '给予补偿',
    '措施均已采取',
    '请拨座机 010-12345678',
  ])('rejects free-text bypass fields from a model proposal: %s', async (unsafeText) => {
    const unsafeProposal = {
      proposals: [{ ...modelProposal.proposals[0], suggestedAction: unsafeText }],
    }

    await expect(generateInitialPack(
      { createModelClient: () => ({ generateStructured: async <T>() => unsafeProposal as T }) },
      source,
    )).rejects.toThrow('INITIAL_PACK_MODEL_FAILED')
  })

  it('maps structured model failure to a controlled manual handoff', async () => {
    await expect(generateInitialPack(
      { createModelClient: () => ({ generateStructured: async () => { throw new Error('MODEL_SCHEMA_INVALID') } }) },
      source,
    )).rejects.toThrow('INITIAL_PACK_MODEL_FAILED')
  })

  it('rejects an incompatible action and target combination before rendering D3', async () => {
    const incompatible = {
      proposals: [{ ...modelProposal.proposals[0], actionType: 'preserve_evidence', targetScope: 'suspected_inventory' }],
    }
    await expect(generateInitialPack(
      { createModelClient: () => ({ generateStructured: async <T>() => incompatible as T }) },
      source,
    )).rejects.toThrow('INITIAL_PACK_MODEL_FAILED')
  })

  it('never copies raw contact details or invents missing customer and batch facts', async () => {
    const sensitiveSource = {
      ...source,
      content: '客户王女士，电话 13800138000，邮箱 qa@example.com，微信 wx-secret，批次未知。',
      facts: { product: 'BR-2045 qa@example.com', defect: '制动异常 微信 wx-secret', impact: '13800138000' },
      analysis: { ...source.analysis, facts: { product: 'BR-2045', defect: '制动异常' } },
    }
    const result = await generateInitialPack(
      { createModelClient: () => ({ generateStructured: async <T>() => modelProposal as T }) },
      sensitiveSource,
    )
    const output = JSON.stringify(result)

    expect(output).not.toMatch(/13800138000|qa@example\.com|wx-secret|王女士/)
    expect(result.d2).toContain('批次：待确认')
  })
})

describe('cases.generateInitialPack router action', () => {
  function createTestRouter(
    generate = vi.fn().mockResolvedValue(modelPack),
    options: { adapter?: InMemoryCaseAdapter; modelUsageRepository?: ModelUsageRepository } = {},
  ) {
    const caseRepository = new CaseRepository(options.adapter ?? new InMemoryCaseAdapter())
    const router = createRouter({
      caseRepository,
      modelUsageRepository: options.modelUsageRepository ?? new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: async () => source.analysis,
      generateInitialPack: generate,
    })
    return { caseRepository, generate, router }
  }

  it('requires a confirmed manager decision, persists the pack, and reproduces it through get/list', async () => {
    const { router, generate } = createTestRouter()
    const manager = { userId: 'manager-1' }
    const created = await router.route({ action: 'cases.create', payload: { content: source.content, facts: source.facts } }, manager)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, manager)

    await expect(router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)).rejects.toThrow('CASE_NOT_CONFIRMED')
    await expect(router.route({
      action: 'cases.confirm',
      payload: { id, decision: { outcome: 'accepted', severity: 'critical', start8d: false } },
    }, manager)).rejects.toThrow('CONFIRMATION_INVALID')

    await router.route({
      action: 'cases.confirm',
      payload: { id, decision: source.managerDecision },
    }, manager)
    const generated = await router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)
    const fetched = await router.route({ action: 'cases.get', payload: { id } }, manager)
    const listed = await router.route({ action: 'cases.list' }, manager)

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ caseId: id, managerDecision: source.managerDecision }))
    expect(generated).toMatchObject({ ok: true, data: { status: 'initial_pack', initialPack: modelPack } })
    expect(fetched).toMatchObject({ ok: true, data: { initialPack: modelPack } })
    expect(listed).toMatchObject({ ok: true, data: [expect.objectContaining({ id, initialPack: modelPack })] })

    await expect(router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)).resolves.toEqual(generated)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('enforces actor ownership before generating a pack', async () => {
    const { router, generate } = createTestRouter()
    const created = await router.route({ action: 'cases.create', payload: { content: source.content } }, { userId: 'manager-1' })
    const id = (created as { data: { id: string } }).data.id

    await expect(router.route(
      { action: 'cases.generateInitialPack', payload: { id } },
      { userId: 'manager-2' },
    )).rejects.toThrow('CASE_NOT_FOUND')
    expect(generate).not.toHaveBeenCalled()
  })

  it('claims generation atomically so concurrent requests call the model only once', async () => {
    let release!: (pack: InitialPack) => void
    let markStarted!: () => void
    const gate = new Promise<InitialPack>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const generate = vi.fn(async () => { markStarted(); return gate })
    const { router } = createTestRouter(generate)
    const manager = { userId: 'manager-1' }
    const created = await router.route({ action: 'cases.create', payload: { content: source.content } }, manager)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, manager)
    await router.route({ action: 'cases.confirm', payload: { id, decision: source.managerDecision } }, manager)

    const first = router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)
    await started
    const second = router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)
    const secondResult = expect(second).rejects.toThrow('INITIAL_PACK_GENERATING')
    await expect(router.route({ action: 'cases.confirm', payload: { id, decision: {
      outcome: 'modified', severity: 'high', start8d: true, modificationReason: '生成中改判',
    } } }, manager)).rejects.toThrow('CASE_STATE_INVALID')
    await Promise.resolve()
    release(modelPack)

    await expect(first).resolves.toMatchObject({ ok: true, data: { initialPackStatus: 'generated' } })
    await secondResult
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('keeps a generated business result when model-usage audit persistence fails', async () => {
    const failingUsage = { record: vi.fn().mockRejectedValue(new Error('USAGE_AUDIT_FAILED')) } as unknown as ModelUsageRepository
    const { caseRepository, router } = createTestRouter(undefined, { modelUsageRepository: failingUsage })
    const manager = { userId: 'manager-1' }
    const created = await router.route({ action: 'cases.create', payload: { content: source.content } }, manager)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, manager)
    await router.route({ action: 'cases.confirm', payload: { id, decision: source.managerDecision } }, manager)

    await expect(router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)).resolves.toMatchObject({
      ok: true, data: { status: 'initial_pack', initialPackStatus: 'generated' },
    })
    expect(await caseRepository.get(id, manager.userId)).toMatchObject({ status: 'initial_pack', initialPackStatus: 'generated' })
  })

  it('keeps committed case transitions when case-event audit persistence fails', async () => {
    class FailingEventAdapter extends InMemoryCaseAdapter {
      override async insertEvent(): Promise<void> { throw new Error('EVENT_AUDIT_FAILED') }
    }
    const { caseRepository, router } = createTestRouter(undefined, { adapter: new FailingEventAdapter() })
    const manager = { userId: 'manager-1' }
    const created = await router.route({ action: 'cases.create', payload: { content: source.content } }, manager)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, manager)
    await router.route({ action: 'cases.confirm', payload: { id, decision: source.managerDecision } }, manager)

    await expect(router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)).resolves.toMatchObject({
      ok: true, data: { status: 'initial_pack', initialPackStatus: 'generated' },
    })
    expect(await caseRepository.get(id, manager.userId)).toMatchObject({ status: 'initial_pack', initialPackStatus: 'generated' })
  })

  it('persists manual handoff on generation failure and only retries with an explicit flag', async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('INITIAL_PACK_UNSAFE_D3'))
      .mockResolvedValueOnce(modelPack)
    const { caseRepository, router } = createTestRouter(generate)
    const manager = { userId: 'manager-1' }
    const created = await router.route({ action: 'cases.create', payload: { content: source.content } }, manager)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, manager)
    await router.route({ action: 'cases.confirm', payload: { id, decision: source.managerDecision } }, manager)

    await expect(router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)).rejects.toThrow('INITIAL_PACK_UNSAFE_D3')
    expect(await caseRepository.get(id, manager.userId)).toMatchObject({
      status: 'confirmed',
      initialPackStatus: 'manual_handoff',
      initialPackFailureReason: 'INITIAL_PACK_UNSAFE_D3',
    })
    await expect(router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)).rejects.toThrow('INITIAL_PACK_MANUAL_HANDOFF')
    expect(generate).toHaveBeenCalledTimes(1)

    const retried = await router.route({ action: 'cases.generateInitialPack', payload: { id, retry: true } }, manager)
    expect(retried).toMatchObject({
      ok: true,
      data: { initialPackStatus: 'generated', initialPack: modelPack },
    })
    expect((retried as { data: object }).data).not.toHaveProperty('initialPackFailureReason')
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('forbids re-analysis and re-confirmation after the initial pack is generated', async () => {
    const { router } = createTestRouter()
    const manager = { userId: 'manager-1' }
    const created = await router.route({ action: 'cases.create', payload: { content: source.content } }, manager)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, manager)
    await router.route({ action: 'cases.confirm', payload: { id, decision: source.managerDecision } }, manager)
    await router.route({ action: 'cases.generateInitialPack', payload: { id } }, manager)

    await expect(router.route({ action: 'cases.analyze', payload: { id } }, manager)).rejects.toThrow('CASE_STATE_INVALID')
    await expect(router.route({ action: 'cases.confirm', payload: { id, decision: source.managerDecision } }, manager)).rejects.toThrow('CASE_STATE_INVALID')
  })
})
