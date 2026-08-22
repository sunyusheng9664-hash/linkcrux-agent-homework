import { CaseWorkflowSchema } from '../../../../src/contracts/workflow'
import { closeGateFromCase, evaluateCloseGate } from '../../../../src/domain/closeGate'
import { effectiveWorkflowStage } from '../../../../src/domain/workflow'
import type { CaseRepository } from '../repositories/caseRepository'
import { initializeWorkflow } from './advanceCase'

export async function closeCase(
  repository: CaseRepository,
  id: string,
  actorId: string,
) {
  const record = await repository.get(id, actorId)
  const currentStage = effectiveWorkflowStage(record)
  if (currentStage !== 'customer_confirm') throw new Error('WORKFLOW_NOT_READY_FOR_CLOSE')

  const gate = evaluateCloseGate(closeGateFromCase(record))
  if (!gate.allowed) throw new Error('CLOSE_GATE_BLOCKED')

  const existing = record.workflow ?? initializeWorkflow(actorId, currentStage)
  const now = new Date().toISOString()
  const workflow = CaseWorkflowSchema.parse({
    ...existing,
    stage: 'closed',
    updatedAt: now,
    updatedBy: actorId,
    closedAt: now,
    closedBy: actorId,
    knowledgeSedimentation: 'pending',
    stageHistory: [...(existing.stageHistory ?? []), { stage: 'closed', at: now }],
  })
  return repository.transition(id, actorId, {
    expectedVersion: record.version,
    expectedStatus: record.status,
    expectedInitialPackStatus: record.initialPackStatus ?? null,
    patch: { workflow },
  })
}
