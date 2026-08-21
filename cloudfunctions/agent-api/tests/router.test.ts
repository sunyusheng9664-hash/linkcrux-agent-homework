import { describe, expect, it, vi } from 'vitest'

import { CaseRepository, InMemoryCaseAdapter } from '../src/repositories/caseRepository'
import { KnowledgeRepository, InMemoryKnowledgeAdapter } from '../src/repositories/knowledgeRepository'
import { InMemoryModelUsageAdapter, ModelUsageRepository } from '../src/repositories/modelUsageRepository'
import { createRouter, type AuthContext } from '../src/router'
import { analyzeComplaint, type AnalyzeComplaintDependencies } from '../src/actions/analyzeComplaint'
import { ingestKnowledge } from '../src/actions/ingestKnowledge'
import { answerKnowledge } from '../src/actions/answerKnowledge'
import { createHandoff } from '../src/actions/createHandoff'
import { reviewKnowledgeItem } from '../src/actions/reviewKnowledgeItem'
import { createAttachmentVerifier } from '../src/services/attachmentVerifier'
import { ComplaintInputSchema, MAX_ATTACHMENT_COUNT, MAX_IMAGE_SIZE_BYTES } from '../../../src/contracts/case'

const userContext: AuthContext = { userId: 'quality-manager-1' }
const anonymousContext: AuthContext = {}

function createTestRouter(files = new Map<string, Uint8Array>()) {
  const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
  return createRouter({
    caseRepository,
    modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
    attachmentVerifier: createAttachmentVerifier({
      async inspect(fileId) {
        const file = files.get(fileId)
        if (!file) throw new Error('ATTACHMENT_NOT_FOUND')
        return { size: file.byteLength, mimeType: 'image/png' }
      },
      async download(fileId) {
        const file = files.get(fileId)
        if (!file) throw new Error('ATTACHMENT_NOT_FOUND')
        return file
      },
    }),
    analyzeComplaint: async (input) => ({
      facts: input.facts ?? {},
      missingFields: [],
      informationCompleteness: 0,
      riskSuggestion: [],
      departmentSuggestion: ['质量部'],
      slaSuggestion: '24 小时内首次响应',
      start8dSuggestion: false,
      confidence: 0.8,
      evidenceSpans: [],
      routing: { highRisk: false, requiresHuman: false },
      analysisStatus: 'ai_completed' as const,
    }),
  })
}

