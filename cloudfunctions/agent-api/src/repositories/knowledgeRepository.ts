import {
  DocumentSchema,
  KnowledgeChunkSchema,
  KnowledgeItemSchema,
  type Document,
  type KnowledgeChunk,
  type KnowledgeItem,
  type KnowledgeScope,
  type KnowledgeVisibility,
} from '../../../../src/contracts/knowledge'
import type { KnowledgeChunkDraft } from '../services/chunker'

export interface KnowledgePersistenceAdapter {
  insertDocument(document: Document): Promise<void>
  findDocument(id: string): Promise<Document | undefined>
  findDocuments(createdBy: string): Promise<Document[]>
  insertChunks(chunks: KnowledgeChunk[]): Promise<void>
  findChunks(documentId: string): Promise<KnowledgeChunk[]>
  insertItem(item: KnowledgeItem): Promise<void>
  findItem(id: string): Promise<KnowledgeItem | undefined>
  findItems(): Promise<KnowledgeItem[]>
  deleteItemsByDocumentId(documentId: string): Promise<void>
}

export type KnowledgeRetrievalContext = {
  now: string
  actorId: string
  role: KnowledgeVisibility
  scope: KnowledgeScope
}

export type KnowledgeCitationSource = {
  documentId: string
  documentName: string
  version: string
  chunks: KnowledgeChunk[]
}

export class KnowledgeRepository {
  constructor(private readonly adapter: KnowledgePersistenceAdapter) {}

  async createDocument(createdBy: string, input: unknown): Promise<Document> {
    const now = new Date().toISOString()
    const document = DocumentSchema.parse({ ...asRecord(input), id: createId('document'), status: 'uploaded', createdBy, createdAt: now, updatedAt: now })
    await this.adapter.insertDocument(document)
    return document
  }

  async getDocument(id: string, actorId: string): Promise<Document> {
    const document = await this.adapter.findDocument(id)
    if (!document || document.createdBy !== actorId) throw new Error('DOCUMENT_NOT_FOUND')
    return DocumentSchema.parse(document)
  }

  async listDocuments(actorId: string): Promise<Document[]> {
    return DocumentSchema.array().parse(await this.adapter.findDocuments(actorId))
  }

  async markDocumentParsed(id: string, actorId: string): Promise<Document> {
    return this.markDocumentStatus(id, actorId, 'parsed')
  }

  async markDocumentStatus(id: string, actorId: string, status: 'parsed' | 'failed' | 'superseded' | 'expired'): Promise<Document> {
    const current = await this.getDocument(id, actorId)
    const next = DocumentSchema.parse({ ...current, status, updatedAt: new Date().toISOString() })
    await this.adapter.insertDocument(next)
    if (status === 'superseded' || status === 'expired') await this.impactDerivedItems(id)
    return next
  }

  async saveChunks(documentId: string, actorId: string, drafts: KnowledgeChunkDraft[]): Promise<KnowledgeChunk[]> {
    const document = await this.getDocument(documentId, actorId)
    if (document.status !== 'parsed') throw new Error('DOCUMENT_STATE_INVALID')
    const chunks = KnowledgeChunkSchema.array().parse(drafts.map((draft) => ({ ...draft, id: createId('chunk'), documentId })))
    await this.adapter.insertChunks(chunks)
    return chunks
  }

  async listChunks(documentId: string, actorId: string): Promise<KnowledgeChunk[]> {
    await this.getDocument(documentId, actorId)
    return KnowledgeChunkSchema.array().parse(await this.adapter.findChunks(documentId))
  }

  async createItem(createdBy: string, input: unknown): Promise<KnowledgeItem> {
    const now = new Date().toISOString()
    const raw = asRecord(input)
    const { status: _status, reviewedBy: _reviewedBy, reviewedAt: _reviewedAt, ...unreviewed } = raw
    const item = KnowledgeItemSchema.parse({
      ...unreviewed, id: createId('knowledge'), status: 'pending_review', createdBy, createdAt: now, updatedAt: now,
    })
    const document = await this.getDocument(item.sourceDocumentId, createdBy)
    if (document.status !== 'parsed') throw new Error('DOCUMENT_STATE_INVALID')
    const knownChunkIds = new Set((await this.adapter.findChunks(item.sourceDocumentId)).map((chunk) => chunk.id))
    if (!item.sourceChunkIds.every((id) => knownChunkIds.has(id))) throw new Error('KNOWLEDGE_SOURCE_INVALID')
    await this.adapter.insertItem(item)
    return item
  }

