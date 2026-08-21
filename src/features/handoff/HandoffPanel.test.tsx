import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { HandoffPanel } from './HandoffPanel'

describe('HandoffPanel', () => {
  it('shows a traceable handoff package and lets a manager copy, not send, the transition reply', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    render(<HandoffPanel packet={{ caseId: 'case-1', reason: 'KNOWLEDGE_NOT_COVERED', suggestedTeam: '质量经理人工接管', sla: '4 个工作小时内人工响应', missingFields: ['batch'], transitionReply: '已转交质量经理人工处理。', searchedKnowledge: [] }} copy={copy} />)
    expect(screen.getByRole('heading', { name: '人工接管包' })).toBeVisible()
    expect(screen.getByText(/质量经理人工接管/)).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: '复制过渡回复' }))
    expect(copy).toHaveBeenCalledWith('已转交质量经理人工处理。')
  })
})
