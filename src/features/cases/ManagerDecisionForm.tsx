import { useState, type FormEvent } from 'react'

import { managerSeverityBaseline, type ManagerDecision } from '../../contracts/case'
import { EvidenceTag } from './EvidenceTag'

const OUTCOME_OPTIONS: Array<{ value: ManagerDecision['outcome']; title: string; description: string }> = [
  { value: 'accepted', title: '接受 Agent 建议', description: '直接采用当前分析结论' },
  { value: 'modified', title: '修改 Agent 建议', description: '调整严重度、8D 或补充说明' },
  { value: 'rejected', title: '驳回 Agent 建议', description: '不采纳当前结论，需说明原因' },
]

export function ManagerDecisionForm({
  initialStart8d,
  requiresHuman,
  riskLabel,
  riskEvidence,
  slaSuggestion,
  onConfirm,
}: {
  initialStart8d: boolean
  requiresHuman: boolean
  riskLabel?: string
  riskEvidence?: string
  slaSuggestion?: string
  onConfirm: (decision: ManagerDecision) => Promise<void>
}) {
  const initialSeverity = managerSeverityBaseline(requiresHuman)
  const [outcome, setOutcome] = useState<ManagerDecision['outcome'] | ''>('')
  const [severity, setSeverity] = useState<ManagerDecision['severity']>(initialSeverity)
  const [start8d, setStart8d] = useState(initialStart8d)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!outcome) {
      setError('请选择判断结果')
      return
    }
    const modificationReason = reason.trim() || undefined
    if (outcome !== 'accepted' && !modificationReason) {
      setError('修改或驳回时必须填写原因')
      return
    }

    setError(undefined)
    setSubmitting(true)
    try {
      await onConfirm({ outcome, severity, start8d, modificationReason })
    } catch {
      setError('判断保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return <section className="panel manager-decision" aria-labelledby="manager-decision-heading">
    <h2 id="manager-decision-heading">质量经理判断</h2>
    <p><EvidenceTag kind="confirmed" /> 以下结论由质量经理负责确认并留痕。</p>

    {requiresHuman && <div className="risk-banner risk-banner--locked" role="note" aria-label="高风险人工处理提示">
      <strong>已识别重大风险信号，需质量经理确认后方可推进</strong>
      {riskLabel && <p>{riskLabel}{riskEvidence ? `（证据：${riskEvidence}）` : ''}</p>}
      {slaSuggestion && <p>升级 SLA：{slaSuggestion}</p>}
    </div>}

    <form className="form" onSubmit={submit} noValidate>
      <fieldset className="decision-cards">
        <legend>判断结果</legend>
        {OUTCOME_OPTIONS.map((option) => (
          <label key={option.value} className={`decision-card${outcome === option.value ? ' decision-card--selected' : ''}`}>
            <input
              type="radio"
              name="manager-outcome"
              value={option.value}
              checked={outcome === option.value}
              onChange={(event) => setOutcome(event.target.value as ManagerDecision['outcome'])}
            />
            <span><strong>{option.title}</strong><small>{option.description}</small></span>
            {outcome === option.value && <span className="decision-card__check" aria-hidden="true">✓</span>}
          </label>
        ))}
      </fieldset>

      {(outcome === 'modified' || outcome === 'rejected') && <>
        <label htmlFor="manager-reason">修改原因</label>
        <textarea id="manager-reason" value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="manager-reason-hint" rows={3} />
        <p className="hint" id="manager-reason-hint">修改或驳回 Agent 建议时必填，将作为人工判断留痕。</p>
      </>}

      <label htmlFor="manager-severity">严重度</label>
      <select id="manager-severity" value={severity} onChange={(event) => {
        const nextSeverity = event.target.value as ManagerDecision['severity']
        setSeverity(nextSeverity)
        if (nextSeverity !== initialSeverity) setOutcome('modified')
      }}>
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
        <option value="critical">严重</option>
      </select>

      <label htmlFor="manager-start-8d" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
        <input id="manager-start-8d" type="checkbox" checked={start8d} onChange={(event) => {
          setStart8d(event.target.checked)
          if (event.target.checked !== initialStart8d) setOutcome('modified')
        }} />
        启动 8D 流程
      </label>
      <p className="hint">调整严重度或 8D 选项将自动标记为“修改 Agent 建议”。</p>

      {error && <p role="alert">{error}</p>}

      <div className="submit-bar submit-bar--sticky">
        <p className="hint">确认后将生成客户首响、内部工单和 8D 初版（D1–D3）。</p>
        <button type="submit" disabled={!outcome || submitting}>{submitting ? '正在生成…' : '生成首次处理包'}</button>
      </div>
    </form>
  </section>
}
