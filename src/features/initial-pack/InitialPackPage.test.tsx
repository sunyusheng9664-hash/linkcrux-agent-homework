import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentApi } from '../../services/agentApi'
import { InitialPackPage } from './InitialPackPage'

afterEach(cleanup)

describe('InitialPackPage', () => {
  it('does not auto-retry a persisted manual handoff and offers an explicit manager retry', async () => {
    const manualHandoff = {
      id: 'case-1', content: '客诉', attachments: [], status: 'confirmed' as const,
      createdBy: 'manager-1', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:01:00.000Z',
      version: 4,
      initialPackStatus: 'manual_handoff' as const,
      initialPackFailureReason: 'INITIAL_PACK_UNSAFE_D3' as const,
    }
    const generated = {
      ...manualHandoff,
      status: 'initial_pack' as const,
      version: 6,
      initialPackStatus: 'generated' as const,
      initialPack: {
        customerReply: '已收到投诉，信息仍在核实。', internalTicket: '质量经理跟进。', d1: '质量经理牵头。', d2: '信息待核实。',
        d3: { containmentActions: [{ suggestedAction: '建议隔离待核库存', owner: '质量经理', dueAt: '24 小时内', executionStatus: 'suggested' as const, evidence: [] }] },
        timeline24h14d30d: [{ milestone: '24h' as const, delivery: '首次更新' }, { milestone: '14d' as const, delivery: '调查计划更新' }, { milestone: '30d' as const, delivery: '闭环计划更新' }],
        d4ToD8Plan: [{ phase: 'D4' as const, plan: '计划验证原因' }, { phase: 'D5' as const, plan: '计划评估措施' }, { phase: 'D6' as const, plan: '计划验证效果' }, { phase: 'D7' as const, plan: '计划预防复发' }, { phase: 'D8' as const, plan: '计划组织评审' }],
      },
    }
    const generateInitialPack = vi.fn().mockResolvedValue(generated)
    const api = { getCase: vi.fn().mockResolvedValue(manualHandoff), generateInitialPack }

    render(<MemoryRouter initialEntries={['/cases/case-1/initial-pack']}><Routes><Route path="/cases/:id/initial-pack" element={<InitialPackPage api={api as Pick<AgentApi, 'getCase' | 'generateInitialPack'>} />} /></Routes></MemoryRouter>)

    expect(await screen.findByText(/首次处理包.*需要人工接管/)).toBeVisible()
    expect(screen.getByText('原因：D3 建议包含不允许的完成态或结论态')).toBeVisible()
    expect(generateInitialPack).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(generateInitialPack).toHaveBeenCalledWith('case-1', { retry: true }))
    expect(await screen.findByRole('heading', { name: '8D 初版' })).toBeVisible()
  })

  it('polls generating state finitely, then offers refresh and explicit lease recovery', async () => {
    const analysis = {
      facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
      slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [],
      routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const,
    }
    const generating = {
      id: 'case-2', content: '客诉', attachments: [], status: 'confirmed' as const,
      createdBy: 'manager-1', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:01:00.000Z', version: 4,
      analysis, analysisStatus: 'ai_completed' as const,
      managerDecision: { outcome: 'accepted' as const, severity: 'medium' as const, start8d: false },
      initialPackStatus: 'generating' as const,
      initialPackGeneration: {
        generationId: 'gen-old', claimedAt: '2026-08-20T08:00:00.000Z', leaseUntil: '2026-08-20T08:05:00.000Z',
      },
    }
    const generated = {
      ...generating,
      status: 'initial_pack' as const,
      version: 6,
      initialPackStatus: 'generated' as const,
      initialPackGeneration: undefined,
      initialPack: {
        customerReply: '已收到投诉。', internalTicket: '质量经理跟进。', d1: '计划组队。', d2: '待核实。',
        d3: { containmentActions: [{ suggestedAction: '建议隔离待核对象', owner: '质量经理', dueAt: '建议在 24 小时内完成', executionStatus: 'suggested' as const, evidence: [] }] },
        timeline24h14d30d: [{ milestone: '24h' as const, delivery: '首次更新' }, { milestone: '14d' as const, delivery: '调查计划更新' }, { milestone: '30d' as const, delivery: '闭环计划更新' }],
        d4ToD8Plan: [{ phase: 'D4' as const, plan: '计划验证原因' }, { phase: 'D5' as const, plan: '计划评估措施' }, { phase: 'D6' as const, plan: '计划验证效果' }, { phase: 'D7' as const, plan: '计划预防复发' }, { phase: 'D8' as const, plan: '计划组织评审' }],
      },
    }
    const getCase = vi.fn().mockResolvedValue(generating)
    const generateInitialPack = vi.fn()
      .mockRejectedValueOnce(new Error('INITIAL_PACK_GENERATING'))
      .mockResolvedValueOnce(generated)
    const api = { getCase, generateInitialPack }
    const TestablePage = InitialPackPage as unknown as ComponentType<Record<string, unknown>>

    render(<MemoryRouter initialEntries={['/cases/case-2/initial-pack']}><Routes><Route path="/cases/:id/initial-pack" element={<TestablePage api={api} pollIntervalMs={1} maxPollAttempts={2} now={() => new Date('2026-08-20T08:06:00.000Z')} />} /></Routes></MemoryRouter>)

    expect(await screen.findByText('生成状态长时间未更新')).toBeVisible()
    expect(getCase).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeVisible()
    expect(screen.getByRole('button', { name: '恢复生成' })).toBeEnabled()
    expect(generateInitialPack).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '恢复生成' }))
    await waitFor(() => expect(generateInitialPack).toHaveBeenCalledWith('case-2', { retry: true }))
    expect(await screen.findByText('当前生成租约仍有效，请稍后刷新状态再恢复。')).toBeVisible()
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeVisible()
    expect(screen.getByRole('button', { name: '恢复生成' })).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '恢复生成' }))
    expect(await screen.findByRole('heading', { name: '8D 初版' })).toBeVisible()
  })

  it('observes a competing generation after the initial claim loses and renders its completed pack', async () => {
    const analysis = {
      facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
      slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [],
      routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const,
    }
    const confirmed = {
      id: 'case-race', content: '并发客诉', attachments: [], status: 'confirmed' as const,
      createdBy: 'manager-1', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:01:00.000Z', version: 3,
      analysis, analysisStatus: 'ai_completed' as const,
      managerDecision: { outcome: 'accepted' as const, severity: 'medium' as const, start8d: false },
    }
    const generating = {
      ...confirmed, version: 4, initialPackStatus: 'generating' as const,
      initialPackGeneration: { generationId: 'gen-race', claimedAt: '2026-08-20T08:01:00.000Z', leaseUntil: '2026-08-20T08:06:00.000Z' },
    }
    const generated = {
      ...confirmed, status: 'initial_pack' as const, version: 5, initialPackStatus: 'generated' as const,
      initialPack: {
        customerReply: '已收到投诉。', internalTicket: '质量经理跟进。', d1: '计划组队。', d2: '待核实。',
        d3: { containmentActions: [{ suggestedAction: '建议隔离待核对象', owner: '仓储负责人', dueAt: '建议在 24 小时内完成', executionStatus: 'suggested' as const, evidence: [] }] },
        timeline24h14d30d: [{ milestone: '24h' as const, delivery: '首次更新' }, { milestone: '14d' as const, delivery: '调查计划更新' }, { milestone: '30d' as const, delivery: '闭环计划更新' }],
        d4ToD8Plan: [{ phase: 'D4' as const, plan: '计划验证原因' }, { phase: 'D5' as const, plan: '计划评估措施' }, { phase: 'D6' as const, plan: '计划验证效果' }, { phase: 'D7' as const, plan: '计划预防复发' }, { phase: 'D8' as const, plan: '计划组织评审' }],
      },
    }
    const getCase = vi.fn()
      .mockResolvedValueOnce(confirmed)
      .mockResolvedValueOnce(generating)
      .mockResolvedValueOnce(generated)
    const generateInitialPack = vi.fn().mockRejectedValue(new Error('INITIAL_PACK_GENERATING'))
    const TestablePage = InitialPackPage as unknown as ComponentType<Record<string, unknown>>

    render(<MemoryRouter initialEntries={['/cases/case-race/initial-pack']}><Routes><Route path="/cases/:id/initial-pack" element={<TestablePage api={{ getCase, generateInitialPack }} pollIntervalMs={1} maxPollAttempts={2} />} /></Routes></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: '8D 初版' })).toBeVisible()
    expect(screen.queryByText('正在生成首次处理包…')).not.toBeInTheDocument()
  })

  it('keeps recovery disabled until the persisted generation lease expires', async () => {
    const generating = {
      id: 'case-future', content: '客诉', attachments: [], status: 'confirmed' as const,
      createdBy: 'manager-1', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:01:00.000Z', version: 4,
      analysis: {
        facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
        slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [],
        routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const,
      },
      analysisStatus: 'ai_completed' as const,
      managerDecision: { outcome: 'accepted' as const, severity: 'medium' as const, start8d: false },
      initialPackStatus: 'generating' as const,
      initialPackGeneration: { generationId: 'gen-future', claimedAt: '2026-08-20T08:00:00.000Z', leaseUntil: '2026-08-20T08:05:00.000Z' },
    }
    const api = { getCase: vi.fn().mockResolvedValue(generating), generateInitialPack: vi.fn() }
    const TestablePage = InitialPackPage as unknown as ComponentType<Record<string, unknown>>

    render(<MemoryRouter initialEntries={['/cases/case-future/initial-pack']}><Routes><Route path="/cases/:id/initial-pack" element={<TestablePage api={api} pollIntervalMs={1} maxPollAttempts={1} now={() => new Date('2026-08-20T08:04:00.000Z')} />} /></Routes></MemoryRouter>)

    expect(await screen.findByText('生成状态长时间未更新')).toBeVisible()
    expect(screen.getByText(/可恢复时间/)).toHaveTextContent('2026-08-20T08:05:00.000Z')
    expect(screen.getByRole('button', { name: '恢复生成' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled()
  })
})
