import type { CaseRecord } from '../contracts/case'
import type { WorkflowStage } from '../contracts/workflow'

export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  'intake',
  'analysis',
  'decision',
  'initial_pack',
  'containment',
  'root_cause',
  'corrective',
  'customer_confirm',
  'closed',
]

export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  intake: '受理',
  analysis: 'Agent 分析',
  decision: '人工判断',
  initial_pack: '首次处理包',
  containment: '临时遏制',
  root_cause: '根因调查',
  corrective: '对策验证',
  customer_confirm: '客户确认',
  closed: '关单',
}

export function workflowIndex(stage: WorkflowStage): number {
  return WORKFLOW_STAGES.indexOf(stage)
}

/** 固定顺序：只允许推进到下一个节点。 */
export function nextStage(stage: WorkflowStage): WorkflowStage | undefined {
  return WORKFLOW_STAGES[workflowIndex(stage) + 1]
}

export function getAllowedTransitions(stage: WorkflowStage): WorkflowStage[] {
  const next = nextStage(stage)
  return next ? [next] : []
}

/** 案件当前有效阶段：有显式工作流记录时用记录值，否则按案件状态推导。 */
export function effectiveWorkflowStage(record: CaseRecord): WorkflowStage {
  if (record.workflow?.stage) return record.workflow.stage
  const byStatus: Record<CaseRecord['status'], WorkflowStage> = {
    intake: 'intake',
    analyzed: 'analysis',
    confirmed: 'decision',
    initial_pack: 'initial_pack',
  }
  return byStatus[record.status]
}

export function isStageReached(record: CaseRecord, stage: WorkflowStage): boolean {
  return workflowIndex(effectiveWorkflowStage(record)) >= workflowIndex(stage)
}

export type CustomerNodeKey = 'received' | 'assigned' | 'root_cause' | 'corrective' | 'closed'

export type CustomerProgressNode = {
  key: CustomerNodeKey
  label: string
  expectation: string
  status: 'done' | 'current' | 'upcoming'
  at?: string
}

export const CUSTOMER_PROGRESS_NODES: ReadonlyArray<{
  key: CustomerNodeKey
  label: string
  expectation: string
  stages: readonly WorkflowStage[]
}> = [
  { key: 'received', label: '受理确认', expectation: '秒级响应', stages: ['intake', 'analysis'] },
  { key: 'assigned', label: '已分派', expectation: '分钟级', stages: ['decision', 'initial_pack'] },
  { key: 'root_cause', label: '根因定位', expectation: '小时级', stages: ['containment', 'root_cause'] },
  { key: 'corrective', label: '对策确认', expectation: '天级', stages: ['corrective', 'customer_confirm'] },
  { key: 'closed', label: '闭环关闭', expectation: '已闭环', stages: ['closed'] },
]

/** 客户进度看板：仅输出客户可见的节点状态与时间，不暴露内部责任、成本与争议。 */
export function customerProgress(record: CaseRecord): { nodes: CustomerProgressNode[]; currentIndex: number; nextSyncLabel: string } {
  const current = workflowIndex(effectiveWorkflowStage(record))
  const history = record.workflow?.stageHistory ?? []
  const nodes: CustomerProgressNode[] = CUSTOMER_PROGRESS_NODES.map((node) => {
    const start = workflowIndex(node.stages[0])
    const end = workflowIndex(node.stages[node.stages.length - 1])
    const status: CustomerProgressNode['status'] = current > end ? 'done' : current >= start ? 'current' : 'upcoming'
    const latest = [...history].reverse().find((entry) => {
      const index = workflowIndex(entry.stage)
      return index >= start && index <= end
    })
    return { key: node.key, label: node.label, expectation: node.expectation, status, at: latest?.at }
  })
  return {
    nodes,
    currentIndex: nodes.findIndex((node) => node.status === 'current'),
    nextSyncLabel: current >= workflowIndex('closed') ? '已闭环，无需再次同步' : '客户可随时查看，进展按节点同步',
  }
}
