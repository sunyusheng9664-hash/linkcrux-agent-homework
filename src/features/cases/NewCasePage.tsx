import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import type { Attachment } from '../../contracts/case'
import { LOCAL_DEMO_COMPLAINT_EXAMPLES } from '../../demo/mainComplaint'
import { CASE_ENTRY_STEPS, formatFileSize } from '../../domain/presentation'
import { validateImageAttachment } from '../../services/attachments'
import type { AgentApi } from '../../services/agentApi'
import type { AttachmentUpload } from '../../services/cloudbase'

export function NewCasePage({ api, uploadAttachment, onCreated }: { api: Pick<AgentApi, 'createCase'>; uploadAttachment: AttachmentUpload; onCreated?: (id: string) => void }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isExample = searchParams.get('preset') === 'main'
  const [content, setContent] = useState(isExample ? LOCAL_DEMO_COMPLAINT_EXAMPLES[0] : '')
  const [exampleIndex, setExampleIndex] = useState(isExample ? 0 : -1)
  const [file, setFile] = useState<File>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const exampleLoaded = LOCAL_DEMO_COMPLAINT_EXAMPLES.includes(content as typeof LOCAL_DEMO_COMPLAINT_EXAMPLES[number])

  function loadNextExample() {
    const next = exampleIndex < 0 ? 0 : (exampleIndex + 1) % LOCAL_DEMO_COMPLAINT_EXAMPLES.length
    setExampleIndex(next)
    setContent(LOCAL_DEMO_COMPLAINT_EXAMPLES[next])
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    if (!selected) return
    const validationError = validateImageAttachment(selected)
    setError(validationError)
    setFile(validationError ? undefined : selected)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedContent = content.trim()
    if (!trimmedContent) { setError('请输入客诉内容'); return }
    setError(undefined)
    setSubmitting(true)
    try {
      const attachments: Attachment[] = []
      if (file) {
        try {
          attachments.push(await uploadAttachment(file))
        } catch {
          setError('图片上传失败，请重试')
          return
        }
      }
      const created = await api.createCase({ content: trimmedContent, attachments })
      onCreated?.(created.id)
      navigate(`/cases/${created.id}/analyze`)
    } catch {
      setError('提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="page page--narrow">
    <nav className="breadcrumb" aria-label="面包屑">
      <Link to="/">工作台</Link><span aria-hidden="true">/</span><span aria-current="page">新建客诉</span>
    </nav>

    <header>
      <h1>新建客诉</h1>
      <p>录入投诉原文；Agent 会先准备分析建议，质量经理负责最终判断。</p>
    </header>

    <ol className="step-indicator" aria-label="处理流程">
      {CASE_ENTRY_STEPS.map((step, index) => <li key={step} className={index === 0 ? 'step-indicator__item step-indicator__item--current' : 'step-indicator__item'}>
        <span className="step-indicator__index">{index + 1}</span>{step}
      </li>)}
    </ol>

    <form className="panel form" onSubmit={submit} noValidate>
      <div className="field-head">
        <label htmlFor="complaint-content">客诉内容</label>
      {isExample && <span className="demo-badge">示例已载入 · 演示数据</span>}
      </div>
      <textarea id="complaint-content" value={content} onChange={(event) => setContent(event.target.value)} aria-describedby={error ? 'case-error' : undefined} rows={8} />
      <div className="example-bar">
        <button type="button" className="secondary" onClick={loadNextExample}>
          {exampleLoaded ? `🧪 切换下一个示例（${exampleIndex + 1}/${LOCAL_DEMO_COMPLAINT_EXAMPLES.length}）` : '🧪 载入示例投诉'}
        </button>
        {exampleLoaded && <span className="hint">当前为第 {exampleIndex + 1} 个内置示例，共 {LOCAL_DEMO_COMPLAINT_EXAMPLES.length} 个；点击按钮可循环切换。</span>}
      </div>

      <label htmlFor="image-attachment">图片附件</label>
      <input id="image-attachment" type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={selectFile} />
      <p className="hint">仅支持 JPEG、PNG、GIF 或 WebP 图片，单个文件不超过 5MB。</p>
      {file && <p>已选择图片：{file.name}（{formatFileSize(file.size)}）</p>}
      {error && <p id="case-error" role="alert">{error}</p>}

      <section className="expectation" aria-label="提交后会发生什么">
        <h3>提交后 Agent 将</h3>
        <ul>
          <li>① 抽取关键事实：客户、产品、批次、缺陷、数量、影响、客户诉求</li>
          <li>② 评估风险并标出缺失信息</li>
          <li>③ 给出处理建议与 SLA 提示</li>
        </ul>
        <p className="hint">预计 10–30 秒完成</p>
      </section>

      <div className="submit-bar">
        <Link className="text-link" to="/">取消并返回工作台</Link>
        <button type="submit" disabled={submitting}>{submitting ? '正在创建案件…' : '创建案件并开始分析'}</button>
      </div>
    </form>
  </main>
}
