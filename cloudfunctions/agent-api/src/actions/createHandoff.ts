import { HandoffPacketSchema, type HandoffPacket, type HandoffReason } from '../../../../src/contracts/handoff'
import { evaluateHardRisk } from '../../../../src/domain/risk'
import { CaseRepository } from '../repositories/caseRepository'

export async function createHandoff(
  deps: { repository: CaseRepository },
  caseId: string,
  actorId: string,
  input: { reason: HandoffReason; searchedKnowledge?: string[]; suggestedTeam: string; source?: 'complaint' | 'knowledge' },
): Promise<HandoffPacket> {
  const caseRecord = await deps.repository.get(caseId, actorId)
  const facts = caseRecord.facts ?? caseRecord.analysis?.facts ?? {}
  const packet = HandoffPacketSchema.parse({
    id: `handoff-${crypto.randomUUID()}`,
    caseId,
    source: input.source ?? 'complaint',
    confirmedFacts: facts,
    missingFields: (['customer', 'product', 'batch', 'defect', 'quantity', 'impact', 'request'] as const).filter((field) => !facts[field]?.trim()),
    riskSignals: evaluateHardRisk(facts, caseRecord.content),
    searchedKnowledge: input.searchedKnowledge ?? [],
    reason: input.reason,
    suggestedTeam: input.suggestedTeam,
    sla: input.reason === 'HIGH_RISK' ? '立即升级，30 分钟内人工响应' : '4 个工作小时内人工响应',
    transitionReply: `您的诉求已转交${input.suggestedTeam}人工处理，我们会按约定时限同步进展。`,
    createdAt: new Date().toISOString(),
  })
  await deps.repository.recordHandoff(caseId, actorId, packet)
  return packet
}
