import { describe, expect, it } from 'vitest'

import { reviewKnowledgeItem } from '../src/actions/reviewKnowledgeItem'
import { KnowledgeRepository, InMemoryKnowledgeAdapter } from '../src/repositories/knowledgeRepository'

async function createPendingItem() {
  const repository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
  const document = await repository.createDocument('quality-manager-1', {
    name: 'SOP.txt', mimeType: 'text/plain', sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/sop.txt', version: 'v1',
  })
  await repository.markDocumentParsed(document.id, 'quality-manager-1')
  const [chunk] = await repository.saveChunks(document.id, 'quality-manager-1', [{ sequence: 1, text: '先冻结疑似库存。', charStart: 0, charEnd: 9 }])
  const item = await repository.createItem('quality-manager-1', {
    type: 'qa', title: '是否冻结库存', content: { question: '尺寸异常是否先冻结库存？', answer: '先冻结疑似库存。' },
    sourceDocumentId: document.id, sourceChunkIds: [chunk.id], owner: '质量部', scope: {}, visibility: 'quality_manager',
    status: 'pending_review', effectiveAt: '2026-08-01T00:00:00.000Z',
  })
  return { repository, document, item }
}

describe('reviewKnowledgeItem', () => {
  it('allows only a knowledge owner to publish an explicitly reviewed pending item', async () => {
    const { repository, item } = await createPendingItem()

    await expect(reviewKnowledgeItem({ repository }, item.id, { status: 'published' }, { userId: 'quality-manager-1', role: 'quality_manager' }))
      .rejects.toThrow('FORBIDDEN')
    const published = await reviewKnowledgeItem({ repository }, item.id, { status: 'published' }, { userId: 'knowledge-owner-1', role: 'knowledge_owner' })

    expect(published).toMatchObject({ status: 'published', reviewedBy: 'knowledge-owner-1' })
    await expect(repository.listRetrievable({ now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'quality_manager', scope: {} }))
      .resolves.toEqual([expect.objectContaining({ id: item.id })])
  })

  it('impacts published items immediately when their source document is superseded', async () => {
    const { repository, document, item } = await createPendingItem()
    await reviewKnowledgeItem({ repository }, item.id, { status: 'published' }, { userId: 'knowledge-owner-1', role: 'knowledge_owner' })

    await repository.markDocumentStatus(document.id, 'quality-manager-1', 'superseded')

    await expect(repository.getItem(item.id)).resolves.toMatchObject({ status: 'impacted' })
    await expect(repository.listRetrievable({ now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'quality_manager', scope: {} })).resolves.toEqual([])
  })
})