describe('agent api router', () => {
  it('routes text knowledge ingestion and accepts publication only from a server-trusted knowledge owner', async () => {
    const knowledgeRepository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
    const router = createRouter({
      caseRepository: new CaseRepository(new InMemoryCaseAdapter()),
      modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: async () => ({
        facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
        slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [],
        routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const,
      }),
      knowledgeRepository,
      ingestKnowledge: (input) => ingestKnowledge({
        repository: knowledgeRepository,
        createModelClient: () => ({ generateStructured: async <T>() => ({
          items: [{ type: 'procedure', title: '临时遏制', content: { steps: ['冻结疑似库存'] }, sourceChunkSequences: [1] }],
        } as T) }),
      }, input),
      reviewKnowledgeItem: (id, input, reviewer) => reviewKnowledgeItem({ repository: knowledgeRepository }, id, input, reviewer),
      answerKnowledge: (query, context) => answerKnowledge({
        repository: knowledgeRepository,
        createModelClient: () => ({ generateStructured: async <T>() => ({ answer: '冻结疑似库存。', citationItemIds: [itemId], missingInformation: [] } as T) }),
      }, query, context),
    })
    const payload = {
      name: 'SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/sop.md',
      version: 'v1', text: '# 临时遏制\n冻结疑似库存', owner: '质量部', scope: {}, visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z',
    }

    const ingested = await router.route({ action: 'knowledge.ingest', payload }, userContext)
    const itemId = (ingested as { data: { items: Array<{ id: string; status: string }> } }).data.items[0].id
    expect(ingested).toMatchObject({ ok: true, data: { items: [{ status: 'pending_review' }] } })
    await expect(router.route({ action: 'knowledge.pending', payload: {} }, userContext)).rejects.toThrow('FORBIDDEN')
    await expect(router.route({ action: 'knowledge.pending', payload: {} }, { userId: 'knowledge-owner-1', knowledgeRole: 'knowledge_owner' }))
      .resolves.toMatchObject({ ok: true, data: [expect.objectContaining({ id: itemId, status: 'pending_review' })] })
    await expect(router.route({ action: 'knowledge.citation', payload: { id: itemId } }, userContext)).rejects.toThrow('FORBIDDEN')
    await expect(router.route({ action: 'knowledge.citation', payload: { id: itemId } }, { userId: 'knowledge-owner-1', knowledgeRole: 'knowledge_owner' }))
      .resolves.toMatchObject({ ok: true, data: { documentName: 'SOP.md', version: 'v1', chunks: [expect.objectContaining({ sequence: 1, text: expect.stringContaining('冻结疑似库存') })] } })
    await expect(router.route({ action: 'knowledge.review', payload: { id: itemId, status: 'published', role: 'knowledge_owner' } }, userContext)).rejects.toThrow()
    await expect(router.route({ action: 'knowledge.review', payload: { id: itemId, status: 'published' } }, { userId: 'knowledge-owner-1', knowledgeRole: 'knowledge_owner' }))
      .resolves.toMatchObject({ ok: true, data: { status: 'published', reviewedBy: 'knowledge-owner-1' } })
    await expect(router.route({ action: 'knowledge.answer', payload: { query: '如何冻结库存？', scope: {} } }, userContext))
      .resolves.toMatchObject({ ok: true, data: { decision: 'answer', answer: '冻结疑似库存。', citations: [{ itemId }] } })
  })

  it('rejects anonymous requests before handling an action', async () => {
    await expect(createTestRouter().route({ action: 'cases.list' }, anonymousContext)).rejects.toThrow(
      'UNAUTHENTICATED',
    )
  })

  it('creates a persisted handoff packet through the server action route', async () => {
    const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
    const router = createRouter({
      caseRepository,
      modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: async () => ({ facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'], slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [], routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const }),
      createHandoff: (id, actorId, input) => createHandoff({ repository: caseRepository }, id, actorId, input),
    })
    const created = await router.route({ action: 'cases.create', payload: { content: '客户人员受伤', facts: { product: 'BR-2045' } } }, userContext)
    const id = (created as { data: { id: string } }).data.id

    await expect(router.route({ action: 'handoff.create', payload: { id, reason: 'HIGH_RISK', suggestedTeam: '质量与生产应急响应', searchedKnowledge: [] } }, userContext))
      .resolves.toMatchObject({ ok: true, data: { caseId: id, reason: 'HIGH_RISK' } })
    await expect(router.route({ action: 'handoff.list', payload: { id } }, userContext))
      .resolves.toMatchObject({ ok: true, data: [expect.objectContaining({ caseId: id, reason: 'HIGH_RISK', transitionReply: expect.stringContaining('质量与生产应急响应') })] })
    await expect(router.route({ action: 'handoff.list', payload: { id } }, { userId: 'another-manager' })).rejects.toThrow('CASE_NOT_FOUND')
  })

  it('automatically creates a knowledge handoff packet for a case-bound unsupported answer', async () => {
    const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
    const createHandoffSpy = vi.fn(async (id: string) => ({ id: 'handoff-1', caseId: id, source: 'knowledge', reason: 'KNOWLEDGE_NOT_COVERED' }))
    const router = createRouter({
      caseRepository, modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: async () => ({ facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'], slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [], routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const }),
      answerKnowledge: async () => ({ decision: 'handoff', answer: null, citations: [], missingInformation: [], reason: 'KNOWLEDGE_NOT_COVERED' }),
      createHandoff: createHandoffSpy as never,
    })
    const created = await router.route({ action: 'cases.create', payload: { content: '需要查询未知工艺' } }, userContext)
    const id = (created as { data: { id: string } }).data.id
    await expect(router.route({ action: 'knowledge.answer', payload: { query: '未知工艺如何处理？', scope: {}, caseId: id } }, userContext))
      .resolves.toMatchObject({ ok: true, data: { decision: 'handoff', handoff: { caseId: id } } })
    expect(createHandoffSpy).toHaveBeenCalledWith(id, userContext.userId, expect.objectContaining({ reason: 'KNOWLEDGE_NOT_COVERED', source: 'knowledge' }))
  })

  it('keeps published knowledge visible but forces human handoff for a line-stoppage case', async () => {
    const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
    const createHandoffSpy = vi.fn(async (id: string, _actorId: string, input: { reason: string; searchedKnowledge?: string[] }) => ({
      id: 'handoff-high-risk', caseId: id, source: 'knowledge', reason: input.reason, searchedKnowledge: input.searchedKnowledge ?? [],
    }))
    const answerKnowledgeSpy = vi.fn(async () => ({
      decision: 'answer' as const,
      answer: '冻结疑似库存，并保留样件用于后续调查。',
      citations: [{ itemId: 'knowledge-dimension-control', documentId: 'document-sop', documentName: '来料异常处理 SOP', version: 'v1', chunkIds: ['chunk-dimension-control'] }],
      missingInformation: [],
    }))
    const router = createRouter({
      caseRepository, modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: async () => ({ facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'], slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [], routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const }),
      answerKnowledge: answerKnowledgeSpy,
      createHandoff: createHandoffSpy as never,
    })
    const created = await router.route({ action: 'cases.create', payload: { content: '客户反馈 BR-2045 尺寸超差，产线已停线，要求临时遏制措施。' } }, userContext)
    const id = (created as { data: { id: string } }).data.id

    await expect(router.route({ action: 'knowledge.answer', payload: { query: '可参考哪些临时遏制措施？', scope: {}, caseId: id } }, userContext))
      .resolves.toMatchObject({
        ok: true,
        data: {
          decision: 'handoff',
          reason: 'HIGH_RISK',
          answer: '冻结疑似库存，并保留样件用于后续调查。',
          citations: [{ itemId: 'knowledge-dimension-control' }],
          handoff: { caseId: id, reason: 'HIGH_RISK', searchedKnowledge: ['knowledge-dimension-control'] },
        },
      })
    expect(answerKnowledgeSpy).toHaveBeenCalledWith(expect.stringContaining('产线已停线'), expect.anything(), { referenceOnly: true })
    expect(createHandoffSpy).toHaveBeenCalledWith(id, userContext.userId, expect.objectContaining({ reason: 'HIGH_RISK', searchedKnowledge: ['knowledge-dimension-control'], source: 'knowledge' }))
  })

  it('only allows the cases action whitelist', async () => {
    await expect(createTestRouter().route({ action: 'admin.eval' }, userContext)).rejects.toThrow(
      'ACTION_NOT_ALLOWED',
    )
  })

  it('uses the trusted auth user instead of any creator field in client payload', async () => {
    const router = createTestRouter()

    const response = await router.route(
      {
        action: 'cases.create',
        payload: { content: '客户反馈 BR-2045 尺寸超差', createdBy: 'attacker' },
      },
      userContext,
    )

    expect(response).toMatchObject({ ok: true, data: { createdBy: 'quality-manager-1', status: 'intake' } })
  })

  it('rejects direct create payloads with a non-image or oversized attachment', async () => {
    const router = createTestRouter()
    const basePayload = { content: '客户反馈 BR-2045 尺寸超差', attachments: [{ fileId: 'cloud://env-123/complaints/quality-manager-1/proof.png', mimeType: 'image/png', size: 100, originalName: 'proof.png' }] }

    await expect(router.route({ action: 'cases.create', payload: { ...basePayload, attachments: [{ ...basePayload.attachments[0], mimeType: 'application/pdf' }] } }, userContext)).rejects.toThrow()
    await expect(router.route({ action: 'cases.create', payload: { ...basePayload, attachments: [{ ...basePayload.attachments[0], size: 5 * 1024 * 1024 + 1 }] } }, userContext)).rejects.toThrow()
  })

  it('rejects cross-user, missing, fake-image and size-forged attachments before persistence', async () => {
    const ownFileId = 'cloud://env-123/complaints/quality-manager-1/proof.png'
    const otherFileId = 'cloud://env-123/complaints/another-manager/proof.png'
    const fakePngId = 'cloud://env-123/complaints/quality-manager-1/not-an-image.png'
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    const router = createTestRouter(new Map([[ownFileId, png], [otherFileId, png], [fakePngId, new TextEncoder().encode('not an image')]]))
    const attachment = { fileId: ownFileId, mimeType: 'image/png' as const, size: png.byteLength, originalName: 'client-claimed-name.png' }
    const create = (override: Partial<typeof attachment>) => router.route({ action: 'cases.create', payload: { content: '客户反馈 BR-2045 尺寸超差', attachments: [{ ...attachment, ...override }] } }, userContext)

    await expect(create({ fileId: otherFileId })).rejects.toThrow('ATTACHMENT_NOT_OWNED')
    await expect(create({ fileId: 'cloud://env-123/complaints/quality-manager-1/missing.png' })).rejects.toThrow('ATTACHMENT_NOT_FOUND')
    await expect(create({ fileId: fakePngId, size: 12 })).rejects.toThrow('ATTACHMENT_MIME_MISMATCH')
    await expect(create({ size: 1 })).rejects.toThrow('ATTACHMENT_SIZE_MISMATCH')

    await expect(create({})).resolves.toMatchObject({
      ok: true,
      data: { attachments: [{ fileId: ownFileId, mimeType: 'image/png', size: png.byteLength, originalName: 'proof.png' }] },
    })
  })

  it('rejects a matching user path from another bucket or an encoded traversal name', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    const otherBucket = 'cloud://other-env/other-prefix/complaints/quality-manager-1/proof.png'
    const traversalName = 'cloud://env-123/complaints/quality-manager-1/%2Fsecret.png'
    const router = createTestRouter(new Map([[otherBucket, png], [traversalName, png]]))
    const payload = (fileId: string) => ({
      action: 'cases.create' as const,
      payload: { content: '客户反馈 BR-2045 尺寸超差', attachments: [{ fileId, mimeType: 'image/png' as const, size: png.byteLength, originalName: 'proof.png' }] },
    })

    await expect(router.route(payload(otherBucket), userContext)).rejects.toThrow('ATTACHMENT_NOT_OWNED')
    await expect(router.route(payload(traversalName), userContext)).rejects.toThrow('ATTACHMENT_NOT_OWNED')
  })

  it('rejects more than the attachment limit in the shared input schema', () => {
    const attachment = { fileId: 'cloud://env-123/complaints/quality-manager-1/proof.png', mimeType: 'image/png', size: 1, originalName: 'proof.png' }
    expect(() => ComplaintInputSchema.parse({ content: '超过上限', attachments: Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, () => attachment) })).toThrow()
  })

  it('uses trusted file info before downloading and processes attachments in order', async () => {
    const first = 'cloud://env-123/complaints/quality-manager-1/first.png'
    const second = 'cloud://env-123/complaints/quality-manager-1/second.png'
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    const calls: string[] = []
    const download = vi.fn(async (fileId: string) => { calls.push(`download:${fileId}`); return png })
    const verifier = createAttachmentVerifier({
      inspect: async (fileId: string) => { calls.push(`info:${fileId}`); return { size: fileId === first ? png.byteLength : MAX_IMAGE_SIZE_BYTES + 1, mimeType: 'image/png' } },
      download,
    })
    const attachment = (fileId: string) => ({ fileId, mimeType: 'image/png' as const, size: png.byteLength, originalName: 'client.png' })

    await expect(verifier.verify(userContext.userId!, [attachment(first), attachment(second)])).rejects.toThrow('ATTACHMENT_TOO_LARGE')
    expect(download).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([`info:${first}`, `download:${first}`, `info:${second}`])
  })

  it('persists an analysis result, including high-risk manual takeover after model failure', async () => {
    const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
    const router = createRouter({
      caseRepository,
      modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: async () => ({
        facts: {}, missingFields: ['impact'], informationCompleteness: 0,
        riskSuggestion: [], departmentSuggestion: ['待质量经理确认'], slaSuggestion: '待质量经理确认',
        start8dSuggestion: true, confidence: 0, evidenceSpans: [],
        routing: { highRisk: true, requiresHuman: true }, analysisStatus: 'manual_takeover' as const,
        analysisFailureReason: 'MODEL_REQUEST_FAILED' as const,
      }),
    })
    const created = await router.route({ action: 'cases.create', payload: { content: '人员受伤' } }, userContext)
    const id = (created as { data: { id: string } }).data.id

    await router.route({ action: 'cases.analyze', payload: { id } }, userContext)

    expect(await caseRepository.get(id, userContext.userId!)).toMatchObject({
      analysis: { analysisStatus: 'manual_takeover', analysisFailureReason: 'MODEL_REQUEST_FAILED' },
      analysisStatus: 'manual_takeover',
    })
  })

  it('persists high-risk manual takeover when model client configuration cannot be created', async () => {
    const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
    const router = createRouter({
      caseRepository,
      modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: (input) => analyzeComplaint({
        createModelClient: () => { throw new Error('MODEL_CONFIG_MISSING') },
      } as unknown as AnalyzeComplaintDependencies, input),
    })
    const created = await router.route({ action: 'cases.create', payload: { content: '客户人员受伤，要求召回' } }, userContext)
    const id = (created as { data: { id: string } }).data.id

    await router.route({ action: 'cases.analyze', payload: { id } }, userContext)

    expect(await caseRepository.get(id, userContext.userId!)).toMatchObject({
      analysisStatus: 'manual_takeover',
      analysis: {
        analysisStatus: 'manual_takeover',
        analysisFailureReason: 'MODEL_CONFIG_MISSING',
        routing: { highRisk: true, requiresHuman: true },
      },
    })
  })

  it('only accepts structured manager confirmation with a modification reason', async () => {
    const router = createTestRouter()
    const created = await router.route({ action: 'cases.create', payload: { content: '需要确认' } }, userContext)
    const id = (created as { data: { id: string } }).data.id

    await expect(
      router.route({ action: 'cases.confirm', payload: { id, decision: { severity: 'critical' } } }, userContext),
    ).rejects.toThrow('CONFIRMATION_INVALID')

    await expect(router.route({
      action: 'cases.confirm',
      payload: { id, decision: { outcome: 'accepted', severity: 'medium', start8d: false } },
    }, userContext)).rejects.toThrow('CASE_STATE_INVALID')

    await router.route({ action: 'cases.analyze', payload: { id } }, userContext)

    const result = await router.route(
      {
        action: 'cases.confirm',
        payload: {
          id,
          decision: { outcome: 'modified', severity: 'critical', start8d: true, modificationReason: '客户产线停线' },
        },
      },
      userContext,
    )
    expect(result).toMatchObject({ ok: true, data: { status: 'confirmed', managerDecision: { severity: 'critical' } } })
  })

  it('only accepts the derived severity and 8D baselines when the manager outcome is accepted', async () => {
    const router = createTestRouter()
    const created = await router.route({ action: 'cases.create', payload: { content: '外观异常' } }, userContext)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, userContext)

    await expect(router.route({
      action: 'cases.confirm',
      payload: { id, decision: { outcome: 'accepted', severity: 'high', start8d: false } },
    }, userContext)).rejects.toThrow('CONFIRMATION_INVALID')

    await expect(router.route({
      action: 'cases.confirm',
      payload: { id, decision: { outcome: 'accepted', severity: 'medium', start8d: false } },
    }, userContext)).resolves.toMatchObject({ ok: true, data: { status: 'confirmed' } })
  })

  it('does not let a stale re-analysis overwrite a concurrent manager confirmation', async () => {
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const analyzing = new Promise<void>((resolve) => { started = resolve })
    let analysisCalls = 0
    const caseRepository = new CaseRepository(new InMemoryCaseAdapter())
    const router = createRouter({
      caseRepository,
      modelUsageRepository: new ModelUsageRepository(new InMemoryModelUsageAdapter()),
      attachmentVerifier: createAttachmentVerifier({ async inspect() { throw new Error('ATTACHMENT_NOT_FOUND') }, async download() { throw new Error('ATTACHMENT_NOT_FOUND') } }),
      analyzeComplaint: async () => {
        analysisCalls += 1
        if (analysisCalls === 2) { started(); await gate }
        return {
          facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
          slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [],
          routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const,
        }
      },
    })
    const created = await router.route({ action: 'cases.create', payload: { content: '并发复核' } }, userContext)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, userContext)

    const staleAnalysis = router.route({ action: 'cases.analyze', payload: { id } }, userContext)
    await analyzing
    await router.route({
      action: 'cases.confirm', payload: { id, decision: { outcome: 'accepted', severity: 'medium', start8d: false } },
    }, userContext)
    release()

    await expect(staleAnalysis).rejects.toThrow('CASE_VERSION_CONFLICT')
    expect(await caseRepository.get(id, userContext.userId!)).toMatchObject({
      status: 'confirmed', managerDecision: { outcome: 'accepted' }, version: 3,
    })
  })

  it('allows only one of two confirmations based on the same analyzed version', async () => {
    const router = createTestRouter()
    const created = await router.route({ action: 'cases.create', payload: { content: '并发判断' } }, userContext)
    const id = (created as { data: { id: string } }).data.id
    await router.route({ action: 'cases.analyze', payload: { id } }, userContext)

    const results = await Promise.allSettled([
      router.route({ action: 'cases.confirm', payload: { id, decision: { outcome: 'accepted', severity: 'medium', start8d: false } } }, userContext),
      router.route({ action: 'cases.confirm', payload: { id, decision: { outcome: 'modified', severity: 'high', start8d: true, modificationReason: '升级处理' } } }, userContext),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: 'CASE_VERSION_CONFLICT' }) }),
    ])
  })
})
