import { z } from 'zod'

import { CaseWorkflowSchema } from './workflow'

export const CaseFactFieldSchema = z.enum([
  'customer',
  'product',
  'batch',
  'defect',
  'quantity',
  'impact',
  'request',
])

export const CaseFactsSchema = z.object({
  customer: z.string().trim().optional(),
  product: z.string().trim().optional(),
  batch: z.string().trim().optional(),
  defect: z.string().trim().optional(),
  quantity: z.string().trim().optional(),
  impact: z.string().trim().optional(),
  request: z.string().trim().optional(),
})

export const SAFE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENT_COUNT = 5

export function complaintAttachmentPathPrefix(userId: string): string {
  return `complaints/${encodeURIComponent(userId)}/`
}

export const AttachmentSchema = z.object({
  fileId: z.string().min(1),
  mimeType: z.enum(SAFE_IMAGE_MIME_TYPES),
  size: z.number().int().positive().max(MAX_IMAGE_SIZE_BYTES),
  originalName: z.string().min(1),
})

export const ComplaintInputSchema = z.object({
  content: z.string().trim().min(1),
  facts: CaseFactsSchema.optional(),
  attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENT_COUNT).default([]),
})

export const RiskSignalSchema = z.object({
  code: z.enum(['SAFETY', 'COMPLIANCE', 'LINE_STOPPAGE', 'BATCH_FAILURE']),
  label: z.string().min(1),
  evidence: z.string().min(1),
  requiresHuman: z.literal(true),
})

export const RoutingSchema = z.object({
  highRisk: z.boolean(),
  requiresHuman: z.boolean(),
}).superRefine((routing, context) => {
  if (routing.highRisk && !routing.requiresHuman) {
    context.addIssue({
      code: 'custom',
      path: ['requiresHuman'],
      message: '高风险案件必须人工处理',
    })
  }
})

export const AnalysisStatusSchema = z.enum(['ai_completed', 'manual_takeover'])

export const AnalysisFailureReasonSchema = z.enum([
  'MODEL_CONFIG_MISSING',
  'MODEL_REQUEST_FAILED',
  'MODEL_RESPONSE_INVALID',
  'MODEL_SCHEMA_INVALID',
  'MODEL_UNAVAILABLE',
])

export const ContainmentExecutionStatusSchema = z.literal('suggested')

export const ContainmentActionSchema = z.object({
  suggestedAction: z.string().min(1),
  owner: z.string().min(1),
  dueAt: z.string().min(1),
  executionStatus: ContainmentExecutionStatusSchema.default('suggested'),
  evidence: z.array(z.string().min(1)).max(0).default([]),
}).strict()

export const ContainmentExecutionRecordSchema = z.object({
  containmentActionId: z.string().min(1),
  executionStatus: z.literal('executed').default('executed'),
  evidence: z.array(z.string().min(1)).min(1),
  confirmedBy: z.string().min(1),
  confirmedAt: z.string().min(1),
})

export const CaseAnalysisSchema = z.object({
  facts: CaseFactsSchema,
  missingFields: z.array(CaseFactFieldSchema),
  informationCompleteness: z.number().min(0).max(100),
  riskSuggestion: z.array(RiskSignalSchema),
  departmentSuggestion: z.array(z.string().min(1)),
  slaSuggestion: z.string().min(1),
  start8dSuggestion: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidenceSpans: z.array(
    z.object({
      field: z.string().min(1),
      text: z.string().min(1),
    }),
  ),
  routing: RoutingSchema,
  analysisStatus: AnalysisStatusSchema.default('ai_completed'),
  analysisFailureReason: AnalysisFailureReasonSchema.optional(),
})

