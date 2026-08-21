import MiniSearch from 'minisearch'

import type { KnowledgeItem } from '../../../../src/contracts/knowledge'
import type { KnowledgeRepository, KnowledgeRetrievalContext, KnowledgeCitationSource } from '../repositories/knowledgeRepository'

export type SearchHit = {
  item: KnowledgeItem
  score: number
  citation: KnowledgeCitationSource
}

export async function searchKnowledge(repository: KnowledgeRepository, query: string, context: KnowledgeRetrievalContext): Promise<SearchHit[]> {
  const items = await repository.listRetrievable(context)
  if (!query.trim() || !items.length) return []
  const tokenize = (text: string) => [...text.toLocaleLowerCase()].filter((character) => !/\s/.test(character))
  const search = new MiniSearch<{ id: string; title: string; body: string }>({
    idField: 'id', fields: ['title', 'body'], storeFields: ['id'], searchOptions: { prefix: true },
    tokenize,
  })
  search.addAll(items.map((item) => ({ id: item.id, title: item.title, body: contentText(item.content) })))
  const byId = new Map(items.map((item) => [item.id, item]))
  const bm25Results = search.search(query, { prefix: true, tokenize })
  // MiniSearch's default word tokenizer has no useful segmentation for compact Chinese text in some runtimes.
  // Retain its BM25 score and augment it with a bounded Chinese character-overlap fallback.
  const fallback = fallbackResults(items, query)
  if (!fallback.length) return []
  const eligibleIds = new Set(fallback.map((result) => result.id))
  const byResultId = new Map<string, { id: string; score: number }>()
  for (const result of [...bm25Results.filter((result) => eligibleIds.has(String(result.id))), ...fallback]) {
    const id = String(result.id)
    const previous = byResultId.get(id)
    if (!previous || result.score > previous.score) byResultId.set(id, { id, score: result.score })
  }
  const results = [...byResultId.values()].sort((left, right) => right.score - left.score).slice(0, 3)
  const resolved = await Promise.all(results.flatMap(async (result) => {
    const item = byId.get(String(result.id))
    if (!item) return []
    try {
      return [{ item, score: result.score, citation: await repository.getCitationSource(item) }]
    } catch {
      return []
    }
  }))
  return resolved.flat()
}

function contentText(content: KnowledgeItem['content']): string {
  return Object.values(content).flatMap((value) => Array.isArray(value) ? value : [value]).join(' ')
}

function fallbackResults(items: KnowledgeItem[], query: string): Array<{ id: string; score: number }> {
  const terms = [...query.toLocaleLowerCase()].filter((character) => /[\p{L}\p{N}]/u.test(character))
  return items
    .map((item) => ({ id: item.id, score: terms.reduce((score, term) => score + Number((`${item.title} ${contentText(item.content)}`).toLocaleLowerCase().includes(term)), 0) }))
    .filter((result) => result.score >= 3)
    .sort((left, right) => right.score - left.score)
}
