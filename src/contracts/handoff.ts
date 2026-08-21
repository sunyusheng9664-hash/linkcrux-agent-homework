import { z } from 'zod'

import { CaseFactFieldSchema, CaseFactsSchema, RiskSignalSchema } from './case'

export const HandoffReasonSchema = z.enum(['OUT_OF_SCOPE', 'HIGH_RISK', 'INFORMATION_INSUFFICIENT', 'SYSTEM_QUERY_REQUIRED', 'KNOWLEDGE_NOT_COVERED', 'LOW_CONFIDENCE'])
export const HandoffPacketSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  source: z.enum(['complaint', 'knowledge']),
  confirmedFacts: CaseFactsSchema,
  missingFields: z.array(CaseFactFieldSchema),
  riskSignals: z.array(RiskSignalSchema),
  searchedKnowledge: z.array(z.string().min(1)).max(3),
  reason: HandoffReasonSchema,
  suggestedTeam: z.string().min(1),
  sla: z.string().min(1),
  transitionReply: z.string().min(1),
  createdAt: z.string().datetime(),
}).strict()

export type HandoffPacket = z.infer<typeof HandoffPacketSchema>
export type HandoffReason = z.infer<typeof HandoffReasonSchema>
