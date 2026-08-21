import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { CaseFactField, CaseRecord, CaseStatus } from '../../contracts/case'
import type { AgentApi } from '../../services/agentApi'

const factLabels: Record<CaseFactField, string> = {
  customer: '客户', product: '产品', batch: '批次', defect: '缺陷',
  quantity: '受影响数量', impact: '影响', request: '客户诉求',
}

export function WorkbenchPage({ api }: { api: Pick<AgentApi, 'listCases'> }) {
  const [cases, setCases] = useState<CaseRecord[]>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    api.listCases().then((records) => {
      if (!active) return
      setCases([...records].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)))
    }).catch(() => {
      if (active) setError('案件读取失败，请刷新页面后重试。')
    })
    return () => { active = false }
  }, [api])

  return <main className="page"><header><h1>质量经理工作台</h1><p>在这里受理客诉、查看待判断事项并推进首次处理。</p></header>
    <section className="panel"><h2>开始处理</h2><div className="actions"><Link className="button" to="/cases/new">新建真实客诉</Link><Link className="button secondary" to="/cases/new?preset=main">开始示例体验</Link><Link className="button secondary" to="/knowledge">知识库管理</Link></div></section>
    <section className="panel"><h2>案件概览</h2>
      {!cases && !error && <p role="status">正在读取案件…</p>}
      {error && <p role="alert">{error}</p>}
      {cases?.length === 0 && <div><p>当前还没有客诉案件。</p><Link className="button" to="/cases/new">新建第一条客诉</Link></div>}
      {cases && cases.length > 0 && <ul className="case-list">{cases.map((record) => <CaseSummary key={record.id} record={record} />)}</ul>}
    </section>
  </main>
}

function CaseSummary({ record }: { record: CaseRecord }) {
  const facts = record.analysis?.facts ?? record.facts ?? {}
  const title = `${facts.customer || '客户待补充'}｜${facts.product || '产品待补充'}`
  const missingFields = record.analysis?.missingFields ?? []
  const highRisk = record.analysis?.routing.highRisk === true
  return <li className="panel">
    <h3>{title}</h3>
    <p>{facts.defect || excerpt(record.content)}</p>
    <p><strong>{caseStatusLabel(record)}</strong></p>
    {highRisk && <p><strong>高风险｜必须人工处理</strong></p>}
    {missingFields.length > 0 && <p>待补信息：{missingFields.map((field) => factLabels[field]).join('、')}</p>}
    <p>最近更新：<time dateTime={record.updatedAt}>{formatDateTime(record.updatedAt)}</time></p>
    <Link className="button secondary" to={nextCasePath(record)} aria-label={`继续处理 ${title}`}>继续处理</Link>
  </li>
}

function caseStatusLabel(record: CaseRecord): string {
  if (record.initialPackStatus === 'generating') return '首次处理包生成中'
  if (record.initialPackStatus === 'manual_handoff') return '首次处理包需人工接管'
  const labels: Record<CaseStatus, string> = {
    intake: '待分析',
    analyzed: '待质量经理判断',
    confirmed: '待生成首次处理包',
    initial_pack: '首次处理包已生成',
  }
  return labels[record.status]
}

function nextCasePath(record: CaseRecord): string {
  return record.status === 'intake' || record.status === 'analyzed'
    ? `/cases/${record.id}/analyze`
    : `/cases/${record.id}/initial-pack`
}

function excerpt(content: string): string {
  return content.length > 80 ? `${content.slice(0, 80)}…` : content
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
