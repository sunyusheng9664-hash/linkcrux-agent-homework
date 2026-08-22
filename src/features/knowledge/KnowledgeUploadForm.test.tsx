import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeUploadForm } from './KnowledgeUploadForm'

afterEach(cleanup)

describe('KnowledgeUploadForm', () => {
  it('submits source metadata and renders generated cards as pending review', async () => {
    const ingest = vi.fn().mockResolvedValue({
      document: { id: 'doc-1', name: '来料异常 SOP.md', status: 'parsed' },
      items: [{ id: 'item-1', type: 'procedure', title: '临时遏制', status: 'pending_review', sourceChunkIds: ['chunk-1'] }],
    })
    render(<KnowledgeUploadForm api={{ ingestKnowledge: ingest }} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('资料名称'), '来料尺寸异常处理规范')
    await user.selectOptions(screen.getByLabelText('资料类别'), 'faq')
    await user.clear(screen.getByLabelText('版本'))
    await user.type(screen.getByLabelText('版本'), 'v2')
    await user.type(screen.getByLabelText('知识正文'), '# 临时遏制\n发现尺寸超差时先冻结库存。')
    await user.click(screen.getByRole('button', { name: '生成待审核条目' }))

    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      name: 'FAQ｜来料尺寸异常处理规范.md', version: 'v2', sourceType: 'enterprise_document', text: expect.stringContaining('冻结库存'),
    }))
    expect(await screen.findByText('待审核')).toBeVisible()
    expect(screen.getByText('临时遏制')).toBeVisible()
    expect(screen.getByText(/来源：来料异常 SOP.md/)).toBeVisible()
  })

  it('loads an example, applies sensible defaults and submits governance scope fields', async () => {
    const ingest = vi.fn().mockResolvedValue({
      document: { id: 'doc-2', name: 'SOP｜来料异常处理.md', status: 'parsed' },
      items: [{ id: 'item-2', type: 'procedure', title: '临时遏制', status: 'pending_review', sourceChunkIds: ['chunk-1'] }],
    })
    render(<KnowledgeUploadForm api={{ ingestKnowledge: ingest }} />)
    const user = userEvent.setup()

    // 表单加载即带合理默认值，面试官无需逐项填写
    expect(screen.getByLabelText('资料名称')).toHaveValue('')
    expect(screen.getByLabelText(/适用客户/)).toHaveValue('华东精工')
    expect(screen.getByLabelText(/适用产品/)).toHaveValue('BR-2045')
    expect(screen.getByLabelText(/适用工厂/)).toHaveValue('杭州一厂')
    expect(screen.getByLabelText(/生效日期/).getAttribute('value')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(screen.getByLabelText(/失效日期/).getAttribute('value')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await user.click(screen.getByRole('button', { name: '载入示例' }))
    expect(screen.getByText('演示数据 · 示例已载入')).toBeVisible()
    expect(screen.getByLabelText('资料名称')).toHaveValue('来料异常处理')

    await user.clear(screen.getByLabelText(/适用产品/))
    await user.type(screen.getByLabelText(/适用产品/), 'BR-2045, P-100')
    await user.selectOptions(screen.getByLabelText(/可见角色/), 'quality_manager')
    await user.selectOptions(screen.getByLabelText(/保密级别/), 'confidential')
    await user.click(screen.getByRole('button', { name: '生成待审核条目' }))

    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      scope: { customers: ['华东精工'], products: ['BR-2045', 'P-100'], factories: ['杭州一厂'] },
      visibility: 'quality_manager',
      confidentiality: 'confidential',
    }))
    expect(await screen.findByText(/可见角色：质量经理/)).toBeVisible()
  })

  it('reads TXT/Markdown file content and explains server-parsed formats', async () => {
    const ingest = vi.fn()
    render(<KnowledgeUploadForm api={{ ingestKnowledge: ingest }} />)
    const user = userEvent.setup()

    const md = new File(['# 冻结库存\n发现异常先隔离。'], 'sop.md', { type: 'text/markdown' })
    await user.upload(screen.getByLabelText('上传文件（可选）'), md)
    await waitFor(() => expect(screen.getByLabelText('知识正文')).toHaveValue('# 冻结库存\n发现异常先隔离。'))

    const pdf = new File(['pdf-bytes'], 'sop.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('上传文件（可选）'), pdf)
    expect(await screen.findByText(/PDF 格式，需由部署后的服务端解析/)).toBeVisible()
  })
})
