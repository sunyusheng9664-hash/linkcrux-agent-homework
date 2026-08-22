import { z } from 'zod'

import { CaseWorkflowSchema, WorkflowStageSchema, type CaseWorkflow, type WorkflowStage } from '../../../../src/contracts/workflow'
import { effectiveWorkflowStage, nextStage } from '../../../../src/domain/workflow'
import type { CaseRepository } from '../repositories/caseRepository'

const AdvanceCasePayloadSchema = z.object({
  stage: WorkflowStageSchema,
  rootCause: z.string().trim().min(1).optional(),
  containmentEvidence: z.array(z.string().trim().min(1)).max(50).optional(),
  correctiveAction: z.string().trim().min(1).optional(),
  correctiveVerification: z.string().trim().min(1).optional(),
  customerAccepted: z.boolean().optional(),
  customerFeedback: z.string().trim().optional(),
  unresolvedHighRisks: z.number().int().nonnegative().optional(),
}).strict()

export type AdvanceCaseInput = z.input<typeof AdvanceCasePayloadSchema>

export async function advanceCase(
  repository: CaseRepository,
  id: string,
  actorId: string,
  input: AdvanceCaseInput,
) {
  const payload = AdvanceCasePayloadSchema.parse(input)
  const record = await repository.get(id, actorId)
  const currentStage = effectiveWorkflowStage(record)
  // 允许推进到下一阶段，也允许停留在当前阶段修正证据（否则关单条件不满足时无法补救）
  const allowed = payload.stage === currentStage || payload.stage === nextStage(currentStage)
  if (!allowed) throw new Error('WORKFLOW_TRANSITION_INVALID')

  requireStageEvidence(payload.stage, payload)

  const existing = record.workflow ?? initializeWorkflow(actorId, currentStage)
  const now = new Date().toISOString()
  const workflow = CaseWorkflowSchema.parse({
    ...existing,
    stage: payload.stage,
    updatedAt: now,
    updatedBy: actorId,
    stageHistory: [...(existing.stageHistory ?? []), { stage: payload.stage, at: now }],
    ...(payload.rootCause !== undefined ? { rootCause: payload.rootCause, rootCauseConfirmedBy: actorId } : {}),
    ...(payload.containmentEvidence !== undefined ? { containmentEvidence: payload.containmentEvidence } : {}),
    ...(payload.correctiveAction !== undefined ? { correctiveAction: payload.correctiveAction } : {}),
    ...(payload.correctiveVerification !== undefined ? { correctiveVerification: payload.correctiveVerification } : {}),
    ...(payload.customerAccepted !== undefined ? { customerAccepted: payload.customerAccepted } : {}),
    ...(payload.customerFeedback !== undefined ? { customerFeedback: payload.customerFeedback } : {}),
    ...(payload.unresolvedHighRisks !== undefined ? { unresolvedHighRisks: payload.unresolvedHighRisks } : {}),
  })
  return repository.transition(id, actorId, {
    expectedVersion: record.version,
    expectedStatus: record.status,
    expectedInitialPackStatus: record.initialPackStatus ?? null,
    patch: { workflow },
  })
}

export function requireStageEvidence(stage: WorkflowStage, payload: AdvanceCaseInput): void {
  if (stage === 'root_cause' && !payload.rootCause?.trim()) throw new Error('ROOT_CAUSE_REQUIRED')
  if (stage === 'containment' && !payload.containmentEvidence?.length) throw new Error('CONTAINMENT_EVIDENCE_REQUIRED')
  if (stage === 'corrective' && (!payload.correctiveAction?.trim() || !payload.correctiveVerification?.trim())) throw new Error('CORRECTIVE_VERIFICATION_REQUIRED')
  if (stage === 'customer_confirm' && payload.customerAccepted !== true) throw new Error('CUSTOMER_ACCEPTANCE_REQUIRED')
}

export function initializeWorkflow(actorId: string, stage: WorkflowStage): CaseWorkflow {
  const now = new Date().toISOString()
  return CaseWorkflowSchema.parse({
    stage,
    startedAt: now,
    updatedAt: now,
    updatedBy: actorId,
    stageHistory: [{ stage, at: now }],
    unresolvedHighRisks: 0,
  })
}
