import { useState } from 'react'

import type { CaseFactField, InitialPack, ManagerDecision } from '../../contracts/case'
import {
  TIMELINE_MILESTONE_LABELS,
  factLabel,
  formatCaseNumber,
  formatDateTime,
  milestoneDeadline,
  severityLabel,
  timelineStatus,
  type TimelineMilestone,
} from '../../domain/presentation'

type TaskState = {
  decision: 'accepted' | 'modified' | undefined
  owner: string
  due: string
  executed: boolean
  evidence: string
  confirmedAt?: string
}

export function EightDInitialView({
  pack,
  caseId,
  caseCreatedAt,
  managerDecision,
  facts = {},
  now = () => new Date(),
  copy = (text) => navigator.clipboard.writeText(text),
  download = downloadTextFile,
}: {
  pack: InitialPack
  caseId?: string
  caseCreatedAt?: string
  managerDecision?: ManagerDecision
  facts?: Partial<Record<CaseFactField, string>>
  now?: () => Date
  copy?: (text: string) => Promise<void> | void
  download?: (filename: string, content: string) => void
}) {
  const [reply, setReply] = useState(pack.customerReply)
  const [replyConfirmed, setReplyConfirmed] = useState(false)
  const [versionConfirmed, setVersionConfirmed] = useState(false)
  const [tasks, setTasks] = useState<Record<number, TaskState>>({})

  function task(index: number): TaskState {
    return tasks[index] ?? { decision: undefined, owner: pack.d3.containmentActions[index].owner, due: pack.d3.containmentActions[index].dueAt, executed: false, evidence: '' }
  }
  function updateTask(index: number, patch: Partial<TaskState>) {
    setTasks((current) => ({ ...current, [index]: { ...task(index), ...patch } }))
  }

  const caseNumber = caseId ? formatCaseNumber(caseId) : undefined
  const knownFacts = Object.entries(facts).filter((entry): entry is [CaseFactField, string] => Boolean(entry[1]?.trim()))

  function exportPack() {
    const lines = [
      `# 8D 初版${caseNumber ? `（案件 ${caseNumber}）` : ''}`,
      '',
      '## 客户首次回复',
      reply,
      '',
      '## 内部工单草案',
      pack.internalTicket,
      '',
      '## D1 团队计划',
      pack.d1,
      '',
      '## D2 问题描述',
      pack.d2,
      '',
      '## D3 临时遏制建议',
      ...pack.d3.containmentActions.map((action, index) => `- [${task(index).executed ? 'x' : ' '}] ${action.suggestedAction}（负责人：${task(index).owner}；截止：${task(index).due}）`),
      '',
      '## 交付时间线',
      ...pack.timeline24h14d30d.map((item) => `- ${TIMELINE_MILESTONE_LABELS[item.milestone]}：${item.delivery}`),
      '',
      '## D4–D8 后续计划',
      ...pack.d4ToD8Plan.map((item) => `- ${item.phase}：${item.plan}`),
      '',
    ].join('\n')
    download(`8D-初版${caseNumber ? `-${caseNumber}` : ''}.md`, lines)
  }

  return <article>
    <header className="pack-header">
      <h1>8D 初版</h1>
      <p>首次处理包 = 客户首响 + 内部工单 + 8D 初版（D1–D3）。</p>
      <div className="actions pack-actions">
        {versionConfirmed
          ? <span className="status-badge status-badge--success">✓ 质量经理已确认 v1</span>
          : <button type="button" className="secondary" onClick={() => setVersionConfirmed(true)}>确认版本 v1</button>}
        <button type="button" className="secondary" onClick={() => void copy(reply)}>复制客户回复</button>
        <button type="button" className="secondary" onClick={exportPack}>导出 8D 初版</button>
      </div>
    </header>

    <section className="panel" aria-labelledby="customer-reply-heading">
      <h2 id="customer-reply-heading">客户首次回复</h2>
      {knownFacts.length > 0 && <p className="reference-line">已引用本案信息：{knownFacts.map(([field, value]) => `${factLabel(field)} ${value}`).join(' · ')}</p>}
      {managerDecision?.outcome === 'modified' && <p className="hint">质量经理已修改 Agent 建议，回复内容需与最终判断一致。</p>}
      <textarea aria-label="客户回复草稿" value={reply} onChange={(event) => setReply(event.target.value)} rows={5} />
      <div className="actions">
        <button type="button" className="secondary" onClick={() => void copy(reply)}>复制回复</button>
        <button type="button" className={replyConfirmed ? '' : 'secondary'} onClick={() => setReplyConfirmed((current) => !current)}>
          {replyConfirmed ? '已确认待发送 ✓' : '确认并待发送'}
        </button>
      </div>
    </section>

    <section className="panel" aria-labelledby="ticket-heading">
      <h2 id="ticket-heading">内部工单草案</h2>
      <dl className="summary-grid">
        <div><dt>案件号</dt><dd>{caseNumber ?? '待生成'}</dd></div>
        <div><dt>严重度</dt><dd>{managerDecision ? severityLabel(managerDecision.severity) : '待确认'}</dd></div>
        <div><dt>启动 8D</dt><dd>{managerDecision ? (managerDecision.start8d ? '是' : '否') : '待确认'}</dd></div>
        <div><dt>牵头负责人</dt><dd>质量经理</dd></div>
        <div><dt>截止时间</dt><dd>{caseCreatedAt ? formatDateTime(milestoneDeadline(caseCreatedAt, '24h')) : '待计算'}</dd></div>
      </dl>
      <details><summary>查看工单草案原文</summary><p>{pack.internalTicket}</p></details>
    </section>

    <section className="panel"><h2>D1 团队计划</h2><p>{pack.d1}</p></section>
    <section className="panel"><h2>D2 问题描述</h2><p>{pack.d2}</p></section>

    <section className="panel" aria-labelledby="d3-heading">
      <h2 id="d3-heading">D3 临时遏制建议</h2>
      <p className="hint">以下仅为 Agent 建议，不能代表措施已经执行。接受或修改后，由质量经理确认执行并附证据。</p>
      <ul className="card-list">
        {pack.d3.containmentActions.map((action, index) => {
          const state = task(index)
          return <li key={`${action.suggestedAction}-${index}`} className="task-card">
            <div className="task-card__head">
              <strong>{action.suggestedAction}</strong>
              <span className={`status-badge${state.executed ? ' status-badge--success' : ' status-badge--neutral'}`}>{state.executed ? '已执行' : state.decision ? '已接受待执行' : 'Agent 建议 · 未执行'}</span>
            </div>
            <div className="task-card__fields">
              <label>实际负责人<input aria-label={`负责人 ${index + 1}`} value={state.owner} onChange={(event) => updateTask(index, { owner: event.target.value })} /></label>
              <label>完成时间<input aria-label={`完成时间 ${index + 1}`} type="datetime-local" value={toDateTimeLocal(state.due)} onChange={(event) => updateTask(index, { due: event.target.value })} /></label>
            </div>
            <div className="actions">
              <button type="button" className={state.decision === 'accepted' ? '' : 'secondary'} onClick={() => updateTask(index, { decision: 'accepted' })}>接受建议</button>
              <button type="button" className={state.decision === 'modified' ? '' : 'secondary'} onClick={() => updateTask(index, { decision: 'modified' })}>修改建议</button>
            </div>
            {state.decision && !state.executed && <div className="execution-box">
              <label htmlFor={`evidence-${index}`}>执行证据</label>
              <textarea id={`evidence-${index}`} value={state.evidence} onChange={(event) => updateTask(index, { evidence: event.target.value })} rows={2} placeholder="填写执行记录或附件说明，例如：已隔离 3 箱，照片见附件" />
              <button type="button" disabled={!state.evidence.trim()} onClick={() => updateTask(index, { executed: true, confirmedAt: now().toISOString() })}>确认并标记已执行</button>
              <p className="hint">仅人工确认并附证据后才允许标记为已执行。</p>
            </div>}
            {state.executed && <p className="executed-note">已于 {state.confirmedAt ? formatDateTime(state.confirmedAt) : '确认时间未知'} 由质量经理确认执行。</p>}
          </li>
        })}
      </ul>
    </section>

    <section className="panel" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">交付时间线</h2>
      <p className="hint">截止时间按案件受理时间推算；逾期会以风险提示标注。</p>
      <ol className="timeline">
        {pack.timeline24h14d30d.map((item) => {
          const deadline = caseCreatedAt ? milestoneDeadline(caseCreatedAt, item.milestone) : undefined
          const status = deadline ? timelineStatus(deadline, now()) : undefined
          return <li key={item.milestone} className={`timeline__item${status?.overdue ? ' timeline__item--overdue' : ''}`}>
            <strong>{TIMELINE_MILESTONE_LABELS[item.milestone as TimelineMilestone]}</strong>
            <span>{item.delivery}</span>
            {deadline && <span className="timeline__meta">截止 <time dateTime={deadline.toISOString()}>{formatDateTime(deadline)}</time></span>}
            {status && <span className={`timeline__status${status.overdue ? ' timeline__status--overdue' : ''}`}>{status.overdue ? '⚠ ' : ''}{status.label}</span>}
          </li>
        })}
      </ol>
    </section>

    <section className="panel" aria-labelledby="follow-up-heading">
      <h2 id="follow-up-heading">D4–D8 后续计划</h2>
      <p className="hint">这些内容是下一阶段工作计划，不是已经核实的结论或已完成事项。</p>
      <ol>{pack.d4ToD8Plan.map((item) => <li key={item.phase}><strong>{item.phase}</strong> <span className="evidence-tag evidence-tag--plan">计划中</span><p>{item.plan}</p></li>)}</ol>
    </section>
  </article>
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function downloadTextFile(filename: string, content: string): void {
  if (typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') return
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
