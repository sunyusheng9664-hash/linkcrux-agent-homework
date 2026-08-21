import { describe, expect, it, vi } from 'vitest'

import { CloudBaseKnowledgeAdapter, KnowledgeRepository, InMemoryKnowledgeAdapter } from '../src/repositories/knowledgeRepository'

describe('KnowledgeRepository', () => {
  it('uses the document reference id without trying to update CloudBase _id', async () => {
    const rejectCloudBaseIdMutation = (record: Record<string, unknown>) => {
      if ('_id' in record) throw new Error('不能更新_id的值')
      return Promise.resolve({ updated: 1 })
    }
    const setDocument = vi.fn().mockImplementation(rejectCloudBaseIdMutation)
    const setChunk = vi.fn().mockImplementation(rejectCloudBaseIdMutation)
    const setItem = vi.fn().mockImplementation(rejectCloudBaseIdMutation)
    const removeItems = vi.fn().mockResolvedValue({ deleted: 1 })
    const documentWhere = vi.fn()
    const chunkWhere = vi.fn()
    const itemWhere = vi.fn()
    const document = {
      id: 'document-1', name: 'SOP.md', mimeType: 'text/markdown' as const, sourceType: 'enterprise_document' as const,
      originalFileId: 'cloud://knowledge/sop.md', version: 'v1', status: 'parsed' as const, createdBy: 'quality-manager-1',
      createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    }
    const chunk = { id: 'chunk-1', documentId: document.id, sequence: 1, text: '冻结疑似库存。', charStart: 0, charEnd: 7 }
    const item = {
      id: 'knowledge-1', type: 'qa' as const, title: '是否冻结库存', content: { question: '是否冻结？', answer: '冻结疑似库存。' },
      sourceDocumentId: document.id, sourceChunkIds: [chunk.id], owner: '质量部', scope: {}, visibility: 'quality_manager' as const,
      status: 'pending_review' as const, effectiveAt: '2026-08-20T00:00:00.000Z', createdBy: 'quality-manager-1',
      createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    }
    const documents = {
      doc: vi.fn().mockReturnValue({ set: setDocument }),
      where: documentWhere.mockReturnValue({ get: vi.fn().mockResolvedValue({ data: [{ ...document, _id: document.id }] }) }),
    }
    const chunks = {
      doc: vi.fn().mockReturnValue({ set: setChunk }),
      where: chunkWhere.mockReturnValue({ get: vi.fn().mockResolvedValue({ data: [{ ...chunk, _id: chunk.id }] }) }),
    }
    const items = {
      doc: vi.fn().mockReturnValue({ set: setItem }),
      where: itemWhere.mockImplementation((query: Record<string, unknown>) => query.sourceDocumentId
        ? { remove: removeItems }
        : { get: vi.fn().mockResolvedValue({ data: [{ ...item, _id: item.id }] }) }),
      get: vi.fn().mockResolvedValue({ data: [{ ...item, _id: item.id }] }),
    }
    const db = { collection: vi.fn((name: string) => ({ documents, knowledge_chunks: chunks, knowledge_items: items })[name]!) }
    const adapter = new CloudBaseKnowledgeAdapter(db)

    await adapter.insertDocument(document)
    await adapter.insertChunks([chunk])
    await adapter.insertItem(item)

    expect(documents.doc).toHaveBeenCalledWith(document.id)
    expect(setDocument).toHaveBeenCalledWith(expect.not.objectContaining({ id: document.id }))
    expect(setDocument).toHaveBeenCalledWith(expect.not.objectContaining({ _id: expect.anything() }))
    expect(setDocument).toHaveBeenCalledWith(expect.objectContaining({ name: document.name }))
    expect(chunks.doc).toHaveBeenCalledWith(chunk.id)
    expect(setChunk).toHaveBeenCalledWith(expect.not.objectContaining({ _id: expect.anything() }))
    expect(setChunk).toHaveBeenCalledWith(expect.objectContaining({ documentId: document.id }))
    expect(items.doc).toHaveBeenCalledWith(item.id)
    expect(setItem).toHaveBeenCalledWith(expect.not.objectContaining({ _id: expect.anything() }))
    expect(setItem).toHaveBeenCalledWith(expect.objectContaining({ title: item.title }))

    await expect(adapter.findDocument(document.id)).resolves.toEqual(document)
    await expect(adapter.findDocuments(document.createdBy)).resolves.toEqual([document])
    await expect(adapter.findChunks(document.id)).resolves.toEqual([chunk])
    await expect(adapter.findItem(item.id)).resolves.toEqual(item)
    await expect(adapter.findItems()).resolves.toEqual([item])
    await adapter.deleteItemsByDocumentId(document.id)
    expect(documentWhere).toHaveBeenCalledWith({ _id: document.id })
    expect(documentWhere).toHaveBeenCalledWith({ createdBy: document.createdBy })
    expect(chunkWhere).toHaveBeenCalledWith({ documentId: document.id })
    expect(itemWhere).toHaveBeenCalledWith({ _id: item.id })
    expect(itemWhere).toHaveBeenCalledWith({ sourceDocumentId: document.id })
    expect(removeItems).toHaveBeenCalledOnce()
  })

  it('retains source document and chunks while forcing every ingestion item into pending review', async () => {
    const adapter = new InMemoryKnowledgeAdapter()
    const repository = new KnowledgeRepository(adapter)
    const document = await repository.createDocument('quality-manager-1', {
      name: '来料尺寸异常 SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document',
      originalFileId: 'cloud://case-attachments/knowledge/sop-v1.md', version: 'v1',
    })
    await repository.markDocumentParsed(document.id, 'quality-manager-1')
    const chunks = await repository.saveChunks(document.id, 'quality-manager-1', [{
      sequence: 1, text: '发现尺寸超差时，先冻结疑似库存并保留样件。', charStart: 0, charEnd: 22, heading: '临时遏制',
    }])
    const pending = await repository.createItem('quality-manager-1', {
      type: 'procedure', title: '尺寸异常的临时遏制', content: { steps: ['冻结疑似库存', '保留样件'] },
      sourceDocumentId: document.id, sourceChunkIds: [chunks[0].id], owner: '质量部',
      scope: { products: ['BR-2045'] }, visibility: 'quality_manager', status: 'pending_review',
      effectiveAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z',
    })
    const attemptedPublished = await repository.createItem('quality-manager-1', {
      type: 'qa', title: '是否先冻结库存', content: { question: '尺寸异常是否先冻结库存？', answer: '先冻结疑似库存并保留样件。' },
      sourceDocumentId: document.id, sourceChunkIds: [chunks[0].id], owner: '质量部',
      scope: { products: ['BR-2045'] }, visibility: 'quality_team', status: 'published',
      reviewedBy: 'quality-manager-1', reviewedAt: '2026-08-02T00:00:00.000Z',
      effectiveAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z',
    })

    expect(await repository.getDocument(document.id, 'quality-manager-1')).toMatchObject({ name: '来料尺寸异常 SOP.md', version: 'v1' })
    expect(await repository.listChunks(document.id, 'quality-manager-1')).toMatchObject([{ text: expect.stringContaining('冻结疑似库存') }])
    expect(attemptedPublished.status).toBe('pending_review')
    expect(attemptedPublished).not.toHaveProperty('reviewedBy')
    expect(attemptedPublished).not.toHaveProperty('reviewedAt')
    expect(await repository.listRetrievable({ now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'quality_manager', scope: { products: ['BR-2045'] } })).toEqual([])
    expect(pending.status).toBe('pending_review')
  })

  it('excludes published items when the source document is expired, the role is unauthorized, or scope does not match', async () => {
    const adapter = new InMemoryKnowledgeAdapter()
    const repository = new KnowledgeRepository(adapter)
    const document = await repository.createDocument('quality-manager-1', {
      name: '来料尺寸异常 SOP.md', mimeType: 'text/markdown', sourceType: 'enterprise_document',
      originalFileId: 'cloud://case-attachments/knowledge/sop-v1.md', version: 'v1',
    })
    await repository.markDocumentParsed(document.id, 'quality-manager-1')
    const [chunk] = await repository.saveChunks(document.id, 'quality-manager-1', [{
      sequence: 1, text: '发现尺寸超差时，先冻结疑似库存并保留样件。', charStart: 0, charEnd: 22,
    }])
    const item = await repository.createItem('quality-manager-1', {
      type: 'qa', title: '是否先冻结库存', content: { question: '尺寸异常是否先冻结库存？', answer: '先冻结疑似库存并保留样件。' },
      sourceDocumentId: document.id, sourceChunkIds: [chunk.id], owner: '质量部',
      scope: { products: ['BR-2045'] }, visibility: 'quality_manager', status: 'pending_review',
      effectiveAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z',
    })
    await adapter.insertItem({ ...item, status: 'published', reviewedBy: 'quality-manager-1', reviewedAt: '2026-08-02T00:00:00.000Z' })
    const context = { now: '2026-08-20T00:00:00.000Z', actorId: 'quality-manager-1', role: 'quality_manager' as const, scope: { products: ['BR-2045'] } }

    await expect(repository.listRetrievable(context)).resolves.toEqual([expect.objectContaining({ id: item.id })])
    await expect(repository.listRetrievable({ ...context, role: 'knowledge_owner' })).resolves.toEqual([expect.objectContaining({ id: item.id })])
    await expect(repository.listRetrievable({ ...context, scope: { products: ['OTHER-1'] } })).resolves.toEqual([])
    await adapter.insertDocument({ ...document, status: 'expired' })
    await expect(repository.listRetrievable(context)).resolves.toEqual([])
  })

  it('rejects a published item that lacks a human reviewer or traceable source chunks', async () => {
    const repository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
    const document = await repository.createDocument('quality-manager-1', {
      name: 'FAQ.txt', mimeType: 'text/plain', sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/faq.txt', version: 'v1',
    })

    await expect(repository.createItem('quality-manager-1', {
      type: 'qa', title: '错误条目', content: { question: '怎么处理？', answer: '不知道。' },
      sourceDocumentId: document.id, sourceChunkIds: [], owner: '质量部', scope: {}, visibility: 'quality_team',
      status: 'published', effectiveAt: '2026-08-01T00:00:00.000Z',
    })).rejects.toThrow()
  })

  it('requires the document owner and a parsed source before chunks or items can be stored', async () => {
    const repository = new KnowledgeRepository(new InMemoryKnowledgeAdapter())
    const document = await repository.createDocument('quality-manager-1', {
      name: '待处理.txt', mimeType: 'text/plain', sourceType: 'enterprise_document', originalFileId: 'cloud://knowledge/pending.txt', version: 'v1',
    })

    await expect(repository.saveChunks(document.id, 'other-user', [{ sequence: 1, text: '先冻结库存', charStart: 0, charEnd: 5 }])).rejects.toThrow('DOCUMENT_NOT_FOUND')
    await expect(repository.createItem('other-user', {
      type: 'qa', title: '错误越权条目', content: { question: '是否冻结？', answer: '是。' }, sourceDocumentId: document.id,
      sourceChunkIds: ['chunk-1'], owner: '质量部', scope: {}, visibility: 'quality_team', status: 'pending_review', effectiveAt: '2026-08-01T00:00:00.000Z',
    })).rejects.toThrow('DOCUMENT_NOT_FOUND')
  })
})
