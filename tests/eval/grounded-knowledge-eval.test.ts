import { describe, expect, it, vi } from 'vitest'

import { KnowledgeRepository, InMemoryKnowledgeAdapter } from '../../cloudfunctions/agent-api/src/repositories/knowledgeRepository'
import { answerKnowledge } from '../../cloudfunctions/agent-api/src/actions/answerKnowledge'

const actorId = 'quality-manager-1'
const context = { now: '2026-08-20T00:00:00.000Z', actorId, role: 'quality_manager' as const, scope: { products: ['BR-2045'] } }

async function publishedKnowledge() {
  const repository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
  const document = await repository.createDocument(actorId, {
    name: '来料异常 SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/sop.md', version: 'v2',
  })
  await repository.markDocumentParsed(document.id, actorId)
  const [chunk] = await repository.saveChunks(document.id, actorId, [{
    sequence: 1, text: '发现尺寸超差时，先冻结疑似库存并保留样件。', charStart: 0, charEnd: 22, heading: '临时遏制',
  }])
  const item = await repository.createItem(actorId, {
    type: 'qa', title: '尺寸超差临时遏制', content: { question: '尺寸超差后如何临时遏制？', answer: '先冻结疑似库存并保留样件。' },
    sourceDocumentId: document.id, sourceChunkIds: [chunk.id], owner: '质量部', scope: { products: ['BR-2045'] }, visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z',
  })
  await repository.reviewItem(item.id, 'knowledge-owner-1', 'published')
  return { repository, document, item }
}

describe('grounded knowledge and handoff evaluation', () => {
  it('answers a covered complaint question only with a published, traceable source', async () => {
    const { repository, document, item } = await publishedKnowledge()
    const result = await answerKnowledge({
      repository,
      createModelClient: () => ({ generateStructured: async <T>() => ({ answer: '先冻结疑似库存并保留样件。', citationItemIds: [item.id], missingInformation: ['受影响数量'] } as T) }),
    }, '尺寸超差后如何临时遏制？', context)

    expect(result).toEqual(expect.objectContaining({
      decision: 'answer', answer: '先冻结疑似库存并保留样件。',
      citations: [expect.objectContaining({ itemId: item.id, documentId: document.id, documentName: document.name, version: 'v2' })],
      missingInformation: ['受影响数量'],
    }))
  })

  it('does not invoke a model when the knowledge is absent, sensitive, or expired', async () => {
    const { repository, document } = await publishedKnowledge()
    const model = vi.fn().mockResolvedValue({ answer: '不应生成', citationItemIds: [], missingInformation: [] })
    const dependencies = { repository, createModelClient: () => ({ generateStructured: model }) }

    await expect(answerKnowledge(dependencies, '未知工艺如何处理？', context)).resolves.toMatchObject({ decision: 'handoff', reason: 'KNOWLEDGE_NOT_COVERED', answer: null })
    await expect(answerKnowledge(dependencies, '请提供赔偿电话', context)).resolves.toMatchObject({ decision: 'handoff', reason: 'SENSITIVE_REQUEST', answer: null })
    await repository.markDocumentStatus(document.id, actorId, 'expired')
    await expect(answerKnowledge(dependencies, '尺寸超差后如何临时遏制？', context)).resolves.toMatchObject({ decision: 'handoff', reason: 'KNOWLEDGE_NOT_COVERED', answer: null })
    expect(model).not.toHaveBeenCalled()
  })
})
