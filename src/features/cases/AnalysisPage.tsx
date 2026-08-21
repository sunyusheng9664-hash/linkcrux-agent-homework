import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { CaseFactField, CaseRecord, ManagerDecision } from '../../contracts/case'
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
  async function confirm(decision: ManagerDecision) {
    if (!id) return
    await api.confirmCase({ id, ...decision })
    navigate(`/cases/${id}/initial-pack`)
  }

  return <main className="page analysis-page">
    <header><h1>案件分析与人工判断</h1><p>Agent 负责整理证据和建议；质量经理负责最终业务判断。</p></header>

    <section className="panel" aria-labelledby="complaint-evidence-heading">
      <h2 id="complaint-evidence-heading">投诉原文与附件</h2>
      <p>{caseRecord.content}</p>
      <h3><EvidenceTag kind="verified" /> 人工录入事实</h3>
      <FactList facts={caseRecord.facts ?? {}} emptyText="暂无单独录入的结构化事实" />
      <h3>附件</h3>
      {caseRecord.attachments.length > 0
        ? <ul>{caseRecord.attachments.map((attachment) => <li key={attachment.fileId}><span>{attachment.originalName}</span>（{attachment.mimeType}，{attachment.size} bytes）</li>)}</ul>
        : <p>无附件</p>}
    </section>

    <section className="panel" aria-labelledby="agent-analysis-heading">
      <h2 id="agent-analysis-heading">Agent 分析建议</h2>
      <p>分析状态：{analysis.analysisStatus === 'manual_takeover' ? '人工接管' : 'AI 已完成'}</p>
      {analysis.analysisFailureReason && <p>失败原因：{ANALYSIS_FAILURE_LABELS[analysis.analysisFailureReason]}</p>}
      <h3><EvidenceTag kind="extracted" /> 结构化事实</h3>
      <FactList facts={analysis.facts} emptyText="Agent 未抽取到可溯源事实" />
      <h3><EvidenceTag kind="missing" /> 待补信息</h3>
      {analysis.missingFields.length > 0
        ? <ul>{analysis.missingFields.map((field) => <li key={field}>{FACT_LABELS[field]}</li>)}</ul>
        : <p>当前无缺失字段</p>}
      <h3><EvidenceTag kind="suggested" /> 风险与处理建议</h3>
      <p>置信度：{Math.round(analysis.confidence * 100)}%</p>
      <p>建议部门：{analysis.departmentSuggestion.join('、')}</p>
      <p>建议 SLA：{analysis.slaSuggestion}</p>
      <p>建议启动 8D：{analysis.start8dSuggestion ? '是' : '否'}</p>
      {analysis.riskSuggestion.length > 0
        ? <ul>{analysis.riskSuggestion.map((risk) => <li key={risk.code}>{risk.label}；证据：{risk.evidence}</li>)}</ul>
        : <p>Agent 未识别到硬风险信号</p>}
      <h3>证据片段</h3>
      {analysis.evidenceSpans.length > 0
        ? <ul>{analysis.evidenceSpans.map((span, index) => <li key={`${span.field}-${index}`}>{span.field}：“{span.text}”</li>)}</ul>
        : <p>暂无可引用证据片段</p>}
    </section>

    {handoffs.map((packet) => <HandoffPanel key={packet.id} packet={packet} />)}
    {api.answerKnowledge && <KnowledgeCheckPanel api={{ answerKnowledge: api.answerKnowledge }} caseId={caseRecord.id} scope={caseKnowledgeScope(caseRecord)} />}

    <ManagerDecisionForm
      initialStart8d={analysis.start8dSuggestion}
      requiresHuman={analysis.routing.requiresHuman}
      onConfirm={confirm}
    />
  </main>
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
