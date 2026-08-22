import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import type { Attachment } from '../../contracts/case'
import { LOCAL_DEMO_COMPLAINT_CONTENT } from '../../demo/mainComplaint'
import { CASE_ENTRY_STEPS } from '../../domain/presentation'
import { validateImageAttachment } from '../../services/attachments'
import type { AgentApi } from '../../services/agentApi'
import type { AttachmentUpload } from '../../services/cloudbase'

export function NewCasePage({ api, uploadAttachment, onCreated }: { api: Pick<AgentApi, 'createCase'>; uploadAttachment: AttachmentUpload; onCreated?: (id: string) => void }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isExample = searchParams.get('preset') === 'main'
  const [content, setContent] = useState(isExample ? LOCAL_DEMO_COMPLAINT_CONTENT : '')
  const [file, setFile] = useState<File>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const exampleLoaded = isExample && content === LOCAL_DEMO_COMPLAINT_CONTENT

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

  return <main className="page">
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
      {isExample
        ? <button type="button" className="secondary" disabled={exampleLoaded} onClick={() => setContent(LOCAL_DEMO_COMPLAINT_CONTENT)}>恢复示例原文</button>
        : <button type="button" className="secondary" onClick={() => setContent(LOCAL_DEMO_COMPLAINT_CONTENT)}>载入演示示例</button>}

      <label htmlFor="image-attachment">图片附件</label>
      <input id="image-attachment" type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={selectFile} />
      <p className="hint">仅支持 JPEG、PNG、GIF 或 WebP 图片，单个文件不超过 5MB。</p>
      {file && <p>已选择图片：{file.name}</p>}
      {error && <p id="case-error" role="alert">{error}</p>}

      <section className="expectation" aria-label="提交后会发生什么">
        <h3>提交后会发生什么</h3>
        <ul>
          <li>Agent 自动抽取：客户、产品、批次、缺陷、数量、影响、客户诉求</li>
          <li>识别缺失信息并评估风险，给出处理建议</li>
          <li>预计耗时约 10–30 秒，创建案件后进入 Agent 分析页</li>
        </ul>
      </section>

      <div className="submit-bar">
        <Link className="button secondary" to="/">取消并返回工作台</Link>
        <button type="submit" disabled={submitting}>{submitting ? '正在创建案件…' : '创建案件并开始分析'}</button>
      </div>
    </form>
  </main>
}
