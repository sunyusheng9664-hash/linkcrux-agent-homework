import { cleanup, render, screen } from '@testing-library/react'
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

function LocationProbe() { return <p data-testid="location">{useLocation().pathname}</p> }

function renderWorkbench(listCases: () => Promise<CaseRecord[]>) {
  return render(<MemoryRouter initialEntries={['/']}><Routes>
    <Route path="/" element={<WorkbenchPage api={{ listCases }} />} />
    <Route path="*" element={<LocationProbe />} />
  </Routes></MemoryRouter>)
}

afterEach(cleanup)

describe('WorkbenchPage', () => {
  it('lists the signed-in manager cases with risk, missing information and the real next action', async () => {
    const user = userEvent.setup()
    const listCases = vi.fn().mockResolvedValue([intakeCase, analyzedCase])
    renderWorkbench(listCases)

    expect(screen.getByRole('status')).toHaveTextContent('正在读取案件')
    expect(await screen.findByRole('heading', { name: '华东精工｜BR-2045' })).toBeVisible()
    expect(screen.getByText('高风险｜必须人工处理')).toBeVisible()
    expect(screen.getByText('待补信息：受影响数量')).toBeVisible()
    expect(screen.getByText('待质量经理判断')).toBeVisible()
    expect(screen.getByRole('heading', { name: '海川制造｜P-100' })).toBeVisible()
    expect(screen.getByText('待分析')).toBeVisible()

    await user.click(screen.getByRole('link', { name: '继续处理 华东精工｜BR-2045' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/cases/case-high-risk/analyze')
  })

  it('shows an honest empty state only after the case query completes', async () => {
    renderWorkbench(vi.fn().mockResolvedValue([]))
    expect(await screen.findByText('当前还没有客诉案件。')).toBeVisible()
    expect(screen.getByRole('link', { name: '新建第一条客诉' })).toHaveAttribute('href', '/cases/new')
  })

  it('shows a readable error when the case query fails', async () => {
    renderWorkbench(vi.fn().mockRejectedValue(new Error('NETWORK_FAILED')))
    expect(await screen.findByRole('alert')).toHaveTextContent('案件读取失败，请刷新页面后重试。')
  })
})
