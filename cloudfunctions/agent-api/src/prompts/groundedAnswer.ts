import type { ModelMessage } from '../services/modelClient'
import type { SearchHit } from '../services/knowledgeSearch'

export function buildGroundedAnswerMessages(query: string, hits: SearchHit[]): ModelMessage[] {
  return [
    { role: 'system', content: '你是企业知识问答助手。只能依据提供的已审核资料回答，不能补充资料外事实、联系方式、账号、赔偿、责任、召回结论或企业策略。只返回 JSON：answer、citationItemIds、missingInformation。citationItemIds 只能使用提供的知识条目 ID；信息不足时在 missingInformation 说明。' },
    { role: 'user', content: JSON.stringify({ query, sources: hits.map((hit) => ({ itemId: hit.item.id, title: hit.item.title, content: hit.item.content, citation: hit.citation })) }) },
  ]
}
