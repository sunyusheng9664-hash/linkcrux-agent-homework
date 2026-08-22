import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeReviewPage } from './KnowledgeReviewPage'

afterEach(cleanup)

describe('KnowledgeReviewPage', () => {
  it('shows source citations before allowing a knowledge owner to publish a pending item', async () => {
    const api = {
      listPendingKnowledge: vi.fn().mockResolvedValue([{ id: 'item-1', title: '临时遏制', type: 'procedure', status: 'pending_review', sourceChunkIds: ['chunk-1'] }]),
      reviewKnowledge: vi.fn().mockResolvedValue({ id: 'item-1', status: 'published' }),
      getKnowledgeCitation: vi.fn().mockResolvedValue({ documentName: '来料异常 SOP', version: 'v2', chunks: [{ sequence: 3, text: '先冻结疑似库存。' }] }),
    }
    render(<KnowledgeReviewPage api={api} />)
    expect(await screen.findByText('临时遏制')).toBeVisible()
    expect(screen.getByText(/引用分段：chunk-1/)).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: '查看引用' }))
    expect(api.getKnowledgeCitation).toHaveBeenCalledWith('item-1')
    expect(await screen.findByText('来料异常 SOP v2 · 第 3 节')).toBeVisible()
    expect(screen.getByText('先冻结疑似库存。')).toBeVisible()

    await userEvent.setup().click(screen.getByRole('button', { name: '发布条目' }))
    expect(api.reviewKnowledge).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('请先确认该条目的适用范围后再发布')
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /我确认该条目的适用范围与可见角色配置正确/ }))
    await userEvent.setup().click(screen.getByRole('button', { name: '发布条目' }))
    expect(api.reviewKnowledge).toHaveBeenCalledWith('item-1', 'published', undefined)
    expect(await screen.findByText('已发布')).toBeVisible()
  })

  it('requires and persists a rejection reason before rejecting a pending item', async () => {
    const api = {
      listPendingKnowledge: vi.fn().mockResolvedValue([{ id: 'item-1', title: '临时遏制', type: 'procedure', status: 'pending_review', sourceChunkIds: ['chunk-1'] }]),
      reviewKnowledge: vi.fn().mockResolvedValue({ id: 'item-1', status: 'rejected' }),
      getKnowledgeCitation: vi.fn().mockResolvedValue({ documentName: '来料异常 SOP', version: 'v2', chunks: [] }),
    }
    render(<KnowledgeReviewPage api={api} />)
    await screen.findByText('临时遏制')
    await userEvent.setup().click(screen.getByRole('button', { name: '驳回条目' }))
    expect(api.reviewKnowledge).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('驳回时必须填写原因')
    await userEvent.setup().type(screen.getByLabelText('驳回原因'), '来源文档已失效')
    await userEvent.setup().click(screen.getByRole('button', { name: '驳回条目' }))
    expect(api.reviewKnowledge).toHaveBeenCalledWith('item-1', 'rejected', '来源文档已失效')
    expect(await screen.findByText('已驳回')).toBeVisible()
  })
})
