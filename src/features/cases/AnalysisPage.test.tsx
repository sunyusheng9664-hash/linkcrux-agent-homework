import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentApi } from '../../services/agentApi'
import { AnalysisPage } from './AnalysisPage'

const analyzedCase = {
  id: 'case-1',
  content: '客户反馈 BR-2045 制动失效，操作员受伤，产线已停。',
  facts: { product: 'BR-2045' },
  attachments: [
    {
      fileId: 'cloud://env/complaints/manager-1/proof.png',
      mimeType: 'image/png' as const,
      size: 128,
      originalName: '现场照片.png',
    },
  ],
  status: 'analyzed' as const,
  createdBy: 'manager-1',
  createdAt: '2026-08-20T08:00:00+08:00',
  updatedAt: '2026-08-20T08:01:00+08:00',
  version: 2,
  analysisStatus: 'ai_completed' as const,
  analysis: {
    facts: { product: 'BR-2045', defect: '制动失效', impact: '操作员受伤，产线已停' },
    missingFields: ['customer', 'batch', 'quantity', 'request'] as const,
    informationCompleteness: 45,
    riskSuggestion: [
      {
        code: 'SAFETY' as const,
        label: '人员安全风险',
        evidence: '操作员受伤',
        requiresHuman: true as const,
      },
    ],
    departmentSuggestion: ['质量部', '安全部门'],
    slaSuggestion: '24 小时内首次响应',
    start8dSuggestion: true,
    confidence: 0.81,
    evidenceSpans: [{ field: 'defect', text: '制动失效' }],
    routing: { highRisk: true, requiresHuman: true },
    analysisStatus: 'ai_completed' as const,
  },
}

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderPage(api: Pick<AgentApi, 'getCase' | 'analyzeCase' | 'confirmCase'>) {
  return render(
    <MemoryRouter initialEntries={['/cases/case-1/analyze']}>
      <Routes>
        <Route path="/cases/:id/analyze" element={<AnalysisPage api={api} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('AnalysisPage', () => {
  it('separates original evidence, AI extraction and the quality-manager decision while locking high-risk takeover', async () => {
    const api = {
      getCase: vi.fn().mockResolvedValue(analyzedCase),
      analyzeCase: vi.fn(),
      confirmCase: vi.fn(),
    }

    renderPage(api)

    expect(await screen.findByRole('heading', { name: '投诉原文与附件' })).toBeVisible()
    expect(screen.getByText(analyzedCase.content)).toBeVisible()
    expect(screen.getByText('现场照片.png')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Agent 分析建议' })).toBeVisible()
    expect(screen.getByText('AI 抽取')).toBeVisible()
    expect(screen.getByText('已核实事实')).toBeVisible()
    expect(screen.getByText('缺失信息')).toBeVisible()
    expect(screen.getByRole('heading', { name: '质量经理判断' })).toBeVisible()
    expect(screen.getByLabelText('判断结果')).toHaveValue('')
    expect(screen.getByRole('option', { name: '请选择判断结果' })).toBeVisible()
    expect(screen.getByLabelText('需要人工处理')).toBeChecked()
    expect(screen.getByLabelText('需要人工处理')).toBeDisabled()
    expect(screen.getByText('人工确认')).toBeVisible()
  })

  it('renders a persisted handoff packet for the case instead of a disconnected static component', async () => {
    const api = {
      getCase: vi.fn().mockResolvedValue(analyzedCase),
      analyzeCase: vi.fn(),
      confirmCase: vi.fn(),
      listHandoffs: vi.fn().mockResolvedValue([{
        id: 'handoff-1', caseId: 'case-1', source: 'knowledge', confirmedFacts: { product: 'BR-2045' },
        missingFields: ['batch'], riskSignals: [], searchedKnowledge: ['knowledge-1'], reason: 'KNOWLEDGE_NOT_COVERED',
        suggestedTeam: '质量经理人工接管', sla: '4 个工作小时内人工响应', transitionReply: '已转交质量经理人工处理。', createdAt: '2026-08-20T08:02:00.000Z',
      }]),
    }

    renderPage(api)

    expect(await screen.findByRole('heading', { name: '人工接管包' })).toBeVisible()
    expect(screen.getByText('原因：KNOWLEDGE_NOT_COVERED')).toBeVisible()
    expect(screen.getByText('已检索知识：knowledge-1')).toBeVisible()
    expect(api.listHandoffs).toHaveBeenCalledWith('case-1')
  })

  it('routes a knowledge miss into the current case handoff instead of inventing an answer', async () => {
    const user = userEvent.setup()
    const api = {
      getCase: vi.fn().mockResolvedValue(analyzedCase),
      analyzeCase: vi.fn(),
      confirmCase: vi.fn(),
      answerKnowledge: vi.fn().mockResolvedValue({
        decision: 'handoff', answer: null, citations: [], missingInformation: [], reason: 'KNOWLEDGE_NOT_COVERED',
        handoff: {
          id: 'handoff-knowledge-miss', caseId: 'case-1', source: 'knowledge', confirmedFacts: { product: 'BR-2045' },
          missingFields: ['batch'], riskSignals: [], searchedKnowledge: [], reason: 'KNOWLEDGE_NOT_COVERED',
          suggestedTeam: '质量经理人工接管', sla: '4 个工作小时内人工响应', transitionReply: '已转交质量经理人工处理。', createdAt: '2026-08-20T08:02:00.000Z',
        },
      }),
    }

    renderPage(api)
    await screen.findByRole('heading', { name: '案件分析与人工判断' })
    await user.type(screen.getByLabelText('知识问题'), '未知工艺如何处理？')
    await user.click(screen.getByRole('button', { name: '查询已发布知识' }))

    expect(api.answerKnowledge).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-1', query: '未知工艺如何处理？', scope: { products: ['BR-2045'] } }))
    expect(await screen.findByText('未覆盖当前问题，已生成案件接管包。')).toBeVisible()
    expect(screen.getByText('原因：KNOWLEDGE_NOT_COVERED')).toBeVisible()
  })

  it('explains a model formatting failure without falsely calling published knowledge uncovered', async () => {
    const user = userEvent.setup()
    const api = {
      getCase: vi.fn().mockResolvedValue(analyzedCase),
      analyzeCase: vi.fn(),
      confirmCase: vi.fn(),
      answerKnowledge: vi.fn().mockResolvedValue({
        decision: 'handoff', answer: null, citations: [], missingInformation: [], reason: 'MODEL_FAILED',
        handoff: {
          id: 'handoff-model-failed', caseId: 'case-1', source: 'knowledge', confirmedFacts: {}, missingFields: [], riskSignals: [], searchedKnowledge: [], reason: 'LOW_CONFIDENCE',
          suggestedTeam: '质量经理人工接管', sla: '4 个工作小时内人工响应', transitionReply: '已转交质量经理人工处理。', createdAt: '2026-08-20T08:02:00.000Z',
        },
      }),
    }

    renderPage(api)
    await screen.findByRole('heading', { name: '案件分析与人工判断' })
    await user.type(screen.getByLabelText('知识问题'), '可参考哪些临时遏制措施？')
    await user.click(screen.getByRole('button', { name: '查询已发布知识' }))

    expect(await screen.findByText('已命中知识，但模型整理失败，已生成案件接管包。')).toBeVisible()
  })

  it('shows cited knowledge as manager-confirmation-only when a high-risk case is handed off', async () => {
    const user = userEvent.setup()
    const api = {
      getCase: vi.fn().mockResolvedValue(analyzedCase),
      analyzeCase: vi.fn(),
      confirmCase: vi.fn(),
      answerKnowledge: vi.fn().mockResolvedValue({
        decision: 'handoff',
        reason: 'HIGH_RISK',
        answer: '冻结疑似库存，并保留样件用于后续调查。',
        citations: [{ itemId: 'knowledge-1', documentId: 'document-1', documentName: '来料异常处理 SOP', version: 'v1', chunkIds: ['chunk-1'] }],
        missingInformation: [],
        handoff: {
          id: 'handoff-high-risk', caseId: 'case-1', source: 'knowledge', confirmedFacts: {}, missingFields: [], riskSignals: analyzedCase.analysis.riskSuggestion,
          searchedKnowledge: ['knowledge-1'], reason: 'HIGH_RISK', suggestedTeam: '质量经理人工接管', sla: '立即升级，30 分钟内人工响应', transitionReply: '已转交质量经理人工处理。', createdAt: '2026-08-20T08:02:00.000Z',
        },
      }),
    }

    renderPage(api)
    await screen.findByRole('heading', { name: '案件分析与人工判断' })
    await user.type(screen.getByLabelText('知识问题'), '可参考哪些临时遏制措施？')
    await user.click(screen.getByRole('button', { name: '查询已发布知识' }))

    expect(await screen.findByText('检测到高风险，已转质量经理人工接管。以下仅为已发布知识参考，需人工确认后执行。')).toBeVisible()
    expect(screen.getByRole('heading', { name: '已发布知识参考（待人工确认）' })).toBeVisible()
    expect(screen.getByText('冻结疑似库存，并保留样件用于后续调查。')).toBeVisible()
    expect(screen.getByText(/来料异常处理 SOP v1/)).toBeVisible()
    expect(screen.getByText('原因：HIGH_RISK')).toBeVisible()
  })

  it('requires an explicit outcome selection before submitting a manager decision', async () => {
    const confirmCase = vi.fn()
    const api = { getCase: vi.fn().mockResolvedValue(analyzedCase), analyzeCase: vi.fn(), confirmCase }

    renderPage(api)
    await screen.findByRole('heading', { name: '质量经理判断' })

    expect(screen.getByRole('button', { name: '确认判断' })).toBeDisabled()
    expect(confirmCase).not.toHaveBeenCalled()
  })

  it('requires a reason for a manager modification and records the real decision before continuing', async () => {
    const user = userEvent.setup()
    const confirmCase = vi.fn().mockResolvedValue({
      ...analyzedCase,
      status: 'confirmed',
      managerDecision: {
        outcome: 'modified',
        severity: 'critical',
        start8d: true,
        modificationReason: '客户产线停线',
      },
    })
    const api = {
      getCase: vi.fn().mockResolvedValue(analyzedCase),
      analyzeCase: vi.fn(),
      confirmCase,
    }

    renderPage(api)
    await screen.findByRole('heading', { name: '质量经理判断' })
    await user.selectOptions(screen.getByLabelText('判断结果'), 'modified')
    await user.selectOptions(screen.getByLabelText('严重度'), 'critical')
    await user.click(screen.getByRole('button', { name: '确认判断' }))

    expect(screen.getByRole('alert')).toHaveTextContent('修改或驳回时必须填写原因')
    expect(confirmCase).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('修改原因'), '客户产线停线')
    await user.click(screen.getByRole('button', { name: '确认判断' }))

    await waitFor(() => expect(confirmCase).toHaveBeenCalledWith({
      id: 'case-1',
      outcome: 'modified',
      severity: 'critical',
      start8d: true,
      modificationReason: '客户产线停线',
    }))
    expect(await screen.findByTestId('location')).toHaveTextContent('/cases/case-1/initial-pack')
  })

  it('requires a reason when rejecting the Agent recommendation but not when accepting it unchanged', async () => {
    const user = userEvent.setup()
    const confirmCase = vi.fn().mockResolvedValue({ ...analyzedCase, status: 'confirmed' })
    const api = { getCase: vi.fn().mockResolvedValue(analyzedCase), analyzeCase: vi.fn(), confirmCase }

    renderPage(api)
    await screen.findByRole('heading', { name: '质量经理判断' })
    await user.selectOptions(screen.getByLabelText('判断结果'), 'rejected')
    await user.click(screen.getByRole('button', { name: '确认判断' }))
    expect(screen.getByRole('alert')).toHaveTextContent('修改或驳回时必须填写原因')

    await user.selectOptions(screen.getByLabelText('判断结果'), 'accepted')
    await user.click(screen.getByRole('button', { name: '确认判断' }))
    await waitFor(() => expect(confirmCase).toHaveBeenCalledWith(expect.objectContaining({
      id: 'case-1',
      outcome: 'accepted',
      modificationReason: undefined,
    })))
  })

  it('treats changing the Agent 8D recommendation as a modification that needs a reason', async () => {
    const user = userEvent.setup()
    const confirmCase = vi.fn().mockResolvedValue({ ...analyzedCase, status: 'confirmed' })
    const api = { getCase: vi.fn().mockResolvedValue(analyzedCase), analyzeCase: vi.fn(), confirmCase }

    renderPage(api)
    await screen.findByRole('heading', { name: '质量经理判断' })
    await user.click(screen.getByLabelText('是否启动 8D'))

    expect(screen.getByLabelText('判断结果')).toHaveValue('modified')
    await user.click(screen.getByRole('button', { name: '确认判断' }))
    expect(screen.getByRole('alert')).toHaveTextContent('修改或驳回时必须填写原因')
    expect(confirmCase).not.toHaveBeenCalled()
  })

  it('treats changing the server-derived severity baseline as a modification', async () => {
    const user = userEvent.setup()
    const confirmCase = vi.fn().mockResolvedValue({ ...analyzedCase, status: 'confirmed' })
    const api = { getCase: vi.fn().mockResolvedValue(analyzedCase), analyzeCase: vi.fn(), confirmCase }

    renderPage(api)
    await screen.findByRole('heading', { name: '质量经理判断' })
    expect(screen.getByLabelText('严重度')).toHaveValue('high')
    await user.selectOptions(screen.getByLabelText('严重度'), 'critical')

    expect(screen.getByLabelText('判断结果')).toHaveValue('modified')
    await user.click(screen.getByRole('button', { name: '确认判断' }))
    expect(screen.getByRole('alert')).toHaveTextContent('修改或驳回时必须填写原因')
    expect(confirmCase).not.toHaveBeenCalled()
  })

  it('shows manual takeover status and its controlled failure reason', async () => {
    const manualCase = {
      ...analyzedCase,
      analysisStatus: 'manual_takeover' as const,
      analysis: {
        ...analyzedCase.analysis,
        analysisStatus: 'manual_takeover' as const,
        analysisFailureReason: 'MODEL_REQUEST_FAILED' as const,
      },
    }
    const api = { getCase: vi.fn().mockResolvedValue(manualCase), analyzeCase: vi.fn(), confirmCase: vi.fn() }

    renderPage(api)

    expect(await screen.findByText('分析状态：人工接管')).toBeVisible()
    expect(screen.getByText('失败原因：模型请求失败')).toBeVisible()
  })
})