  async getItem(id: string): Promise<KnowledgeItem> {
    const item = await this.adapter.findItem(id)
    if (!item) throw new Error('KNOWLEDGE_ITEM_NOT_FOUND')
    return KnowledgeItemSchema.parse(item)
  }

  async listPendingReview(): Promise<KnowledgeItem[]> {
    return KnowledgeItemSchema.array().parse(await this.adapter.findItems()).filter((item) => item.status === 'pending_review')
  }

  async reviewItem(id: string, reviewerId: string, status: 'published' | 'rejected', rejectionReason?: string): Promise<KnowledgeItem> {
    const item = await this.getItem(id)
    if (item.status !== 'pending_review') throw new Error('KNOWLEDGE_REVIEW_STATE_INVALID')
    if (status === 'published') {
      const sourceDocument = DocumentSchema.safeParse(await this.adapter.findDocument(item.sourceDocumentId))
      if (!sourceDocument.success || sourceDocument.data.status !== 'parsed') throw new Error('KNOWLEDGE_SOURCE_INVALID')
    }
    const now = new Date().toISOString()
    const reviewed = KnowledgeItemSchema.parse({ ...item, status, reviewedBy: reviewerId, reviewedAt: now, updatedAt: now })
    await this.adapter.insertItem(reviewed)
    return reviewed
  }

  async discardItemsForDocument(documentId: string, actorId: string): Promise<void> {
    await this.getDocument(documentId, actorId)
    await this.adapter.deleteItemsByDocumentId(documentId)
  }

  async listRetrievable(context: KnowledgeRetrievalContext): Promise<KnowledgeItem[]> {
    if (!context.actorId) throw new Error('UNAUTHENTICATED')
    const current = Date.parse(context.now)
    if (Number.isNaN(current)) throw new Error('KNOWLEDGE_TIME_INVALID')
    const items = KnowledgeItemSchema.array().parse(await this.adapter.findItems())
    const retrievable: KnowledgeItem[] = []
    for (const item of items) {
      if (item.status !== 'published' || !visibilityAllows(item.visibility, context.role)) continue
      if (Date.parse(item.effectiveAt) > current || (item.expiresAt && current >= Date.parse(item.expiresAt))) continue
      if (!scopeMatches(item.scope, context.scope)) continue
      const document = DocumentSchema.safeParse(await this.adapter.findDocument(item.sourceDocumentId))
      if (!document.success || document.data.status !== 'parsed') continue
      retrievable.push(item)
    }
    return retrievable
  }

  async getCitationSource(item: KnowledgeItem): Promise<KnowledgeCitationSource> {
    const document = await this.adapter.findDocument(item.sourceDocumentId)
    if (!document || document.status !== 'parsed') throw new Error('KNOWLEDGE_SOURCE_INVALID')
    const requested = new Set(item.sourceChunkIds)
    const chunks = (await this.adapter.findChunks(item.sourceDocumentId)).filter((chunk) => requested.has(chunk.id))
    if (chunks.length !== requested.size) throw new Error('KNOWLEDGE_SOURCE_INVALID')
    return { documentId: document.id, documentName: document.name, version: document.version, chunks: KnowledgeChunkSchema.array().parse(chunks) }
  }

  private async impactDerivedItems(documentId: string): Promise<void> {
    const items = KnowledgeItemSchema.array().parse(await this.adapter.findItems())
    const now = new Date().toISOString()
    await Promise.all(items
      .filter((item) => item.sourceDocumentId === documentId && item.status !== 'rejected' && item.status !== 'expired')
      .map((item) => this.adapter.insertItem(KnowledgeItemSchema.parse({ ...item, status: 'impacted', updatedAt: now }))))
  }
}

function scopeMatches(required: KnowledgeScope, actual: KnowledgeScope): boolean {
  return (['factories', 'customers', 'products', 'processes'] as const).every((field) => {
    const expected = required[field]
    if (!expected?.length) return true
    const received = actual[field]
    return Boolean(received?.some((value) => expected.includes(value)))
  })
}

function visibilityAllows(required: KnowledgeVisibility, actual: KnowledgeVisibility): boolean {
  const level: Record<KnowledgeVisibility, number> = { quality_team: 0, quality_manager: 1, knowledge_owner: 2 }
  return level[actual] >= level[required]
}

export class InMemoryKnowledgeAdapter implements KnowledgePersistenceAdapter {
  private readonly documents = new Map<string, Document>()
  private readonly chunks = new Map<string, KnowledgeChunk[]>()
  private readonly items = new Map<string, KnowledgeItem>()

