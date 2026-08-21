import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgeReviewPage } from './KnowledgeReviewPage'

describe('KnowledgeReviewPage', () => {
  it('shows source citations before allowing a knowledge owner to publish a pending item', async () => {
    const api = {
      listPendingKnowledge: vi.fn().mockResolvedValue([{ id: 'item-1', title: '临时遏制', type: 'procedure', status: 'pending_review', sourceChunkIds: ['chunk-1'] }]),
      reviewKnowledge: vi.fn().mockResolvedValue({ id: 'item-1', status: 'published' }),
      getKnowledgeCitation: vi.fn().mockResolvedValue({ documentName: '来料异常 SOP', version: 'v2', chunks: [{ sequence: 3, text: '先冻结疑似库存。' }] }),
    }
    render(<KnowledgeReviewPage api={api} />)
    expect(await screen.findByText('临时遏制')).toBeVisible()
    expect(screen.getByText('引用分段：chunk-1')).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: '查看引用' }))
    expect(api.getKnowledgeCitation).toHaveBeenCalledWith('item-1')
    expect(await screen.findByText('来料异常 SOP v2 · 第 3 节')).toBeVisible()
    expect(screen.getByText('先冻结疑似库存。')).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: '发布条目' }))
    expect(api.reviewKnowledge).toHaveBeenCalledWith('item-1', 'published')
    expect(await screen.findByText('已发布')).toBeVisible()
  })
})
