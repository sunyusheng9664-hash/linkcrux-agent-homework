import type { CaseRecord } from '../../contracts/case'
import { customerProgress } from '../../domain/workflow'
import { formatDateTime } from '../../domain/presentation'

const STATUS_LABELS: Record<'done' | 'current' | 'upcoming', string> = {
  done: '已完成',
  current: '进行中',
  upcoming: '未开始',
}

/** 客户进度看板：只输出客户可见的节点状态与时间，不暴露内部责任、成本与争议。 */
export function CustomerView({ record }: { record: CaseRecord }) {
  const progress = customerProgress(record)
  const nextSyncAt = record.workflow?.updatedAt ?? record.updatedAt

  return (
    <section className="cb-section" aria-label="客户进度看板">
      <div className="cb-section-head">
        <div>
          <h2 className="cb-title" id="customer-view-heading">客户进度看板</h2>
          <p className="cb-desc">仅展示向客户公开的进展节点与预计答复时间；内部信息不外发。</p>
        </div>
        <span className="cb-badge gray">下次更新 {formatDateTime(nextSyncAt)}</span>
      </div>

      <div className="cb-board">
        <div className="cb-subcard">
          <h3>客户可见节点</h3>
          <div className="cb-timeline-list">
            {progress.nodes.map((node) => (
              <div className="cb-timeline-item" key={node.key}>
                <span className="cb-dot" aria-hidden="true" />
                <div>
                  <strong>{node.label}</strong>
                  <div className="cb-muted">
                    {node.expectation} · {node.at ? `于 ${formatDateTime(node.at)}` : STATUS_LABELS[node.status]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="cb-subcard">
          <h3>对外同步说明</h3>
          <div className="cb-timeline-list">
            <div className="cb-timeline-item">
              <span className="cb-dot" aria-hidden="true" />
              <div>
                <strong>更新频率</strong>
                <div className="cb-muted">{progress.nextSyncLabel}</div>
              </div>
            </div>
            <div className="cb-timeline-item">
              <span className="cb-dot" aria-hidden="true" />
              <div>
                <strong>信息边界</strong>
                <div className="cb-muted">内部工单、责任归属、赔偿方案与未核实字段均不对外展示。</div>
              </div>
            </div>
            <p className="cb-muted" style={{ margin: 0 }}>
              下次更新时间 <time dateTime={nextSyncAt}>{formatDateTime(nextSyncAt)}</time>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
