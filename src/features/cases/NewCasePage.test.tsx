import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LOCAL_DEMO_COMPLAINT_CONTENT } from '../../demo/mainComplaint'
import { NewCasePage } from './NewCasePage'

function renderPage(props: React.ComponentProps<typeof NewCasePage>, path = '/cases/new') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/cases/new" element={<NewCasePage {...props} />} /><Route path="/" element={<p>工作台占位</p>} /></Routes></MemoryRouter>)
}

function ExampleProbe() {
  const [params] = useSearchParams()
  return <p data-testid="preset">{params.get('preset') ?? 'none'}</p>
}

afterEach(cleanup)

describe('NewCasePage', () => {
  it('shows an accessible Chinese error when complaint content is missing', async () => {
    const user = userEvent.setup()
    const api = { createCase: vi.fn() }
    const uploadAttachment = vi.fn()
    renderPage({ api, uploadAttachment })
    await user.click(screen.getByRole('button', { name: '创建案件并开始分析' }))
    expect(screen.getByText('请输入客诉内容')).toBeVisible()
    expect(api.createCase).not.toHaveBeenCalled()
  })

  it('rejects an unsafe attachment type before uploading or creating a case', async () => {
    const user = userEvent.setup()
    const api = { createCase: vi.fn() }
    const uploadAttachment = vi.fn()
    renderPage({ api, uploadAttachment })

    fireEvent.change(screen.getByLabelText('图片附件'), { target: { files: [new File(['plain text'], 'notes.txt', { type: 'text/plain' })] } })

    expect(screen.getByText('仅支持图片文件')).toBeVisible()
    expect(uploadAttachment).not.toHaveBeenCalled()
    expect(api.createCase).not.toHaveBeenCalled()
  })

  it('does not create a case when image upload fails', async () => {
    const user = userEvent.setup()
    const api = { createCase: vi.fn() }
    const uploadAttachment = vi.fn().mockRejectedValue(new Error('upload failed'))
    renderPage({ api, uploadAttachment })

    await user.type(screen.getByLabelText('客诉内容'), '客户反馈批次 A 的尺寸超差')
    await user.upload(screen.getByLabelText('图片附件'), new File(['image'], 'evidence.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '创建案件并开始分析' }))

    expect(await screen.findByText('图片上传失败，请重试')).toBeVisible()
    expect(api.createCase).not.toHaveBeenCalled()
  })

  it('reports a submission failure when the case API fails after a successful upload', async () => {
    const user = userEvent.setup()
    const api = { createCase: vi.fn().mockRejectedValue(new Error('api failed')) }
    const uploadAttachment = vi.fn().mockResolvedValue({ fileId: 'cloud://evidence.png', mimeType: 'image/png', size: 5, originalName: 'evidence.png' })
    renderPage({ api, uploadAttachment })

    await user.type(screen.getByLabelText('客诉内容'), '客户反馈批次 A 的尺寸超差')
    await user.upload(screen.getByLabelText('图片附件'), new File(['image'], 'evidence.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '创建案件并开始分析' }))

    expect(await screen.findByText('提交失败，请重试')).toBeVisible()
  })

  it('saves uploaded image metadata instead of a local file path', async () => {
    const user = userEvent.setup()
    const api = { createCase: vi.fn().mockResolvedValue({ id: 'case-1' }) }
    const uploadAttachment = vi.fn().mockResolvedValue({ fileId: 'cloud://evidence.png', mimeType: 'image/png', size: 5, originalName: 'evidence.png' })
    renderPage({ api, uploadAttachment })

    await user.type(screen.getByLabelText('客诉内容'), '客户反馈批次 A 的尺寸超差')
    await user.upload(screen.getByLabelText('图片附件'), new File(['image'], 'evidence.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '创建案件并开始分析' }))

    expect(api.createCase).toHaveBeenCalledWith({
      content: '客户反馈批次 A 的尺寸超差',
      attachments: [{ fileId: 'cloud://evidence.png', mimeType: 'image/png', size: 5, originalName: 'evidence.png' }],
    })
  })

  it('marks the preset example as loaded and explains the flow and submit expectation', async () => {
    const api = { createCase: vi.fn() }
    renderPage({ api, uploadAttachment: vi.fn() }, '/cases/new?preset=main')

    expect(screen.getByText('示例已载入 · 演示数据')).toBeVisible()
    expect(screen.getByLabelText('客诉内容')).toHaveValue(LOCAL_DEMO_COMPLAINT_CONTENT)
    const restore = screen.getByRole('button', { name: '恢复示例原文' })
    expect(restore).toBeDisabled()
    expect(screen.getByLabelText('处理流程')).toHaveTextContent('1录入2Agent 分析3人工判断4首次处理包')
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/')
    expect(screen.getByLabelText('提交后会发生什么')).toHaveTextContent('客户、产品、批次、缺陷、数量、影响、客户诉求')
    expect(screen.getByRole('button', { name: '创建案件并开始分析' })).toBeVisible()
  })
})
