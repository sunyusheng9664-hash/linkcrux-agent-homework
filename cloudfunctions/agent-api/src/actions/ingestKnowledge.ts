import { z } from 'zod'

import { KnowledgeItemSchema, KnowledgeSourceTypeSchema, KnowledgeVisibilitySchema, type Document, type KnowledgeChunk, type KnowledgeItem, type KnowledgeScope } from '../../../../src/contracts/knowledge'
import { buildDraftKnowledgeItemMessages } from '../prompts/draftKnowledgeItems'
import { KnowledgeRepository } from '../repositories/knowledgeRepository'
import type { ModelClient } from '../services/modelClient'
import { chunkText } from '../services/chunker'
import { parseDocument } from '../services/documentParser'

const DraftKnowledgeItemBaseSchema = z.object({
  title: z.string().trim().min(1),
  sourceChunkSequences: z.array(z.number().int().positive()).min(1).max(3),
}).strict()

const DraftKnowledgeItemSchema = z.discriminatedUnion('type', [
  DraftKnowledgeItemBaseSchema.extend({
    type: z.literal('qa'),
    content: z.object({ question: z.string().trim().min(1), answer: z.string().trim().min(1) }).strict(),
  }),
  DraftKnowledgeItemBaseSchema.extend({
    type: z.literal('procedure'),
    content: z.object({ steps: z.array(z.string().trim().min(1)).min(1) }).strict(),
  }),
  DraftKnowledgeItemBaseSchema.extend({
    type: z.literal('rule'),
    content: z.object({ when: z.string().trim().min(1), then: z.string().trim().min(1) }).strict(),
  }),
  DraftKnowledgeItemBaseSchema.extend({
    type: z.literal('navigation'),
    content: z.object({ system: z.string().trim().min(1), path: z.array(z.string().trim().min(1)).min(1) }).strict(),
  }),
  DraftKnowledgeItemBaseSchema.extend({
    type: z.literal('script'),
    content: z.object({ scenario: z.string().trim().min(1), script: z.string().trim().min(1) }).strict(),
  }),
  DraftKnowledgeItemBaseSchema.extend({
    type: z.literal('case'),
    content: z.object({ summary: z.string().trim().min(1), lessons: z.array(z.string().trim().min(1)).min(1) }).strict(),
  }),
])

const DraftKnowledgeItemsSchema = z.object({
  items: z.array(DraftKnowledgeItemSchema).min(1).max(12),
}).strict()

export type IngestKnowledgeDependencies = {
  repository: KnowledgeRepository
  createModelClient: () => Pick<ModelClient, 'generateStructured'>
}

export type IngestKnowledgeInput = {
  actorId: string
  name: string
  mimeType: string
  sourceType: z.input<typeof KnowledgeSourceTypeSchema>
  originalFileId: string
  version: string
  buffer: Buffer
  owner: string
  scope: KnowledgeScope
  visibility: z.input<typeof KnowledgeVisibilitySchema>
  effectiveAt: string
  expiresAt?: string
}

export async function ingestKnowledge(deps: IngestKnowledgeDependencies, input: IngestKnowledgeInput): Promise<{
  document: Document
  chunks: KnowledgeChunk[]
  items: KnowledgeItem[]
}> {
  const document = await deps.repository.createDocument(input.actorId, {
    name: input.name,
    mimeType: input.mimeType,
    sourceType: input.sourceType,
    originalFileId: input.originalFileId,
    version: input.version,
  })
  let text: string
  try {
    text = await parseDocument(input.buffer, input.mimeType)
  } catch (error) {
    await deps.repository.markDocumentStatus(document.id, input.actorId, 'failed')
    throw error
  }

  await deps.repository.markDocumentParsed(document.id, input.actorId)
  const chunks = await deps.repository.saveChunks(document.id, input.actorId, chunkText(text))
  try {
    const draft = await deps.createModelClient().generateStructured(
      DraftKnowledgeItemsSchema,
      buildDraftKnowledgeItemMessages({ documentName: document.name, sourceType: document.sourceType, chunks }),
    )
    const chunksBySequence = new Map(chunks.map((chunk) => [chunk.sequence, chunk]))
    const candidateInputs = draft.items.map((candidate) => {
      const sourceChunkIds = candidate.sourceChunkSequences.map((sequence) => chunksBySequence.get(sequence)?.id)
      if (sourceChunkIds.some((id) => !id)) throw new Error('KNOWLEDGE_DRAFT_INVALID')
      const itemInput = {
        type: candidate.type,
        title: candidate.title,
        content: candidate.content,
        sourceDocumentId: document.id,
        sourceChunkIds,
        owner: input.owner,
        scope: input.scope,
        visibility: input.visibility,
        status: 'pending_review',
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
      }
      const preview = KnowledgeItemSchema.safeParse({
        ...itemInput, id: 'preview', createdBy: input.actorId,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      })
      if (!preview.success) throw new Error('KNOWLEDGE_DRAFT_INVALID')
      return itemInput
    })
    const items: KnowledgeItem[] = []
    for (const itemInput of candidateInputs) items.push(await deps.repository.createItem(input.actorId, itemInput))
    return { document: await deps.repository.getDocument(document.id, input.actorId), chunks, items }
  } catch (error) {
    await deps.repository.discardItemsForDocument(document.id, input.actorId)
    await deps.repository.markDocumentStatus(document.id, input.actorId, 'failed')
    throw error
  }
}
