import type { CaseRecord } from '../../contracts/case'
import { WORKFLOW_STAGE_LABELS } from '../../domain/workflow'
import { confidenceLevel, factLabel, formatDateTime, initialPackStatusLabel, severityLabel } from '../../domain/presentation'

const OUTCOME_LABELS: Record<string, string> = {
  accepted: '接受 Agent 建议',
  modified: '修改 Agent 建议',
  rejected: '驳回 Agent 建议',
}

/** 人机协作记录：列出人工判断、分析与处理包留痕，作为质量经理的决策依据。 */
export function CollaborationLog({ record }: { record: CaseRecord }) {
  const analysis = record.analysis
  const decision = record.managerDecision
  const isMissing = analysis?.missingFields.length ? `缺失：${analysis.missingFields.map(factLabel).join('、')}` : '无缺失字段'

  return (
    <section className="cb-section" aria-label="人机协作记录">
      <div className="cb-section-head">
        <div>
          <h2 className="cb-title" id="collaboration-log-heading">人机协作记录</h2>
          <p className="cb-desc">保留关键信息判断链路，方便回溯“Agent 做了什么，人做了什么，当前结论是什么”。</p>
        </div>
      </div>
      <div className="cb-record-list">
        {record.workflow?.stageHistory.map((entry, index) => (
          <div className="cb-record-item" key={`${entry.stage}-${entry.at}-${index}`}>
            <span className="cb-dot" aria-hidden="true" />
            <div>
              <strong>{WORKFLOW_STAGE_LABELS[entry.stage]}</strong>
              <div className="cb-muted">于 {formatDateTime(entry.at)} 由 {record.workflow?.updatedBy ?? '系统'} 推进</div>
            </div>
          </div>
        ))}
        {analysis?.analysisStatus && (
          <div className="cb-record-item">
            <span className="cb-dot" aria-hidden="true" />
            <div>
              <strong>Agent 分析</strong>
              <div className="cb-muted">
                置信度 {analysis.confidence ? confidenceLevel(analysis.confidence).label : '待确认'}；{isMissing}；响应建议 {analysis.slaSuggestion}
              </div>
            </div>
          </div>
        )}
        {decision && (
          <div className="cb-record-item">
            <span className="cb-dot" aria-hidden="true" />
            <div>
              <strong>质量经理判断：{OUTCOME_LABELS[decision.outcome] ?? decision.outcome}</strong>
              <div className="cb-muted">
                严重度 {severityLabel(decision.severity)}；{decision.start8d ? '启动 8D' : '未启动 8D'}
                {decision.modificationReason ? `；原因：${decision.modificationReason}` : ''}
              </div>
            </div>
          </div>
        )}
        {record.initialPackStatus && (
          <div className="cb-record-item">
            <span className="cb-dot" aria-hidden="true" />
            <div>
              <strong>首次处理包</strong>
              <div className="cb-muted">状态：{initialPackStatusLabel(record.initialPackStatus)}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
