import { useEffect, useState } from 'react'
import { formatDateTime, visibilityLabel } from '../../domain/presentation'
import { KnowledgeCitation } from './KnowledgeCitation'

type PendingItem = {
  id: string; title: string; type: string; status: string; sourceChunkIds: string[]
  owner?: string; createdBy?: string; reviewedBy?: string; reviewedAt?: string; rejectionReason?: string
  scope?: { customers?: string[]; products?: string[]; factories?: string[]; processes?: string[] }
  visibility?: string; effectiveAt?: string; expiresAt?: string; confidentiality?: string
}
type CitationSource = { documentName: string; version: string; chunks: Array<{ sequence: number; text: string }> }

const TYPE_LABELS: Record<string, string> = {
  qa: '问答', procedure: '流程步骤', rule: '规则', navigation: '系统路径', script: '话术', case: '案例',
}
const BUSINESS_STATUS: Record<string, string> = {
  draft: '草稿', pending_review: '待审核', published: '已发布', expired: '已失效', rejected: '已驳回', impacted: '已失效',
}

export function KnowledgeReviewPage({ api }: { api: { listPendingKnowledge(): Promise<PendingItem[]>; reviewKnowledge(id: string, status: 'published' | 'rejected', reason?: string): Promise<unknown>; getKnowledgeCitation(id: string): Promise<CitationSource> } }) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [citations, setCitations] = useState<Record<string, CitationSource>>({})
  const [confirmScope, setConfirmScope] = useState<Record<string, boolean>>({})
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  useEffect(() => { void api.listPendingKnowledge().then(setItems).catch(() => setError('待审核队列加载失败。')) }, [api])
  async function review(id: string, status: 'published' | 'rejected', reason?: string) {
    try { await api.reviewKnowledge(id, status, reason); setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item)) } catch { setError('审核操作失败，请重试。') }
  }
  async function viewCitation(id: string) {
    try { const citation = await api.getKnowledgeCitation(id); setCitations((current) => ({ ...current, [id]: citation })) } catch { setError('引用来源加载失败，请重试。') }
  }
  function publish(item: PendingItem) {
    if (!confirmScope[item.id]) { setError('请先确认该条目的适用范围后再发布。'); return }
    setError(undefined)
    void review(item.id, 'published')
  }
  function reject(item: PendingItem) {
    const reason = rejectReasons[item.id]?.trim()
    if (!reason) { setError('驳回时必须填写原因，原因将回流到知识沉淀记录。'); return }
    setError(undefined)
    void review(item.id, 'rejected', reason)
  }

  return <main className="page"><header><h1>知识审核</h1><p>发布前请核对来源、适用范围与有效期；只有审核通过的条目会进入正式问答。</p></header>{error && <p role="alert">{error}</p>}
    <section className="panel" aria-labelledby="pending-heading"><h2 id="pending-heading">待审核条目</h2>{items.length === 0 ? <p>暂无待审核条目</p> : <ul className="review-list">{items.map((item) => <li key={item.id} className="review-card">
      <div className="review-card__head">
        <strong>{item.title}</strong>
        <span className="status-badge status-badge--warning">{BUSINESS_STATUS[item.status] ?? item.status}</span>
      </div>
      <p className="hint">类型：{TYPE_LABELS[item.type] ?? item.type}；引用分段：{item.sourceChunkIds.join('、')}</p>
      <dl className="summary-grid review-metadata">
        <div><dt>上传人</dt><dd>{item.createdBy ?? '未知'}</dd></div>
        <div><dt>负责人</dt><dd>{item.owner ?? '未知'}</dd></div>
        <div><dt>可见角色</dt><dd>{item.visibility ? visibilityLabel(item.visibility as 'quality_team' | 'quality_manager' | 'knowledge_owner') : '未配置'}</dd></div>
        <div><dt>适用范围</dt><dd>{formatScope(item.scope)}</dd></div>
        <div><dt>有效期</dt><dd>{item.effectiveAt ? `${formatDateTime(item.effectiveAt)}${item.expiresAt ? ` 至 ${formatDateTime(item.expiresAt)}` : ' 起（长期）'}` : '未配置'}</dd></div>
        <div><dt>保密级别</dt><dd>{item.confidentiality === 'confidential' ? '机密' : item.confidentiality === 'internal' ? '内部' : '未配置'}</dd></div>
        {item.reviewedBy && <div><dt>审核人</dt><dd>{item.reviewedBy}{item.reviewedAt ? `（${formatDateTime(item.reviewedAt)}）` : ''}</dd></div>}
        {item.rejectionReason && <div><dt>驳回原因</dt><dd>{item.rejectionReason}</dd></div>}
      </dl>
      <button className="secondary" onClick={() => void viewCitation(item.id)}>查看引用</button>
      {citations[item.id] && <KnowledgeCitation {...citations[item.id]} />}
      {item.status === 'pending_review' && <div className="review-actions">
        <label className="confirm-line"><input type="checkbox" checked={Boolean(confirmScope[item.id])} onChange={(event) => setConfirmScope((current) => ({ ...current, [item.id]: event.target.checked }))} /> 我确认该条目的适用范围与可见角色配置正确</label>
        <div className="actions">
          <button onClick={() => publish(item)}>发布条目</button>
          <button className="secondary" onClick={() => reject(item)}>驳回条目</button>
        </div>
        <label htmlFor={`reject-reason-${item.id}`}>驳回原因</label>
        <textarea id={`reject-reason-${item.id}`} value={rejectReasons[item.id] ?? ''} onChange={(event) => setRejectReasons((current) => ({ ...current, [item.id]: event.target.value }))} rows={2} placeholder="填写驳回原因，回流到知识沉淀记录" />
      </div>}
    </li>)}</ul>}</section>
  </main>
}

function formatScope(scope: PendingItem['scope']): string {
  if (!scope) return '未配置'
  const parts: string[] = []
  if (scope.factories?.length) parts.push(`工厂：${scope.factories.join('、')}`)
  if (scope.customers?.length) parts.push(`客户：${scope.customers.join('、')}`)
  if (scope.products?.length) parts.push(`产品：${scope.products.join('、')}`)
  if (scope.processes?.length) parts.push(`工序：${scope.processes.join('、')}`)
  return parts.length ? parts.join('；') : '不限（全量可见范围内）'
}
