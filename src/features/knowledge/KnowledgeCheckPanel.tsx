import { useState, type FormEvent } from 'react'

import type { KnowledgeScope } from '../../contracts/knowledge'
import type { AgentApi } from '../../services/agentApi'
import { HandoffPanel } from '../handoff/HandoffPanel'

type KnowledgeAnswer = Awaited<ReturnType<AgentApi['answerKnowledge']>>

function handoffNotice(reason: KnowledgeAnswer['reason']): string {
  if (reason === 'MODEL_FAILED') return '已命中知识，但模型整理失败，已生成案件接管包。'
  if (reason === 'SENSITIVE_REQUEST') return '该问题涉及敏感决策，已生成案件接管包。'
  return '未覆盖当前问题，已生成案件接管包。'
}

export function KnowledgeCheckPanel({ api, caseId, scope }: { api: Pick<AgentApi, 'answerKnowledge'>; caseId: string; scope: KnowledgeScope }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<KnowledgeAnswer>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    setSubmitting(true)
    setError(undefined)
    try { setResult(await api.answerKnowledge({ query: query.trim(), scope, caseId })) } catch { setError('知识核查失败，请转人工处理或稍后重试。') } finally { setSubmitting(false) }
  }

  return <section className="panel" aria-labelledby="knowledge-check-heading">
    <h2 id="knowledge-check-heading">知识核查</h2>
    <p>仅引用已发布、在当前案件范围内命中的知识；未覆盖、低置信度或敏感决策不补全，直接生成案件接管包。</p>
    <form className="form" onSubmit={submit}>
      <label htmlFor="knowledge-question">知识问题</label>
      <textarea id="knowledge-question" value={query} onChange={(event) => setQuery(event.target.value)} rows={3} />
      <button type="submit" disabled={submitting || !query.trim()}>查询已发布知识</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result?.decision === 'answer' && <section aria-label="知识核查结果"><h3>受控知识回答</h3><p>{result.answer}</p>
      {result.citations.length > 0 && <ul aria-label="知识引用">{result.citations.map((citation) => <li key={citation.itemId}>{citation.documentName} {citation.version}（条目 {citation.itemId}；分段 {citation.chunkIds.join('、')}）</li>)}</ul>}
      {result.missingInformation.length > 0 && <p>仍需补充：{result.missingInformation.join('、')}</p>}
    </section>}
    {result?.decision === 'handoff' && <>
      {result.reason === 'HIGH_RISK' && result.answer && result.citations.length > 0
        ? <section aria-label="高风险知识参考"><p>检测到高风险，已转质量经理人工接管。以下仅为已发布知识参考，需人工确认后执行。</p><h3>已发布知识参考（待人工确认）</h3><p>{result.answer}</p><ul aria-label="知识引用">{result.citations.map((citation) => <li key={citation.itemId}>{citation.documentName} {citation.version}（条目 {citation.itemId}；分段 {citation.chunkIds.join('、')}）</li>)}</ul>{result.missingInformation.length > 0 && <p>仍需补充：{result.missingInformation.join('、')}</p>}</section>
        : <p>{handoffNotice(result.reason)}</p>}
      {result.handoff && <HandoffPanel packet={result.handoff} />}
    </>}
  </section>
}