export const ManagerDecisionSchema = z.object({
  outcome: z.enum(['accepted', 'modified', 'rejected']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  start8d: z.boolean(),
  modificationReason: z.string().trim().min(1).optional(),
}).strict().superRefine((decision, context) => {
  if (decision.outcome !== 'accepted' && !decision.modificationReason) {
    context.addIssue({
      code: 'custom',
      path: ['modificationReason'],
      message: '修改或驳回时必须填写原因',
    })
  }
})

export function managerSeverityBaseline(requiresHuman: boolean): 'high' | 'medium' {
  return requiresHuman ? 'high' : 'medium'
}

const Timeline24h14d30dSchema = z.tuple([
  z.object({ milestone: z.literal('24h'), delivery: z.string().min(1) }).strict(),
  z.object({ milestone: z.literal('14d'), delivery: z.string().min(1) }).strict(),
  z.object({ milestone: z.literal('30d'), delivery: z.string().min(1) }).strict(),
])

const FOLLOW_UP_COMPLETION_CLAIM = /已完成|已验证|已确认|最终根因|责任结论|召回决定|赔偿承诺|已执行/
const FollowUpPlanTextSchema = z.string().min(1).refine(
  (value) => !FOLLOW_UP_COMPLETION_CLAIM.test(value),
  'D4-D8 只能描述后续计划，不能声称已完成或形成最终结论',
)

const followUpPhase = <T extends 'D4' | 'D5' | 'D6' | 'D7' | 'D8'>(phase: T) =>
  z.object({ phase: z.literal(phase), plan: FollowUpPlanTextSchema }).strict()

export const InitialPackD3Schema = z.object({
  containmentActions: z.array(ContainmentActionSchema).min(1),
}).strict()

const D3ProposalItemSchema = z.object({
    actionType: z.enum(['isolate', 'hold_shipment', 'inspect', 'preserve_evidence', 'notify_quality']),
    targetScope: z.enum(['suspected_inventory', 'related_shipments', 'affected_process', 'complaint_evidence']),
    dueWithinHours: z.number().int().min(1).max(72),
  }).strict().superRefine((proposal, context) => {
    const compatibleTargets = {
      isolate: ['suspected_inventory', 'affected_process'],
      hold_shipment: ['suspected_inventory', 'related_shipments'],
      inspect: ['suspected_inventory', 'related_shipments', 'affected_process'],
      preserve_evidence: ['complaint_evidence'],
      notify_quality: ['complaint_evidence', 'affected_process'],
    } as const
    if (!(compatibleTargets[proposal.actionType] as readonly string[]).includes(proposal.targetScope)) {
      context.addIssue({ code: 'custom', path: ['targetScope'], message: '措施类型与目标范围不兼容' })
    }
  })

export const InitialPackD3ProposalSchema = z.object({
  proposals: z.array(D3ProposalItemSchema).min(1).max(5),
}).strict()

export const InitialPackSchema = z.object({
  customerReply: z.string().min(1),
  internalTicket: z.string().min(1),
  d1: z.string().min(1),
  d2: z.string().min(1),
  d3: InitialPackD3Schema,
  timeline24h14d30d: Timeline24h14d30dSchema,
  d4ToD8Plan: z.tuple([
    followUpPhase('D4'),
    followUpPhase('D5'),
    followUpPhase('D6'),
    followUpPhase('D7'),
    followUpPhase('D8'),
  ]),
}).strict()

export const CaseStatusSchema = z.enum(['intake', 'analyzed', 'confirmed', 'initial_pack'])
export const InitialPackStatusSchema = z.enum(['generating', 'generated', 'manual_handoff'])
export const InitialPackFailureReasonSchema = z.enum([
  'INITIAL_PACK_MODEL_FAILED',
  'INITIAL_PACK_UNSAFE_D3',
  'INITIAL_PACK_ASSEMBLY_FAILED',
])
export const InitialPackGenerationSchema = z.object({
  generationId: z.string().min(1),
  claimedAt: z.string().datetime({ offset: true }),
  leaseUntil: z.string().datetime({ offset: true }),
}).strict()

export const CaseRecordSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  facts: CaseFactsSchema.optional(),
  attachments: z.array(AttachmentSchema),
  status: CaseStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  version: z.number().int().positive(),
  analysis: CaseAnalysisSchema.optional(),
  analysisStatus: AnalysisStatusSchema.optional(),
  managerDecision: ManagerDecisionSchema.optional(),
  initialPack: InitialPackSchema.optional(),
  initialPackStatus: InitialPackStatusSchema.optional(),
  initialPackFailureReason: InitialPackFailureReasonSchema.optional(),
  initialPackGeneration: InitialPackGenerationSchema.optional(),
  workflow: CaseWorkflowSchema.optional(),
}).strict().superRefine((record, context) => {
  const issue = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message })
  if (Boolean(record.analysis) !== Boolean(record.analysisStatus) || (record.analysis && record.analysisStatus !== record.analysis.analysisStatus)) {
    issue('analysisStatus', '分析结果与分析状态必须同时存在且保持一致')
  }
  if (record.status === 'intake' && (record.analysis || record.analysisStatus || record.managerDecision || record.initialPackStatus || record.initialPack)) {
    issue('status', '待受理案件不能持有分析、判断或处理包状态')
  }
  if (record.status === 'analyzed' && (!record.analysis || record.managerDecision || record.initialPackStatus || record.initialPack)) {
    issue('status', '已分析案件必须只有分析结果')
  }
  if (record.status === 'confirmed' && (!record.analysis || !record.managerDecision || record.initialPack)) {
    issue('status', '已确认案件必须持有分析与人工判断且不能提前持有处理包')
  }
  if (record.status === 'initial_pack' && (!record.analysis || !record.managerDecision || !record.initialPack || record.initialPackStatus !== 'generated')) {
    issue('status', '首次处理包状态必须持有分析、人工判断及生成结果')
  }
  if (record.initialPackStatus === 'generating' && (record.status !== 'confirmed' || !record.initialPackGeneration || record.initialPackFailureReason)) {
    issue('initialPackStatus', '生成中必须持有有效租约且不能持有失败原因')
  }
  if (record.initialPackGeneration && Date.parse(record.initialPackGeneration.claimedAt) >= Date.parse(record.initialPackGeneration.leaseUntil)) {
    issue('initialPackGeneration', '生成租约截止时间必须晚于领取时间')
  }
  if (record.initialPackStatus === 'generated' && (record.status !== 'initial_pack' || !record.initialPack || record.initialPackGeneration || record.initialPackFailureReason)) {
    issue('initialPackStatus', '生成完成必须持有处理包并清理租约与失败原因')
  }
  if (record.initialPackStatus === 'manual_handoff' && (record.status !== 'confirmed' || !record.initialPackFailureReason || record.initialPackGeneration || record.initialPack)) {
    issue('initialPackStatus', '人工接管必须持有失败原因并清理租约')
  }
  if (!record.initialPackStatus && (record.initialPack || record.initialPackFailureReason || record.initialPackGeneration)) {
    issue('initialPackStatus', '无生成状态时不能持有处理包、失败原因或租约')
  }
})

