import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CaseRecord } from '../../contracts/case'
import { WorkbenchPage } from './WorkbenchPage'

const analyzedCase: CaseRecord = {
  id: 'case-high-risk',
  content: '华东精工反馈 BR-2045 尺寸超差，装配线已停线。',
  attachments: [], status: 'analyzed', createdBy: 'manager-1',
  createdAt: '2026-08-21T08:00:00+08:00', updatedAt: '2026-08-21T08:10:00+08:00', version: 2,
  analysisStatus: 'ai_completed',
  analysis: {
    facts: { customer: '华东精工', product: 'BR-2045', defect: '尺寸超差' },
    missingFields: ['quantity'], informationCompleteness: 86,
    riskSuggestion: [{ code: 'LINE_STOPPAGE', label: '重大停线风险', evidence: '装配线已停线', requiresHuman: true }],
    departmentSuggestion: ['质量部'], slaSuggestion: '30 分钟内人工响应', start8dSuggestion: true, confidence: 0.92,
    evidenceSpans: [{ field: 'impact', text: '装配线已停线' }],
    routing: { highRisk: true, requiresHuman: true }, analysisStatus: 'ai_completed',
  },
}

const intakeCase: CaseRecord = {
  id: 'case-intake', content: '客户反馈外观划伤，等待 Agent 分析。', facts: { customer: '海川制造', product: 'P-100' },
  attachments: [], status: 'intake', createdBy: 'manager-1',
  createdAt: '2026-08-21T07:00:00+08:00', updatedAt: '2026-08-21T07:00:00+08:00', version: 1,
}

const packedCase: CaseRecord = {
  id: 'case-packed', content: '已完成处理的客诉。', facts: { customer: '海川制造', product: 'P-100', defect: '外观划伤' },
  attachments: [], status: 'initial_pack', createdBy: 'manager-1',
  createdAt: '2026-08-20T06:00:00+08:00', updatedAt: '2026-08-21T06:00:00+08:00', version: 5,
  analysisStatus: 'ai_completed',
  analysis: {
    facts: { customer: '海川制造', product: 'P-100', defect: '外观划伤' },
    missingFields: [], informationCompleteness: 100,
    riskSuggestion: [], departmentSuggestion: ['质量部'], slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.9,
    evidenceSpans: [], routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed',
  },
  managerDecision: { outcome: 'accepted', severity: 'medium', start8d: false },
  initialPackStatus: 'generated',
  initialPack: {
    customerReply: '已收到投诉。', internalTicket: '工单。', d1: '计划。', d2: '描述。',
    d3: { containmentActions: [{ suggestedAction: '隔离库存', owner: '质量经理', dueAt: '24 小时内', executionStatus: 'suggested', evidence: [] }] },
    timeline24h14d30d: [{ milestone: '24h', delivery: '首响' }, { milestone: '14d', delivery: '调查' }, { milestone: '30d', delivery: '闭环' }],
    d4ToD8Plan: [{ phase: 'D4', plan: '计划' }, { phase: 'D5', plan: '计划' }, { phase: 'D6', plan: '计划' }, { phase: 'D7', plan: '计划' }, { phase: 'D8', plan: '计划' }],
  },
}

function LocationProbe() { return <p data-testid="location">{useLocation().pathname}</p> }

function renderWorkbench(listCases: () => Promise<CaseRecord[]>) {
  return render(<MemoryRouter initialEntries={['/']}><Routes>
    <Route path="/" element={<WorkbenchPage api={{ listCases }} />} />
    <Route path="*" element={<LocationProbe />} />
  </Routes></MemoryRouter>)
}

afterEach(cleanup)

describe('WorkbenchPage', () => {
  it('leads the interviewer with a single guided example entry and explains the 1-4 experience flow', async () => {
    renderWorkbench(vi.fn().mockResolvedValue([]))

    expect(await screen.findByRole('heading', { name: '5 分钟体验一次完整客诉闭环' })).toBeVisible()
    const exampleLinks = screen.getAllByRole('link', { name: '开始示例体验' })
    expect(exampleLinks[0]).toHaveAttribute('href', '/cases/new?preset=main')
    const guide = screen.getByLabelText('示例体验步骤')
    expect(guide).toHaveTextContent('1受理投诉2Agent 分析3质量经理确认4生成处理包')
    expect(screen.getByRole('link', { name: '新建真实客诉' })).toHaveAttribute('href', '/cases/new')
  })

  it('groups cases into attention and recent, shows short number, status badge, risk and missing info', async () => {
    const user = userEvent.setup()
    const listCases = vi.fn().mockResolvedValue([intakeCase, analyzedCase, packedCase])
    renderWorkbench(listCases)

    expect(screen.getByRole('status')).toHaveTextContent('正在读取案件')
    expect(await screen.findByRole('heading', { name: '华东精工｜BR-2045' })).toBeVisible()

    const attention = screen.getByRole('region', { name: '待我处理' })
    expect(attention).toHaveTextContent('待质量经理判断')
    expect(attention).toHaveTextContent('待受理')
    expect(attention).toHaveTextContent('重大停线风险')
    expect(attention).toHaveTextContent('受影响数量')
    const caseNumbers = within(attention).getAllByText(/^KS-\d{5}$/)
    expect(caseNumbers).toHaveLength(2)
    expect(within(attention).getAllByText('录入客诉')).toHaveLength(2)

    const recent = screen.getByRole('region', { name: '最近更新' })
    expect(within(recent).getByText('首次处理包已生成')).toBeVisible()
    expect(within(recent).getByText('外观划伤')).toBeVisible()

    await user.click(screen.getByRole('link', { name: '继续处理 华东精工｜BR-2045' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/cases/case-high-risk/analyze')
  })

  it('shows an honest empty state only after the case query completes', async () => {
    renderWorkbench(vi.fn().mockResolvedValue([]))
    expect(await screen.findByText(/还没有客诉案件/)).toBeVisible()
    // 主 CTA 与空状态 CTA 同名时，按主 CTA 校验跳转目标
    const exampleLinks = screen.getAllByRole('link', { name: '开始示例体验' })
    expect(exampleLinks[0]).toHaveAttribute('href', '/cases/new?preset=main')
  })

  it('shows a readable error when the case query fails', async () => {
    renderWorkbench(vi.fn().mockRejectedValue(new Error('NETWORK_FAILED')))
    expect(await screen.findByRole('alert')).toHaveTextContent('案件读取失败，请刷新页面后重试。')
  })
})
