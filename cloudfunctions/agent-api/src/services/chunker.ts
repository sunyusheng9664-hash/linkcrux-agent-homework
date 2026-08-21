import { KnowledgeChunkSchema, type KnowledgeChunk } from '../../../../src/contracts/knowledge'

export const KNOWLEDGE_CHUNK_SIZE = 800
export const KNOWLEDGE_CHUNK_OVERLAP = 120

export type KnowledgeChunkDraft = Omit<KnowledgeChunk, 'id' | 'documentId'>

export function chunkText(input: string): KnowledgeChunkDraft[] {
  const text = input.trim()
  if (!text) throw new Error('DOCUMENT_EMPTY')

  const chunks: KnowledgeChunkDraft[] = []
  let charStart = 0
  let sequence = 1
  while (charStart < text.length) {
    const charEnd = Math.min(charStart + KNOWLEDGE_CHUNK_SIZE, text.length)
    const parsed = KnowledgeChunkSchema.parse({
      id: 'draft', documentId: 'draft',
      sequence,
      text: text.slice(charStart, charEnd),
      charStart,
      charEnd,
    })
    const { id: _id, documentId: _documentId, ...chunk } = parsed
    chunks.push(chunk)
    if (charEnd === text.length) break
    charStart = charEnd - KNOWLEDGE_CHUNK_OVERLAP
    sequence += 1
  }
  return chunks
}
