import { z } from 'zod'

import type { KnowledgeRetrievalContext, KnowledgeRepository } from '../repositories/knowledgeRepository'
import { buildGroundedAnswerMessages } from '../prompts/groundedAnswer'
import { searchKnowledge, type SearchHit } from '../services/knowledgeSearch'
import type { ModelClient } from '../services/modelClient'

const GroundedAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(2000),
  citationItemIds: z.array(z.string().min(1)).min(1).max(3),
  missingInformation: z.array(z.string().trim().min(1)).max(10),
}).strict()

export type KnowledgeAnswer = {
  decision: 'answer' | 'handoff'
  answer: string | null
  citations: Array<{ itemId: string; documentId: string; documentName: string; version: string; chunkIds: string[] }>
  missingInformation: string[]
  reason?: 'HIGH_RISK' | 'SENSITIVE_REQUEST' | 'KNOWLEDGE_NOT_COVERED' | 'UNSUPPORTED_CITATION' | 'MODEL_FAILED'
}

export async function answerKnowledge(
  deps: { repository: KnowledgeRepository; createModelClient: () => Pick<ModelClient, 'generateStructured'> },
  query: string,
  context: KnowledgeRetrievalContext,
  options?: { referenceOnly?: boolean },
): Promise<KnowledgeAnswer> {
  if (isSensitive(query)) return handoff('SENSITIVE_REQUEST')
  const hits = await searchKnowledge(deps.repository, query, context)
  if (!hits.length) return handoff('KNOWLEDGE_NOT_COVERED')
  if (options?.referenceOnly) {
    return {
      decision: 'answer',
      answer: hits.map((hit, index) => `参考 ${index + 1}：${referenceText(hit)}`).join('\n'),
      citations: hits.map(citation),
      missingInformation: [],
    }
  }
  let generated: z.infer<typeof GroundedAnswerSchema>
  try {
    generated = GroundedAnswerSchema.parse(await deps.createModelClient().generateStructured(GroundedAnswerSchema, buildGroundedAnswerMessages(query, hits)))
  } catch {
    return handoff('MODEL_FAILED')
  }
  const referenced = new Map(hits.map((hit) => [hit.item.id, hit]))
  if (!generated.citationItemIds.every((id) => referenced.has(id))) return handoff('UNSUPPORTED_CITATION')
  return {
    decision: 'answer', answer: generated.answer, missingInformation: generated.missingInformation,
    citations: generated.citationItemIds.map((itemId) => citation(referenced.get(itemId)!)),
  }
}

function citation(hit: SearchHit): KnowledgeAnswer['citations'][number] {
  return { itemId: hit.item.id, documentId: hit.citation.documentId, documentName: hit.citation.documentName, version: hit.citation.version, chunkIds: hit.citation.chunks.map((chunk) => chunk.id) }
}
function referenceText(hit: SearchHit): string {
  const { content } = hit.item
  switch (hit.item.type) {
    case 'qa': return content.answer
    case 'procedure': return content.steps.map((step, index) => `${index + 1}. ${step}`).join('；')
    case 'rule': return `适用条件：${content.when}；要求：${content.then}`
    case 'navigation': return `${content.system}：${content.path.join(' → ')}`
    case 'script': return `${content.scenario}：${content.script}`
    case 'case': return `${content.summary}；经验：${content.lessons.join('；')}`
  }
}
function handoff(reason: NonNullable<KnowledgeAnswer['reason']>): KnowledgeAnswer { return { decision: 'handoff', answer: null, citations: [], missingInformation: [], reason } }
function isSensitive(query: string): boolean { return /(?:电话|手机号|邮箱|微信|账号|密码|赔偿|补偿|责任归属|是否召回|召回决定)/i.test(query) }
