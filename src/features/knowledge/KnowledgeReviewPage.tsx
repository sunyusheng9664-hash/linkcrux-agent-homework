import { useEffect, useState } from 'react'
import { KnowledgeCitation } from './KnowledgeCitation'

type PendingItem = { id: string; title: string; type: string; status: string; sourceChunkIds: string[] }
type CitationSource = { documentName: string; version: string; chunks: Array<{ sequence: number; text: string }> }

export function KnowledgeReviewPage({ api }: { api: { listPendingKnowledge(): Promise<PendingItem[]>; reviewKnowledge(id: string, status: 'published' | 'rejected'): Promise<unknown>; getKnowledgeCitation(id: string): Promise<CitationSource> } }) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [citations, setCitations] = useState<Record<string, CitationSource>>({})
  const [error, setError] = useState<string>()
  useEffect(() => { void api.listPendingKnowledge().then(setItems).catch(() => setError('待审核队列加载失败。')) }, [api])
  async function review(id: string, status: 'published' | 'rejected') {
    try { await api.reviewKnowledge(id, status); setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item)) } catch { setError('审核操作失败，请重试。') }
  }
  async function viewCitation(id: string) {
    try { const citation = await api.getKnowledgeCitation(id); setCitations((current) => ({ ...current, [id]: citation })) } catch { setError('引用来源加载失败，请重试。') }
  }
  return <main className="page"><header><h1>知识审核</h1><p>发布前请核对来源分段；只有审核通过的条目会进入正式问答。</p></header>{error && <p role="alert">{error}</p>}
    <section className="panel"><h2>待审核条目</h2>{items.length === 0 ? <p>暂无待审核条目</p> : <ul>{items.map((item) => <li key={item.id}><strong>{item.title}</strong>（{item.type}）<p>引用分段：{item.sourceChunkIds.join('、')}</p><button className="secondary" onClick={() => void viewCitation(item.id)}>查看引用</button>{citations[item.id] && <KnowledgeCitation {...citations[item.id]} />}<p>{item.status === 'published' ? '已发布' : item.status === 'rejected' ? '已驳回' : '待审核'}</p>{item.status === 'pending_review' && <div className="actions"><button onClick={() => void review(item.id, 'published')}>发布条目</button><button className="secondary" onClick={() => void review(item.id, 'rejected')}>驳回条目</button></div>}</li>)}</ul>}</section>
  </main>
}
