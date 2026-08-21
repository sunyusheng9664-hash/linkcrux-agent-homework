import { FormEvent, useState } from 'react'

type GeneratedItem = { id: string; type: string; title: string; status: string; sourceChunkIds: string[] }
type IngestResult = { document: { id: string; name: string; status: string }; items: GeneratedItem[] }
const KNOWLEDGE_CATEGORIES = {
  internal_document: { label: '内部文档', sourceType: 'enterprise_document' },
  sop: { label: 'SOP', sourceType: 'enterprise_document' },
  faq: { label: 'FAQ', sourceType: 'enterprise_document' },
  workflow: { label: '流程说明', sourceType: 'enterprise_document' },
  system_navigation: { label: '系统路径', sourceType: 'enterprise_document' },
  script: { label: '话术', sourceType: 'enterprise_document' },
  historical_case: { label: '历史案例', sourceType: 'historical_case' },
} as const
type KnowledgeCategory = keyof typeof KNOWLEDGE_CATEGORIES

export function KnowledgeUploadForm({ api }: { api: { ingestKnowledge(input: Record<string, unknown>): Promise<IngestResult> } }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('来料异常处理')
  const [category, setCategory] = useState<KnowledgeCategory>('sop')
  const [version, setVersion] = useState('draft')
  const [result, setResult] = useState<IngestResult>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true); setError(undefined)
    try {
      const selected = KNOWLEDGE_CATEGORIES[category]
      setResult(await api.ingestKnowledge({
        name: `${selected.label}｜${name.trim()}.md`, mimeType: 'text/markdown', sourceType: selected.sourceType, originalFileId: `text-paste:${category}`, version: version.trim(),
        text, owner: '质量部', scope: {}, visibility: 'quality_manager', effectiveAt: new Date().toISOString(),
      }))
    } catch { setError('知识条目生成失败，请检查正文或稍后重试。') } finally { setSubmitting(false) }
  }

  return <section className="panel" aria-labelledby="knowledge-upload-heading">
    <h2 id="knowledge-upload-heading">知识入库</h2>
    <p>将内部文档、SOP、FAQ、流程说明、系统路径、话术或历史案例整理为待审核候选；生成结果不会自动发布或参与正式回答。</p>
    <form onSubmit={submit}>
      <label htmlFor="knowledge-name">资料名称</label>
      <input id="knowledge-name" value={name} onChange={(event) => setName(event.target.value)} required />
      <label htmlFor="knowledge-category">资料类别</label>
      <select id="knowledge-category" value={category} onChange={(event) => setCategory(event.target.value as KnowledgeCategory)}>{Object.entries(KNOWLEDGE_CATEGORIES).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
      <label htmlFor="knowledge-version">版本</label>
      <input id="knowledge-version" value={version} onChange={(event) => setVersion(event.target.value)} required />
      <label htmlFor="knowledge-text">知识正文</label>
      <textarea id="knowledge-text" value={text} onChange={(event) => setText(event.target.value)} required rows={8} />
      <button type="submit" disabled={submitting}>{submitting ? '正在生成…' : '生成待审核条目'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label="入库结果"><p>来源：{result.document.name}；状态：{result.document.status === 'parsed' ? '已解析' : result.document.status}</p>
      <ul>{result.items.map((item) => <li key={item.id}><strong>{item.title}</strong>（{item.type}）<span>待审核</span><small> 引用分段：{item.sourceChunkIds.join('、')}</small></li>)}</ul>
    </section>}
  </section>
}
