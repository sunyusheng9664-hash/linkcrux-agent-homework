import type { CaseRecord } from '../../contracts/case'
import type { WorkflowStage } from '../../contracts/workflow'
import { effectiveWorkflowStage, workflowIndex, WORKFLOW_STAGES, WORKFLOW_STAGE_LABELS } from '../../domain/workflow'
import { formatDateTime } from '../../domain/presentation'

function stageState(record: CaseRecord, stage: WorkflowStage): 'done' | 'current' | 'upcoming' {
  const current = workflowIndex(effectiveWorkflowStage(record))
  const index = workflowIndex(stage)
  if (index < current) return 'done'
  if (index === current) return 'current'
  return 'upcoming'
}

const STATE_NOTES: Record<'done' | 'current' | 'upcoming', string> = {
  done: '已完成',
  current: '处理中',
  upcoming: '待开始',
}

/** 固定工作流时间线：只展示既定节点与推进记录，不提供新增、删除或拖拽节点。 */
export function WorkflowTimeline({ record }: { record: CaseRecord }) {
  const current = effectiveWorkflowStage(record)
  const history = record.workflow?.stageHistory ?? []
  return (
    <section className="cb-section" aria-label="处理进度">
      <div className="cb-section-head">
        <div>
          <h2 className="cb-title" id="workflow-timeline-heading">处理进度</h2>
          <p className="cb-desc">案件按固定流程推进：受理 → 信息确认 → 风险判断 → 人工审批 → 首次响应 → 临时遏制 → 根因调查 → 对策验证 → 客户确认 → 关单 → 知识沉淀。</p>
        </div>
        <span className="cb-badge teal">当前：{WORKFLOW_STAGE_LABELS[current]}</span>
      </div>
      <ol className="cb-stepper" aria-label="工作流节点">
        {WORKFLOW_STAGES.map((stage, index) => {
          const state = stageState(record, stage)
          const latest = [...history].reverse().find((entry) => entry.stage === stage)
          return (
            <li className={`cb-step ${state}`} key={stage}>
              <span className="cb-step-num" aria-hidden="true">{index + 1}</span>
              <div className="cb-step-name">{WORKFLOW_STAGE_LABELS[stage]}</div>
              <div className="cb-step-note">{latest ? `于 ${formatDateTime(latest.at)}` : STATE_NOTES[state]}</div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
