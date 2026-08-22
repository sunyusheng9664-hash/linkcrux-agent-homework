import type { CaseRecord } from '../contracts/case'
import type { WorkflowStage } from '../contracts/workflow'
import { workflowIndex, WORKFLOW_STAGES } from './workflow'

export type CloseGateConditionCode =
  | 'STAGE_REACHED'
  | 'FACTS_COMPLETE'
  | 'ROOT_CAUSE'
  | 'CONTAINMENT_EVIDENCE'
  | 'CORRECTIVE_VERIFIED'
  | 'CUSTOMER_ACCEPTED'
  | 'HIGH_RISKS_CLEARED'

export type CloseGateCondition = { code: CloseGateConditionCode; label: string; met: boolean }

export type CloseGateInput = {
  stage: WorkflowStage
  factsComplete: boolean
  rootCauseConfirmed: boolean
  containmentEvidencePresent: boolean
  correctiveVerified: boolean
  customerAccepted: boolean
  unresolvedHighRisks: number
}

const CONDITIONS: Array<{ code: CloseGateConditionCode; label: string; met: (input: CloseGateInput) => boolean }> = [
  { code: 'STAGE_REACHED', label: '流程已推进到客户确认', met: (input) => workflowIndex(input.stage) >= workflowIndex('customer_confirm') },
  { code: 'FACTS_COMPLETE', label: '必填事实完整（客户/产品/批次/缺陷/影响）', met: (input) => input.factsComplete },
  { code: 'ROOT_CAUSE', label: '根因已由质量经理确认', met: (input) => input.rootCauseConfirmed },
  { code: 'CONTAINMENT_EVIDENCE', label: '临时遏制措施有执行记录与证据', met: (input) => input.containmentEvidencePresent },
  { code: 'CORRECTIVE_VERIFIED', label: '永久对策有验证结果', met: (input) => input.correctiveVerified },
  { code: 'CUSTOMER_ACCEPTED', label: '客户已接受处理结果', met: (input) => input.customerAccepted },
  { code: 'HIGH_RISKS_CLEARED', label: '未完成的高风险事项为零', met: (input) => input.unresolvedHighRisks === 0 },
]

export function evaluateCloseGate(input: CloseGateInput): { allowed: boolean; missing: CloseGateCondition[] } {
  const conditions = CONDITIONS.map((item) => ({ code: item.code, label: item.label, met: item.met(input) }))
  return { allowed: conditions.every((item) => item.met), missing: conditions.filter((item) => !item.met) }
}

const REQUIRED_FACT_FIELDS = ['customer', 'product', 'batch', 'defect', 'impact'] as const

/** 从案件记录构建关单检查输入。 */
export function closeGateFromCase(record: CaseRecord): CloseGateInput {
  const facts = { ...record.facts, ...record.analysis?.facts }
  const workflow = record.workflow
  return {
    stage: workflow?.stage ?? WORKFLOW_STAGES[0],
    factsComplete: REQUIRED_FACT_FIELDS.every((field) => Boolean(facts[field]?.trim())),
    rootCauseConfirmed: Boolean(workflow?.rootCause?.trim() && workflow.rootCauseConfirmedBy),
    containmentEvidencePresent: Boolean(workflow?.containmentEvidence?.length),
    correctiveVerified: Boolean(workflow?.correctiveAction?.trim() && workflow?.correctiveVerification?.trim()),
    customerAccepted: workflow?.customerAccepted === true,
    unresolvedHighRisks: workflow?.unresolvedHighRisks ?? 0,
  }
}
