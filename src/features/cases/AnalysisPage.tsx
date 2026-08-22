import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import type { CaseFactField, CaseRecord, ManagerDecision, RiskSignal } from '../../contracts/case'
import { confidenceLevel, factLabel, formatCaseNumber } from '../../domain/presentation'
import type { AgentApi } from '../../services/agentApi'
import { EvidenceTag } from './EvidenceTag'
import { ManagerDecisionForm } from './ManagerDecisionForm'
import { HandoffPanel } from '../handoff/HandoffPanel'
import { KnowledgeCheckPanel } from '../knowledge/KnowledgeCheckPanel'

const FACT_LABELS: Record<CaseFactField, string> = {
  customer: '客户',
  product: '产品',
  batch: '批次',
  defect: '缺陷',
  quantity: '数量',
  impact: '影响',
  request: '客户诉求',
}

const ANALYSIS_FAILURE_LABELS = {
  MODEL_CONFIG_MISSING: '模型配置缺失',
  MODEL_REQUEST_FAILED: '模型请求失败',
  MODEL_RESPONSE_INVALID: '模型响应无效',
  MODEL_SCHEMA_INVALID: '模型结构无效',
  MODEL_UNAVAILABLE: '模型不可用',
} as const

export function AnalysisPage({ api }: { api: Pick<AgentApi, 'getCase' | 'analyzeCase' | 'confirmCase'> & Partial<Pick<AgentApi, 'listHandoffs' | 'answerKnowledge'>> }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [caseRecord, setCaseRecord] = useState<CaseRecord>()
  const [handoffs, setHandoffs] = useState<Awaited<ReturnType<AgentApi['listHandoffs']>>>([])
  const [error, setError] = useState<string>()
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [highlight, setHighlight] = useState<string>()
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    let active = true
    async function load() {
      if (!id) { setError('案件编号无效'); return }
      try {
        const found = await api.getCase(id)
        const analyzed = found.analysis ? found : await api.analyzeCase(id)
        const packets = api.listHandoffs ? await api.listHandoffs(id) : []
        if (active) { setCaseRecord(analyzed); setHandoffs(packets) }
      } catch {
        if (active) setError('案件分析加载失败，请重试')
      }
    }
    void load()
    return () => { active = false }
  }, [api, id])

  if (error) return <main className="page"><p role="alert">{error}</p></main>
  if (!caseRecord?.analysis) return <main className="page"><p>正在分析案件…</p></main>

  const analysis = caseRecord.analysis
  const facts = { ...caseRecord.facts, ...analysis.facts }
  async function confirm(decision: ManagerDecision) {
    if (!id) return
    await api.confirmCase({ id, ...decision })
    navigate(`/cases/${id}/initial-pack`)
  }

  function locateInOriginal(text: string) {
    setHighlight(text)
    setDetailsOpen(true)
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const risk = analysis.riskSuggestion[0]
  const confidence = confidenceLevel(analysis.confidence)

  return <main className="page analysis-page">
    <nav className="breadcrumb" aria-label="面包屑">
      <Link to="/">工作台</Link><span aria-hidden="true">/</span><span>案件 {formatCaseNumber(caseRecord.id)}</span><span aria-hidden="true">/</span><span aria-current="page">案件分析</span>
    </nav>
    <header><h1>案件分析与人工判断</h1><p>Agent 负责整理证据和建议；质量经理负责最终业务判断。</p></header>

    <section className="panel decision-summary" aria-labelledby="decision-summary-heading">
      <h2 id="decision-summary-heading">案件决策摘要</h2>
      <dl className="summary-grid">
        <div><dt>风险等级</dt><dd>{risk
          ? <span className="risk-level risk-level--danger">{risk.label}（必须人工处理）</span>
          : <span className="risk-level">未识别到硬风险</span>}</dd></div>
        <div><dt>缺失信息</dt><dd>{analysis.missingFields.length > 0
          ? analysis.missingFields.map((field) => <span key={field} className="chip">{factLabel(field)}</span>)
          : '无'}</dd></div>
        <div><dt>推荐动作</dt><dd>{analysis.departmentSuggestion.join('、')}{analysis.start8dSuggestion ? '；建议启动 8D' : ''}</dd></div>
        <div><dt>响应时限</dt><dd>{analysis.slaSuggestion}</dd></div>
      </dl>
    </section>

    <details className="panel" open={detailsOpen} ref={detailsRef} aria-labelledby="complaint-evidence-heading">
      <summary id="complaint-evidence-heading">投诉原文与附件<EvidenceTag kind="statement" /></summary>
      <p>{highlight ? <HighlightedText text={caseRecord.content} highlight={highlight} /> : caseRecord.content}</p>
      <h3><EvidenceTag kind="statement" /> 客户陈述（待核实）</h3>
      <FactList facts={caseRecord.facts ?? {}} emptyText="暂无单独录入的结构化事实" />
      <h3>附件</h3>
      {caseRecord.attachments.length > 0
        ? <ul>{caseRecord.attachments.map((attachment) => <li key={attachment.fileId}><span>{attachment.originalName}</span>（{attachment.mimeType}，{attachment.size} bytes）</li>)}</ul>
        : <p>无附件</p>}
    </details>

    <section className="panel" aria-labelledby="agent-analysis-heading">
      <h2 id="agent-analysis-heading">Agent 分析建议</h2>
      <p>分析状态：{analysis.analysisStatus === 'manual_takeover' ? '人工接管' : 'AI 已完成'}</p>
      {analysis.analysisFailureReason && <p>失败原因：{ANALYSIS_FAILURE_LABELS[analysis.analysisFailureReason]}</p>}
      <h3><EvidenceTag kind="extracted" /> 结构化事实</h3>
      <FactList facts={analysis.facts} emptyText="Agent 未抽取到可溯源事实" />
      <h3><EvidenceTag kind="missing" /> 待补信息</h3>
      {analysis.missingFields.length > 0
        ? <ul className="chip-list">{analysis.missingFields.map((field) => <li key={field} className="chip">{FACT_LABELS[field]}</li>)}</ul>
        : <p>当前无缺失字段</p>}
      <h3><EvidenceTag kind="suggested" /> 风险与处理建议</h3>
      <p>AI 置信度：{confidence.label}（依据 {analysis.evidenceSpans.length} 条证据片段）</p>
      <p>建议部门：{analysis.departmentSuggestion.join('、')}</p>
      <p>建议 SLA：{analysis.slaSuggestion}</p>
      <p>建议启动 8D：{analysis.start8dSuggestion ? '是' : '否'}</p>
      {analysis.riskSuggestion.length > 0
        ? <ul>{analysis.riskSuggestion.map((item) => <RiskItem key={item.code} risk={item} />)}</ul>
        : <p>Agent 未识别到硬风险信号</p>}
      <h3>证据片段</h3>
      {analysis.evidenceSpans.length > 0
        ? <ul className="evidence-list">{analysis.evidenceSpans.map((span, index) => <li key={`${span.field}-${index}`}>
          <span className="evidence-label">{factLabel(span.field as CaseFactField) || span.field}</span>
          <span className="evidence-text">“{span.text}”</span>
          <button type="button" className="secondary small" onClick={() => locateInOriginal(span.text)}>定位到原文</button>
        </li>)}</ul>
        : <p>暂无可引用证据片段</p>}
    </section>

    {handoffs.map((packet) => <HandoffPanel key={packet.id} packet={packet} />)}
    {api.answerKnowledge && <KnowledgeCheckPanel api={{ answerKnowledge: api.answerKnowledge }} caseId={caseRecord.id} scope={caseKnowledgeScope(caseRecord)} facts={facts} />}

    <ManagerDecisionForm
      initialStart8d={analysis.start8dSuggestion}
      requiresHuman={analysis.routing.requiresHuman}
      riskLabel={risk?.label}
      riskEvidence={risk?.evidence}
      slaSuggestion={analysis.slaSuggestion}
      onConfirm={confirm}
    />
  </main>
}

function RiskItem({ risk }: { risk: RiskSignal }) {
  return <li className="risk-item"><strong>{risk.label}</strong>；证据：{risk.evidence}</li>
}

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  const index = text.indexOf(highlight)
  if (index < 0) return <>{text}</>
  return <>{text.slice(0, index)}<mark>{highlight}</mark>{text.slice(index + highlight.length)}</>
}

function caseKnowledgeScope(caseRecord: CaseRecord) {
  const facts = { ...caseRecord.facts, ...caseRecord.analysis?.facts }
  return {
    ...(facts.product ? { products: [facts.product] } : {}),
    ...(facts.customer ? { customers: [facts.customer] } : {}),
  }
}

function FactList({ facts, emptyText }: { facts: Partial<Record<CaseFactField, string>>; emptyText: string }) {
  const entries = Object.entries(facts).filter((entry): entry is [CaseFactField, string] => Boolean(entry[1]?.trim()))
  return entries.length > 0
    ? <dl>{entries.map(([field, value]) => <div key={field}><dt>{FACT_LABELS[field]}</dt><dd>{value}</dd></div>)}</dl>
    : <p>{emptyText}</p>
}
