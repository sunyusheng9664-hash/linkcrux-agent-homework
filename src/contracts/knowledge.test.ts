import { describe, expect, it } from 'vitest'

import { KnowledgeItemSchema } from './knowledge'

describe('KnowledgeItemSchema', () => {
  it('keeps six knowledge-card types distinct instead of flattening all documents into QA', () => {
    const base = {
      id: 'knowledge-1', title: '示例', sourceDocumentId: 'document-1', sourceChunkIds: ['chunk-1'], owner: '质量部',
      scope: {}, visibility: 'quality_team', status: 'pending_review', effectiveAt: '2026-08-01T00:00:00.000Z',
      createdBy: 'quality-manager-1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const cases = [
      ['qa', { question: '是否冻结库存？', answer: '先冻结疑似库存。' }],
      ['procedure', { steps: ['冻结库存'] }],
      ['rule', { when: '发现尺寸超差', then: '升级质量经理判断' }],
      ['navigation', { system: 'MES', path: ['质量', '异常处置'] }],
      ['script', { scenario: '客户询问进度', script: '我们已受理，将按约定时间同步。' }],
      ['case', { summary: 'BR-2045 尺寸超差', lessons: ['保留样件'] }],
    ] as const

    for (const [type, content] of cases) {
      expect(KnowledgeItemSchema.parse({ ...base, type, content })).toMatchObject({ type, content })
    }
  })
})
