import { z } from 'zod'

export const WorkflowStageSchema = z.enum([
  'intake',
  'analysis',
  'decision',
  'initial_pack',
  'containment',
  'root_cause',
  'corrective',
  'customer_confirm',
  'closed',
])

export const StageHistoryEntrySchema = z.object({
  stage: WorkflowStageSchema,
  at: z.string().datetime({ offset: true }),
}).strict()

/** 固定工作流记录：仅允许按固定顺序推进，不允许新增或删除节点。 */
export const CaseWorkflowSchema = z.object({
  stage: WorkflowStageSchema,
  startedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  updatedBy: z.string().min(1),
  stageHistory: z.array(StageHistoryEntrySchema).max(20).default([]),
  rootCause: z.string().trim().min(1).optional(),
  rootCauseConfirmedBy: z.string().min(1).optional(),
  containmentEvidence: z.array(z.string().trim().min(1)).max(50).optional(),
  correctiveAction: z.string().trim().min(1).optional(),
  correctiveVerification: z.string().trim().min(1).optional(),
  customerAccepted: z.boolean().optional(),
  customerFeedback: z.string().trim().optional(),
  unresolvedHighRisks: z.number().int().nonnegative().default(0),
  closedAt: z.string().datetime({ offset: true }).optional(),
  closedBy: z.string().min(1).optional(),
  knowledgeSedimentation: z.enum(['pending', 'generated']).optional(),
}).strict()

export type WorkflowStage = z.infer<typeof WorkflowStageSchema>
export type StageHistoryEntry = z.infer<typeof StageHistoryEntrySchema>
export type CaseWorkflow = z.infer<typeof CaseWorkflowSchema>