  async insertDocument(document: Document): Promise<void> { this.documents.set(document.id, clone(document)) }
  async findDocument(id: string): Promise<Document | undefined> { const document = this.documents.get(id); return document && clone(document) }
  async findDocuments(createdBy: string): Promise<Document[]> { return [...this.documents.values()].filter((document) => document.createdBy === createdBy).map(clone) }
  async insertChunks(chunks: KnowledgeChunk[]): Promise<void> {
    for (const chunk of chunks) this.chunks.set(chunk.documentId, [...(this.chunks.get(chunk.documentId) ?? []), clone(chunk)])
  }
  async findChunks(documentId: string): Promise<KnowledgeChunk[]> { return (this.chunks.get(documentId) ?? []).map(clone) }
  async insertItem(item: KnowledgeItem): Promise<void> { this.items.set(item.id, clone(item)) }
  async findItem(id: string): Promise<KnowledgeItem | undefined> { const item = this.items.get(id); return item && clone(item) }
  async findItems(): Promise<KnowledgeItem[]> { return [...this.items.values()].map(clone) }
  async deleteItemsByDocumentId(documentId: string): Promise<void> {
    for (const [id, item] of this.items) if (item.sourceDocumentId === documentId) this.items.delete(id)
  }
}

/** Production adapter. CloudBase credentials are resolved only by the server runtime. */
export class CloudBaseKnowledgeAdapter implements KnowledgePersistenceAdapter {
  constructor(private readonly db: any) {}

  async insertDocument(document: Document): Promise<void> {
    const normalized = DocumentSchema.parse(document)
    await this.db.collection('documents').doc(normalized.id).set(toCloudRecord(normalized))
  }

  async findDocument(id: string): Promise<Document | undefined> {
    const result = await this.db.collection('documents').where({ _id: id }).get()
    return result.data[0] ? fromCloudDocument(result.data[0]) : undefined
  }

  async findDocuments(createdBy: string): Promise<Document[]> {
    const result = await this.db.collection('documents').where({ createdBy }).get()
    return DocumentSchema.array().parse(result.data.map(fromCloudDocument))
  }

  async insertChunks(chunks: KnowledgeChunk[]): Promise<void> {
    await Promise.all(chunks.map(async (chunk) => {
      const normalized = KnowledgeChunkSchema.parse(chunk)
      await this.db.collection('knowledge_chunks').doc(normalized.id).set(toCloudRecord(normalized))
    }))
  }

  async findChunks(documentId: string): Promise<KnowledgeChunk[]> {
    const result = await this.db.collection('knowledge_chunks').where({ documentId }).get()
    return KnowledgeChunkSchema.array().parse(result.data.map(fromCloudChunk))
  }

  async insertItem(item: KnowledgeItem): Promise<void> {
    const normalized = KnowledgeItemSchema.parse(item)
    await this.db.collection('knowledge_items').doc(normalized.id).set(toCloudRecord(normalized))
  }

  async findItem(id: string): Promise<KnowledgeItem | undefined> {
    const result = await this.db.collection('knowledge_items').where({ _id: id }).get()
    return result.data[0] ? fromCloudItem(result.data[0]) : undefined
  }

  async findItems(): Promise<KnowledgeItem[]> {
    const result = await this.db.collection('knowledge_items').get()
    return KnowledgeItemSchema.array().parse(result.data.map(fromCloudItem))
  }

  async deleteItemsByDocumentId(documentId: string): Promise<void> {
    await this.db.collection('knowledge_items').where({ sourceDocumentId: documentId }).remove()
  }
}

export function createCloudBaseKnowledgeAdapter(db: unknown): CloudBaseKnowledgeAdapter {
  return new CloudBaseKnowledgeAdapter(db)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('KNOWLEDGE_INPUT_INVALID')
  return value as Record<string, unknown>
}
function createId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}` }
function clone<T>(value: T): T { return structuredClone(value) }
function toCloudRecord<T extends { id: string }>(record: T): Omit<T, 'id'> {
  const { id: _documentReferenceId, ...rest } = record
  return rest
}
function fromCloudDocument(record: Record<string, unknown>): Document {
  const { _id, id: _storedId, ...rest } = record
  return DocumentSchema.parse({ id: String(_id), ...rest })
}
function fromCloudChunk(record: Record<string, unknown>): KnowledgeChunk {
  const { _id, id: _storedId, ...rest } = record
  return KnowledgeChunkSchema.parse({ id: String(_id), ...rest })
}
function fromCloudItem(record: Record<string, unknown>): KnowledgeItem {
  const { _id, id: _storedId, ...rest } = record
  return KnowledgeItemSchema.parse({ id: String(_id), ...rest })
}