export type CaseFactField = z.infer<typeof CaseFactFieldSchema>
export type CaseFacts = z.infer<typeof CaseFactsSchema>
export type Attachment = z.infer<typeof AttachmentSchema>
export type ComplaintInput = z.infer<typeof ComplaintInputSchema>
export type RiskSignal = z.infer<typeof RiskSignalSchema>
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>
export type AnalysisFailureReason = z.infer<typeof AnalysisFailureReasonSchema>
export type CaseAnalysis = z.infer<typeof CaseAnalysisSchema>
export type ManagerDecision = z.infer<typeof ManagerDecisionSchema>
export type ContainmentExecutionStatus = z.infer<typeof ContainmentExecutionStatusSchema>
export type ContainmentAction = z.infer<typeof ContainmentActionSchema>
export type ContainmentExecutionRecord = z.infer<typeof ContainmentExecutionRecordSchema>
export type InitialPack = z.infer<typeof InitialPackSchema>
export type InitialPackD3 = z.infer<typeof InitialPackD3Schema>
export type InitialPackD3Proposal = z.infer<typeof InitialPackD3ProposalSchema>
export type CaseStatus = z.infer<typeof CaseStatusSchema>
export type InitialPackStatus = z.infer<typeof InitialPackStatusSchema>
export type InitialPackFailureReason = z.infer<typeof InitialPackFailureReasonSchema>
export type InitialPackGeneration = z.infer<typeof InitialPackGenerationSchema>
export type CaseRecord = z.infer<typeof CaseRecordSchema>
