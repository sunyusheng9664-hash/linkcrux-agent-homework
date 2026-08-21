import type { CaseFacts } from '../contracts/case'
import { evaluateHardRisk } from './risk'

export type ComplaintScopeDecision =
  | { decision: 'answer'; reason: 'IN_SCOPE' }
  | { decision: 'ask'; reason: 'INFORMATION_INSUFFICIENT'; missingFields: Array<keyof CaseFacts> }
  | { decision: 'handoff'; reason: 'OUT_OF_SCOPE' | 'SYSTEM_QUERY_REQUIRED'; suggestedTeam: string }
  | { decision: 'urgent_handoff'; reason: 'HIGH_RISK'; suggestedTeam: string }

export function routeComplaintScope(input: { content: string; facts?: CaseFacts }): ComplaintScopeDecision {
  if (/(?:报价|价格|合同模板|采购询价|赔偿|补偿|电话|邮箱|微信)/u.test(input.content)) return { decision: 'handoff', reason: 'OUT_OF_SCOPE', suggestedTeam: '销售、合同或客户服务团队' }
  if (/(?:整批|全数).{0,8}(?:失效|报废|不良)/u.test(input.content)) return { decision: 'urgent_handoff', reason: 'HIGH_RISK', suggestedTeam: '质量与生产应急响应' }
  if (evaluateHardRisk(input.facts ?? {}, input.content).length) return { decision: 'urgent_handoff', reason: 'HIGH_RISK', suggestedTeam: '质量与生产应急响应' }
  const missingFields = (['product', 'batch', 'defect'] as const).filter((field) => !input.facts?.[field]?.trim())
  if (missingFields.length) return { decision: 'ask', reason: 'INFORMATION_INSUFFICIENT', missingFields }
  if (/(?:ERP|MES|系统查询|订单状态)/iu.test(input.content)) return { decision: 'handoff', reason: 'SYSTEM_QUERY_REQUIRED', suggestedTeam: '信息系统或业务运营团队' }
  return { decision: 'answer', reason: 'IN_SCOPE' }
}
