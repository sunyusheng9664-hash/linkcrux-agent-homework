import { describe, expect, it, vi } from 'vitest'

import { answerKnowledge } from '../src/actions/answerKnowledge'
import { KnowledgeRepository, InMemoryKnowledgeAdapter } from '../src/repositories/knowledgeRepository'

async function seededRepository() {
  const adapter = new InMemoryKnowledgeAdapter()
  const repository = new KnowledgeRepository(adapter)
  const document = await repository.createDocument('knowledge-owner-1', { name: 'SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/sop.md', version: 'v1' })
  await repository.markDocumentParsed(document.id, 'knowledge-owner-1')
  const [chunk] = await repository.saveChunks(document.id, 'knowledge-owner-1', [{ sequence: 1, text: '发现尺寸超差时，先冻结疑似库存。', charStart: 0, charEnd: 18 }])
  const item = await repository.createItem('knowledge-owner-1', { type: 'qa', title: '尺寸超差遏制', content: { question: '如何遏制？', answer: '先冻结疑似库存。' }, sourceDocumentId: document.id, sourceChunkIds: [chunk.id], owner: '质量部', scope: {}, visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z' })
  await repository.reviewItem(item.id, 'knowledge-owner-1', 'published')
  return { repository, item }
}

const context = { now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'quality_manager' as const, scope: {} }

describe('answerKnowledge', () => {
  it('answers only with model output cited to the retrieved knowledge', async () => {
    const { repository, item } = await seededRepository()
    const result = await answerKnowledge({ repository, createModelClient: () => ({ generateStructured: vi.fn().mockResolvedValue({ answer: '先冻结疑似库存。', citationItemIds: [item.id], missingInformation: [] }) }) }, '尺寸超差后怎么处理？', context)
    expect(result).toMatchObject({ decision: 'answer', answer: '先冻结疑似库存。', citations: [expect.objectContaining({ itemId: item.id })] })
  })

  it('renders published knowledge deterministically for high-risk manager reference without calling a model', async () => {
    const { repository, item } = await seededRepository()
    const model = { generateStructured: vi.fn().mockRejectedValue(new Error('must not be called')) }

    const result = await answerKnowledge(
      { repository, createModelClient: () => model },
      '尺寸超差后可参考哪些临时遏制措施？',
      context,
      { referenceOnly: true },
    )

    expect(result).toMatchObject({ decision: 'answer', citations: [expect.objectContaining({ itemId: item.id })] })
    expect(result.answer).toContain('先冻结疑似库存')
    expect(model.generateStructured).not.toHaveBeenCalled()
  })

  it('hands off when no governed source covers the question, when the request is sensitive, or when the model cites outside hits', async () => {
    const { repository } = await seededRepository()
    const model = { generateStructured: vi.fn().mockResolvedValue({ answer: '臆测答案', citationItemIds: ['not-a-hit'], missingInformation: [] }) }
    await expect(answerKnowledge({ repository, createModelClient: () => model }, '请给我赔偿联系电话', context)).resolves.toMatchObject({ decision: 'handoff', answer: null, reason: 'SENSITIVE_REQUEST' })
    await expect(answerKnowledge({ repository, createModelClient: () => model }, '不存在的工艺怎么处理？', context)).resolves.toMatchObject({ decision: 'handoff', answer: null, reason: 'KNOWLEDGE_NOT_COVERED' })
    await expect(answerKnowledge({ repository, createModelClient: () => model }, '尺寸超差后怎么处理？', context)).resolves.toMatchObject({ decision: 'handoff', answer: null, reason: 'UNSUPPORTED_CITATION' })
  })

  it('fails closed to manual handoff when a model returns malformed structured data', async () => {
    const { repository } = await seededRepository()
    const malformedModel = { generateStructured: vi.fn().mockResolvedValue(undefined) }

    await expect(answerKnowledge({ repository, createModelClient: () => malformedModel }, '尺寸超差后怎么处理？', context))
      .resolves.toMatchObject({ decision: 'handoff', answer: null, reason: 'MODEL_FAILED' })
  })
})
