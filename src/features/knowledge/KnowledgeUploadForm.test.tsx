import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgeUploadForm } from './KnowledgeUploadForm'

describe('KnowledgeUploadForm', () => {
  it('submits source metadata and renders generated cards as pending review', async () => {
    const ingest = vi.fn().mockResolvedValue({
      document: { id: 'doc-1', name: '来料异常 SOP.md', status: 'parsed' },
      items: [{ id: 'item-1', type: 'procedure', title: '临时遏制', status: 'pending_review', sourceChunkIds: ['chunk-1'] }],
    })
    render(<KnowledgeUploadForm api={{ ingestKnowledge: ingest }} />)
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('资料名称'))
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
})
