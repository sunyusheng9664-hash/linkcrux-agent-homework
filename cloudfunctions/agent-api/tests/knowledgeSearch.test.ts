import { describe, expect, it } from 'vitest'

import { searchKnowledge } from '../src/services/knowledgeSearch'
import { KnowledgeRepository, InMemoryKnowledgeAdapter, type KnowledgeRetrievalContext } from '../src/repositories/knowledgeRepository'

async function seededRepository() {
  const adapter = new InMemoryKnowledgeAdapter()
  const repository = new KnowledgeRepository(adapter)
  const document = await repository.createDocument('knowledge-owner-1', {
    name: '来料异常 SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document',
    originalFileId: 'cloud://knowledge/sop.md', version: 'v2',
  })
  await repository.markDocumentParsed(document.id, 'knowledge-owner-1')
  const [chunk] = await repository.saveChunks(document.id, 'knowledge-owner-1', [{
    sequence: 1, text: '发现尺寸超差时，先冻结疑似库存并保留样件。', charStart: 0, charEnd: 22, heading: '临时遏制',
  }])
  const item = await repository.createItem('knowledge-owner-1', {
    type: 'qa', title: '尺寸超差后如何遏制', content: { question: '尺寸超差时怎么办？', answer: '先冻结疑似库存并保留样件。' },
    sourceDocumentId: document.id, sourceChunkIds: [chunk.id], owner: '质量部', scope: { products: ['BR-2045'] },
    visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z',
  })
  await repository.reviewItem(item.id, 'knowledge-owner-1', 'published')
  return { repository, document, item, chunk }
}

describe('searchKnowledge', () => {
  it('only searches already retrievable knowledge and returns traceable citations', async () => {
    const { repository, document, item, chunk } = await seededRepository()
    const context: KnowledgeRetrievalContext = {
      now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'quality_manager', scope: { products: ['BR-2045'] },
    }
    await expect(repository.listRetrievable(context)).resolves.toEqual([expect.objectContaining({ id: item.id })])
    await expect(repository.getCitationSource(item)).resolves.toMatchObject({ documentId: document.id, chunks: [expect.objectContaining({ id: chunk.id })] })
    const hits = await searchKnowledge(repository, '冻结库存', context)
    expect(hits).toEqual([expect.objectContaining({
      item: expect.objectContaining({ id: item.id, status: 'published' }),
      citation: expect.objectContaining({ documentId: document.id, documentName: document.name, version: 'v2', chunks: [expect.objectContaining({ id: chunk.id, sequence: 1 })] }),
    })])
  })

  it('lets a knowledge owner inherit quality-manager visibility but still excludes an expired source', async () => {
    const { repository, document } = await seededRepository()
    const context = { now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'knowledge_owner' as const, scope: { products: ['BR-2045'] } }
    await expect(searchKnowledge(repository, '冻结库存', context)).resolves.toEqual([expect.objectContaining({ item: expect.objectContaining({ status: 'published' }) })])
    await repository.markDocumentStatus(document.id, 'knowledge-owner-1', 'expired')
    await expect(searchKnowledge(repository, '冻结库存', { ...context, role: 'quality_manager' })).resolves.toEqual([])
  })
})
