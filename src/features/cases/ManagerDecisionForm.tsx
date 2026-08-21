import { useState, type FormEvent } from 'react'

import { managerSeverityBaseline, type ManagerDecision } from '../../contracts/case'
import { EvidenceTag } from './EvidenceTag'

export function ManagerDecisionForm({
  initialStart8d,
  requiresHuman,
  onConfirm,
}: {
  initialStart8d: boolean
  requiresHuman: boolean
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

  return <section className="panel" aria-labelledby="manager-decision-heading">
    <h2 id="manager-decision-heading">质量经理判断</h2>
    <p><EvidenceTag kind="confirmed" /> 以下结论由质量经理负责确认并留痕。</p>
    <form className="form" onSubmit={submit} noValidate>
      <label htmlFor="requires-human">需要人工处理</label>
      <input id="requires-human" type="checkbox" checked={requiresHuman} disabled readOnly />
      {requiresHuman && <p className="hint">高风险案件已锁定人工处理，浏览器端不可关闭。</p>}

      <label htmlFor="manager-outcome">判断结果</label>
      <select id="manager-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as ManagerDecision['outcome'])}>
        <option value="" disabled>请选择判断结果</option>
        <option value="accepted">接受 Agent 建议</option>
        <option value="modified">修改 Agent 建议</option>
        <option value="rejected">驳回 Agent 建议</option>
      </select>

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

      <label htmlFor="manager-start-8d">是否启动 8D</label>
      <input id="manager-start-8d" type="checkbox" checked={start8d} onChange={(event) => {
        setStart8d(event.target.checked)
        if (event.target.checked !== initialStart8d) setOutcome('modified')
      }} />

      <label htmlFor="manager-reason">修改原因</label>
      <textarea
        id="manager-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-describedby="manager-reason-hint"
        rows={3}
      />
      <p className="hint" id="manager-reason-hint">修改或驳回 Agent 建议时必填；接受原建议时可留空。</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!outcome || submitting}>{submitting ? '正在保存…' : '确认判断'}</button>
    </form>
  </section>
}
