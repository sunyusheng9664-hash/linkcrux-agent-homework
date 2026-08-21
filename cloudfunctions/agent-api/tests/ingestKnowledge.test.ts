import { describe, expect, it, vi } from 'vitest'

import { ingestKnowledge } from '../src/actions/ingestKnowledge'
import { KnowledgeRepository, InMemoryKnowledgeAdapter } from '../src/repositories/knowledgeRepository'
import { ModelClient } from '../src/services/modelClient'

describe('ingestKnowledge', () => {
  it('parses a document and saves every model-generated card as pending review with source citations', async () => {
    const repository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
    const generateStructured = vi.fn().mockResolvedValue({
      items: [{ type: 'procedure', title: '尺寸超差临时遏制', content: { steps: ['冻结疑似库存', '保留样件'] }, sourceChunkSequences: [1] }],
    })

    const result = await ingestKnowledge({ repository, createModelClient: () => ({ generateStructured }) }, {
      actorId: 'quality-manager-1', name: '来料尺寸异常 SOP.md', mimeType: 'text/markdown',
      sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/sop-v1.md', version: 'v1',
      buffer: Buffer.from('# 临时遏制\n发现尺寸超差时，先冻结疑似库存并保留样件。'),
      owner: '质量部', scope: { products: ['BR-2045'] }, visibility: 'quality_manager',
      effectiveAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z',
    })

    expect(result.document).toMatchObject({ status: 'parsed', name: '来料尺寸异常 SOP.md' })
    expect(result.chunks).toHaveLength(1)
    expect(result.items).toEqual([expect.objectContaining({
      status: 'pending_review', sourceDocumentId: result.document.id, sourceChunkIds: [result.chunks[0].id],
    })])
    expect(generateStructured).toHaveBeenCalledOnce()
  })

  it('asks the model to repair a candidate whose content does not match its type', async () => {
    const repository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          items: [{ type: 'procedure', title: '尺寸超差临时遏制', content: { answer: '冻结疑似库存' }, sourceChunkSequences: [1] }],
        }) } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          items: [{ type: 'procedure', title: '尺寸超差临时遏制', content: { steps: ['冻结疑似库存', '保留样件'] }, sourceChunkSequences: [1] }],
        }) } }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await ingestKnowledge({
        repository,
        createModelClient: () => new ModelClient({ baseUrl: 'https://model.example.test/v1', apiKey: 'test-key', model: 'test-model' }),
      }, {
        actorId: 'quality-manager-1', name: '来料尺寸异常 SOP.md', mimeType: 'text/markdown',
        sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/sop-v1.md', version: 'v1',
        buffer: Buffer.from('发现尺寸超差时，先冻结疑似库存并保留样件。'),
        owner: '质量部', scope: {}, visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z',
      })

      expect(result.items).toEqual([expect.objectContaining({
        type: 'procedure', content: { steps: ['冻结疑似库存', '保留样件'] }, status: 'pending_review',
      })])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('marks the retained document as failed and does not create knowledge cards when parsing fails', async () => {
    const repository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())

    await expect(ingestKnowledge({ repository, createModelClient: () => ({ generateStructured: vi.fn() }) }, {
      actorId: 'quality-manager-1', name: '加密 SOP.pdf', mimeType: 'application/pdf', sourceType: 'enterprise_document',
      originalFileId: 'cloud://knowledge/encrypted.pdf', version: 'v1', buffer: Buffer.from('%PDF-1.4\n/Encrypt 7 0 R'),
      owner: '质量部', scope: {}, visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z',
    })).rejects.toThrow('DOCUMENT_ENCRYPTED')

    const [document] = await repository.listDocuments('quality-manager-1')
    expect(document).toMatchObject({ status: 'failed', name: '加密 SOP.pdf' })
    await expect(repository.listRetrievable({ now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'quality_manager', scope: {} })).resolves.toEqual([])
  })

  it('does not persist a partial set of candidate cards when any model proposal is invalid', async () => {
    const adapter = new InMemoryKnowledgeAdapter()
    const repository = new KnowledgeRepository(adapter)

    await expect(ingestKnowledge({ repository, createModelClient: () => ({ generateStructured: vi.fn().mockResolvedValue({
      items: [
        { type: 'procedure', title: '有效候选', content: { steps: ['冻结库存'] }, sourceChunkSequences: [1] },
        { type: 'procedure', title: '无效候选', content: { steps: [] }, sourceChunkSequences: [1] },
      ],
    }) }) }, {
      actorId: 'quality-manager-1', name: 'SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document',
      originalFileId: 'cloud://knowledge/sop.md', version: 'v1', buffer: Buffer.from('冻结库存'), owner: '质量部',
      scope: {}, visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z',
    })).rejects.toThrow()

    await expect(adapter.findItems()).resolves.toEqual([])
  })

  it('marks the source failed and removes earlier cards if persistence fails mid-batch', async () => {
    const adapter = new InMemoryKnowledgeAdapter()
    const repository = new KnowledgeRepository(adapter)
    const originalCreateItem = repository.createItem.bind(repository)
    vi.spyOn(repository, 'createItem')
      .mockImplementationOnce(originalCreateItem)
      .mockRejectedValueOnce(new Error('STORAGE_WRITE_FAILED'))

    await expect(ingestKnowledge({ repository, createModelClient: () => ({ generateStructured: vi.fn().mockResolvedValue({
      items: [
        { type: 'procedure', title: '候选一', content: { steps: ['冻结库存'] }, sourceChunkSequences: [1] },
        { type: 'procedure', title: '候选二', content: { steps: ['保留样件'] }, sourceChunkSequences: [1] },
      ],
    }) }) }, {
      actorId: 'quality-manager-1', name: 'SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document',
      originalFileId: 'cloud://knowledge/sop.md', version: 'v1', buffer: Buffer.from('冻结库存'), owner: '质量部',
      scope: {}, visibility: 'quality_manager', effectiveAt: '2026-08-01T00:00:00.000Z',
    })).rejects.toThrow('STORAGE_WRITE_FAILED')

    await expect(adapter.findItems()).resolves.toEqual([])
    await expect(repository.listDocuments('quality-manager-1')).resolves.toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
  })
})
