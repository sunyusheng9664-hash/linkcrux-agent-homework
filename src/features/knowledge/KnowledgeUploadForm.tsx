import { FormEvent, useState } from 'react'

import { visibilityLabel } from '../../domain/presentation'

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

const EXAMPLE_FIXTURE = {
  name: '来料异常处理',
  version: 'v1',
  category: 'sop' as KnowledgeCategory,
  text: '# 来料异常临时遏制\n发现尺寸超差时：1. 立即隔离待核批次库存；2. 暂停关联批次发运；3. 保全样品与测量记录。',
}

const MAX_FILE_BYTES = 5 * 1024 * 1024
const TEXT_FILE_TYPES = ['text/plain', 'text/markdown', '.txt', '.md']
const SERVER_PARSED_TYPES = ['.pdf', '.docx', 'application/pdf']

export function KnowledgeUploadForm({ api }: { api: { ingestKnowledge(input: Record<string, unknown>): Promise<IngestResult> } }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<KnowledgeCategory>('sop')
  const [version, setVersion] = useState('v1')
  // 必填 / 必选项给一组合理默认值，让面试官一键即可生成；按需再改。
  const [customers, setCustomers] = useState('华东精工')
  const [products, setProducts] = useState('BR-2045')
  const [factories, setFactories] = useState('杭州一厂')
  const [visibility, setVisibility] = useState<'quality_team' | 'quality_manager' | 'knowledge_owner'>('quality_team')
  const [effectiveDate, setEffectiveDate] = useState(() => formatDateInput(new Date()))
  const [expiresDate, setExpiresDate] = useState(() => formatDateInput(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)))
  const [confidentiality, setConfidentiality] = useState<'internal' | 'confidential'>('internal')
  const [fileStatus, setFileStatus] = useState<string>()
  const [isExample, setIsExample] = useState(false)
  const [result, setResult] = useState<IngestResult>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  function loadExample() {
    setName(EXAMPLE_FIXTURE.name)
    setVersion(EXAMPLE_FIXTURE.version)
    setCategory(EXAMPLE_FIXTURE.category)
    setText(EXAMPLE_FIXTURE.text)
    setIsExample(true)
    setFileStatus(undefined)
    // 适用范围与有效期保留页面默认值；面试官可一键提交，不必逐项填写。
  }

  async function selectFile(file: File | undefined) {
    setFileStatus(undefined)
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setFileStatus('文件超过 5MB 上限，请压缩后重试。'); return }
    const isText = TEXT_FILE_TYPES.some((type) => file.type === type || file.name.toLowerCase().endsWith(type))
    const isServerParsed = SERVER_PARSED_TYPES.some((type) => file.type === type || file.name.toLowerCase().endsWith(type))
    if (isText) {
      try {
        const content = await readFileText(file)
        setText(content)
        setFileStatus(`已读取 ${file.name}（${content.length} 字符），可继续编辑后生成。`)
      } catch {
        setFileStatus(`读取 ${file.name} 失败，请改用文本粘贴。`)
      }
      return
    }
    if (isServerParsed) {
      setFileStatus(`${file.name} 为 ${file.name.split('.').pop()?.toUpperCase()} 格式，需由部署后的服务端解析。本地模式请粘贴文本或上传 TXT/Markdown。`)
      return
    }
    setFileStatus(`不支持 ${file.name} 的格式，请使用 TXT/Markdown 或直接粘贴文本。`)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true); setError(undefined)
    try {
      const selected = KNOWLEDGE_CATEGORIES[category]
      const scope = {
        ...(splitList(customers).length ? { customers: splitList(customers) } : {}),
        ...(splitList(products).length ? { products: splitList(products) } : {}),
        ...(splitList(factories).length ? { factories: splitList(factories) } : {}),
      }
      const effectiveAt = effectiveDate ? new Date(effectiveDate).toISOString() : new Date().toISOString()
      const expiresAt = expiresDate ? new Date(expiresDate).toISOString() : undefined
      setResult(await api.ingestKnowledge({
        name: `${selected.label}｜${name.trim()}.md`, mimeType: 'text/markdown', sourceType: selected.sourceType, originalFileId: `text-paste:${category}`, version: version.trim() || 'v1',
        text, owner: '质量部', scope, visibility, effectiveAt, expiresAt, confidentiality,
      }))
    } catch { setError('知识条目生成失败，请检查正文或稍后重试。') } finally { setSubmitting(false) }
  }

  return <section className="panel" aria-labelledby="knowledge-upload-heading">
    <h2 id="knowledge-upload-heading">知识入库</h2>
    <p>将内部文档、SOP、FAQ 等整理为待审核候选；生成结果不会自动发布或参与正式回答。</p>

    <div className="actions">
      <button type="button" className="secondary" onClick={loadExample}>载入示例</button>
      {isExample && <span className="demo-badge">演示数据 · 示例已载入</span>}
    </div>

    <form className="form" onSubmit={submit}>
      <label htmlFor="knowledge-name">资料名称</label>
      <input id="knowledge-name" value={name} onChange={(event) => { setName(event.target.value); setIsExample(false) }} placeholder="例如：来料异常处理规范" required />

      <label htmlFor="knowledge-category">资料类别</label>
      <select id="knowledge-category" value={category} onChange={(event) => setCategory(event.target.value as KnowledgeCategory)}>{Object.entries(KNOWLEDGE_CATEGORIES).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>

      <label htmlFor="knowledge-version">版本</label>
      <input id="knowledge-version" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="例如：v1.0（草稿是系统状态，不是版本号）" required />

      <label htmlFor="knowledge-file">上传文件（可选）</label>
      <input id="knowledge-file" type="file" accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf" onChange={(event) => void selectFile(event.target.files?.[0])} />
      <p className="hint">支持 TXT / Markdown 直接读取；PDF / DOCX 需部署后由服务端解析。单个文件不超过 5MB。</p>
      {fileStatus && <p className="file-status">{fileStatus}</p>}

      <label htmlFor="knowledge-text">知识正文</label>
      <textarea id="knowledge-text" value={text} onChange={(event) => { setText(event.target.value); setIsExample(false) }} required rows={8} />

      <fieldset className="governance-fields">
        <legend>适用范围与权限（已填入常用默认值，可直接提交或按需修改）</legend>
        <div className="knowledge-section">
          <h3 className="knowledge-section__title">适用范围</h3>
          <label htmlFor="knowledge-customers">适用客户（逗号分隔，可空表示不限）</label>
          <input id="knowledge-customers" value={customers} onChange={(event) => setCustomers(event.target.value)} placeholder="例如：华东精工" />
          <label htmlFor="knowledge-products">适用产品（逗号分隔，可空表示不限）</label>
          <input id="knowledge-products" value={products} onChange={(event) => setProducts(event.target.value)} placeholder="例如：BR-2045" />
          <label htmlFor="knowledge-factories">适用工厂（逗号分隔，可空表示不限）</label>
          <input id="knowledge-factories" value={factories} onChange={(event) => setFactories(event.target.value)} placeholder="例如：杭州一厂" />
        </div>
        <div className="knowledge-section">
          <h3 className="knowledge-section__title">权限与有效期</h3>
          <label htmlFor="knowledge-visibility">可见角色</label>
          <select id="knowledge-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}>
            <option value="quality_team">质量团队</option>
            <option value="quality_manager">质量经理</option>
            <option value="knowledge_owner">知识负责人</option>
          </select>
          <label htmlFor="knowledge-effective">生效日期</label>
          <input id="knowledge-effective" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
          <label htmlFor="knowledge-expires">失效日期（可选）</label>
          <input id="knowledge-expires" type="date" value={expiresDate} onChange={(event) => setExpiresDate(event.target.value)} />
          <label htmlFor="knowledge-confidentiality">保密级别</label>
          <select id="knowledge-confidentiality" value={confidentiality} onChange={(event) => setConfidentiality(event.target.value as typeof confidentiality)}>
            <option value="internal">内部</option>
            <option value="confidential">机密</option>
          </select>
        </div>
      </fieldset>

      <button type="submit" disabled={submitting}>{submitting ? '正在生成…' : '生成待审核条目'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label="入库结果"><p>来源：{result.document.name}；状态：{result.document.status === 'parsed' ? '已解析' : result.document.status}；可见角色：{visibilityLabel(visibility)}</p>
      <ul>{result.items.map((item) => <li key={item.id}><strong>{item.title}</strong>（{item.type}）<span>待审核</span><small> 引用分段：{item.sourceChunkIds.join('、')}</small></li>)}</ul>
    </section>}
  </section>
}

function splitList(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
}

function formatDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}


function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('FILE_READ_FAILED'))
    reader.readAsText(file)
  })
}
