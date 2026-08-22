import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { CaseRecord } from '../../contracts/case'
import { LOCAL_DEMO_COMPLAINT_CONTENT } from '../../demo/mainComplaint'
import { CASE_FLOW_STEPS, caseProgressCompleted, caseStatusMeta, factLabel, formatCaseNumber, formatDateTime } from '../../domain/presentation'
import type { AgentApi } from '../../services/agentApi'

const PREVIEW_LIMIT = 3

export function WorkbenchPage({ api }: { api: Pick<AgentApi, 'listCases'> }) {
  const [cases, setCases] = useState<CaseRecord[]>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    api.listCases().then((records) => {
      if (!active) return
      const sorted = [...records].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      setCases(sorted)
    }).catch(() => {
      if (active) setError('案件读取失败，请刷新页面后重试。')
    })
    return () => { active = false }
  }, [api])

  const needsAttention = (cases ?? []).filter((record) => record.status === 'intake' || record.status === 'analyzed' || record.status === 'confirmed')
  const recent = (cases ?? []).filter((record) => !needsAttention.includes(record))

  return <main className="page">
    <header><h1>质量经理工作台</h1><p>受理客诉、确认 Agent 分析并推进首次处理。</p></header>

    <section className="panel experience-guide" aria-labelledby="experience-guide-heading">
      <h2 id="experience-guide-heading">推荐体验：5 分钟走完一条客诉</h2>
      <ol className="step-guide" aria-label="示例体验步骤">
        {CASE_FLOW_STEPS.map((step, index) => <li key={step}><span className="step-guide__index">{index + 1}</span>{step}</li>)}
      </ol>
      <Link className="button primary-cta" to="/cases/new?preset=main">开始 5 分钟示例体验</Link>
      <p className="hint">从客户投诉出发：结构化分析 → 人工判断 → 客户首响与 8D 初版，全程约 5 分钟。</p>
      <div className="actions">
        <Link className="button secondary" to="/cases/new">新建真实客诉</Link>
        <Link className="button secondary" to="/knowledge">知识库管理</Link>
      </div>
    </section>

    <section className="panel" aria-labelledby="case-overview-heading">
      <h2 id="case-overview-heading">案件概览</h2>
      {!cases && !error && <p role="status">正在读取案件…</p>}
      {error && <p role="alert">{error}</p>}
      {cases?.length === 0 && <div><p>当前还没有客诉案件。</p><Link className="button" to="/cases/new?preset=main">开始示例体验</Link></div>}
      {cases && cases.length > 0 && <>
        {needsAttention.length > 0 && <CaseGroup title="待我处理" records={needsAttention} />}
        {recent.length > 0 && <CaseGroup title="最近更新" records={recent} />}
      </>}
    </section>
  </main>
}

function CaseGroup({ title, records }: { title: string; records: CaseRecord[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? records : records.slice(0, PREVIEW_LIMIT)
  return <section aria-label={title}>
    <h3>{title}<span className="count-badge">{records.length}</span></h3>
    <ul className="case-list">{visible.map((record) => <CaseSummary key={record.id} record={record} />)}</ul>
    {records.length > PREVIEW_LIMIT && !expanded
      && <button type="button" className="secondary" onClick={() => setExpanded(true)}>查看全部（{records.length} 条）</button>}
  </section>
}

function CaseSummary({ record }: { record: CaseRecord }) {
  const facts = record.analysis?.facts ?? record.facts ?? {}
  const title = `${facts.customer || '客户待补充'}｜${facts.product || '产品待补充'}`
  const status = caseStatusMeta(record)
  const completed = caseProgressCompleted(record)
  const missingFields = record.analysis?.missingFields ?? []
  const risk = record.analysis?.riskSuggestion[0]
  const source = record.content === LOCAL_DEMO_COMPLAINT_CONTENT ? '示例' : '录入'
  return <li className="panel case-card">
    <div className="case-card__head">
      <span className="case-number">{formatCaseNumber(record.id)}</span>
      <span className="source-tag">{source}客诉</span>
      <span className={`status-badge status-badge--${status.tone}`}>{status.label}</span>
    </div>
    <h3>{title}</h3>
    <p className="case-card__defect">{facts.defect || excerpt(record.content)}</p>
    {risk && <div className="risk-banner" role="alert"><strong>{risk.label}</strong>：{risk.evidence}，必须人工处理</div>}
    {missingFields.length > 0 && <p className="missing-hint"><span className="missing-hint__label">待补信息</span>{missingFields.map((field) => <span key={field} className="chip">{factLabel(field)}</span>)}</p>}
    <div className="progress" role="progressbar" aria-label={`流程进度 ${completed}/4`} aria-valuenow={completed} aria-valuemin={0} aria-valuemax={4}>
      {CASE_FLOW_STEPS.map((step, index) => <span key={step} className={`progress__step${index < completed ? ' progress__step--done' : ''}`} title={step} />)}
    </div>
    <div className="case-card__foot">
      <span>最近更新 <time dateTime={record.updatedAt}>{formatDateTime(record.updatedAt)}</time></span>
      <Link className="button secondary" to={nextCasePath(record)} aria-label={`继续处理 ${title}`}>继续处理</Link>
    </div>
  </li>
}

function nextCasePath(record: CaseRecord): string {
  return record.status === 'intake' || record.status === 'analyzed'
    ? `/cases/${record.id}/analyze`
    : `/cases/${record.id}/initial-pack`
}

function excerpt(content: string): string {
  return content.length > 80 ? `${content.slice(0, 80)}…` : content
}
