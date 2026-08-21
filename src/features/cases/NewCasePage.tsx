import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import type { Attachment } from '../../contracts/case'
import { LOCAL_DEMO_COMPLAINT_CONTENT } from '../../demo/mainComplaint'
import { validateImageAttachment } from '../../services/attachments'
import type { AgentApi } from '../../services/agentApi'
import type { AttachmentUpload } from '../../services/cloudbase'

export function NewCasePage({ api, uploadAttachment, onCreated }: { api: Pick<AgentApi, 'createCase'>; uploadAttachment: AttachmentUpload; onCreated?: (id: string) => void }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [content, setContent] = useState(searchParams.get('preset') === 'main' ? LOCAL_DEMO_COMPLAINT_CONTENT : '')
  const [file, setFile] = useState<File>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

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

  return <main className="page"><header><h1>新建客诉</h1><p>录入投诉原文；Agent 会先准备分析建议，质量经理负责最终判断。</p></header>
    <form className="panel form" onSubmit={submit} noValidate>
      <label htmlFor="complaint-content">客诉内容</label>
      <textarea id="complaint-content" value={content} onChange={(event) => setContent(event.target.value)} aria-describedby={error ? 'case-error' : undefined} rows={8} />
      <button type="button" className="secondary" onClick={() => setContent(LOCAL_DEMO_COMPLAINT_CONTENT)}>载入预置示例</button>
      <label htmlFor="image-attachment">图片附件</label>
      <input id="image-attachment" type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={selectFile} />
      <p className="hint">仅支持 JPEG、PNG、GIF 或 WebP 图片，单个文件不超过 5MB。</p>
      {file && <p>已选择图片：{file.name}</p>}
      {error && <p id="case-error" role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>{submitting ? '正在提交…' : '提交分析'}</button>
    </form>
  </main>
}
