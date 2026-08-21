import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewCasePage } from './NewCasePage'

function renderPage(props: React.ComponentProps<typeof NewCasePage>) {
  return render(<MemoryRouter><NewCasePage {...props} /></MemoryRouter>)
}

afterEach(cleanup)

describe('NewCasePage', () => {
  it('shows an accessible Chinese error when complaint content is missing', async () => {
    const user = userEvent.setup()
    const api = { createCase: vi.fn() }
    const uploadAttachment = vi.fn()
    renderPage({ api, uploadAttachment })
    await user.click(screen.getByRole('button', { name: '提交分析' }))
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
    await user.click(screen.getByRole('button', { name: '提交分析' }))

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
    await user.click(screen.getByRole('button', { name: '提交分析' }))

    expect(await screen.findByText('提交失败，请重试')).toBeVisible()
  })

  it('saves uploaded image metadata instead of a local file path', async () => {
    const user = userEvent.setup()
    const api = { createCase: vi.fn().mockResolvedValue({ id: 'case-1' }) }
    const uploadAttachment = vi.fn().mockResolvedValue({ fileId: 'cloud://evidence.png', mimeType: 'image/png', size: 5, originalName: 'evidence.png' })
    renderPage({ api, uploadAttachment })

    await user.type(screen.getByLabelText('客诉内容'), '客户反馈批次 A 的尺寸超差')
    await user.upload(screen.getByLabelText('图片附件'), new File(['image'], 'evidence.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '提交分析' }))

    expect(api.createCase).toHaveBeenCalledWith({
      content: '客户反馈批次 A 的尺寸超差',
      attachments: [{ fileId: 'cloud://evidence.png', mimeType: 'image/png', size: 5, originalName: 'evidence.png' }],
    })
  })
})
