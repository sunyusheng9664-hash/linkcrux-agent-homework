import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { InitialPack } from '../../contracts/case'
import { EightDInitialView } from './EightDInitialView'

const pack: InitialPack = {
  customerReply: '已收到投诉，当前正在核实批次与影响范围，将按节点同步进展。',
  internalTicket: '请质量经理组织跨部门初步响应并补齐缺失信息。',
  d1: '计划由质量经理牵头，协调生产与客服参与。',
  d2: '当前已知问题为 BR-2045 制动异常；影响范围待核实。',
  d3: {
    containmentActions: [
      {
        suggestedAction: '建议隔离待核批次库存',
        owner: '质量经理',
        dueAt: '2026-08-20T18:00:00+08:00',
        executionStatus: 'suggested',
        evidence: [],
      },
    ],
  },
  timeline24h14d30d: [
    { milestone: '24h', delivery: '首次响应及 D1–D3 建议更新' },
    { milestone: '14d', delivery: 'D4–D6 调查与验证计划更新' },
    { milestone: '30d', delivery: 'D7–D8 预防与闭环计划更新' },
  ],
  d4ToD8Plan: [
    { phase: 'D4', plan: '计划收集证据并验证可能原因。' },
    { phase: 'D5', plan: '计划评估纠正措施选项。' },
    { phase: 'D6', plan: '计划在人工批准后验证措施效果。' },
    { phase: 'D7', plan: '计划评估预防复发机制。' },
    { phase: 'D8', plan: '计划在证据齐备后组织结案评审。' },
  ],
}

afterEach(cleanup)

describe('EightDInitialView', () => {
  it('shows D1-D3 as the initial pack and labels every containment action as an unexecuted AI suggestion', () => {
    render(<EightDInitialView pack={pack} />)

    expect(screen.getByRole('heading', { name: '8D 初版' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'D1 团队计划' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'D2 问题描述' })).toBeVisible()
    const d3 = screen.getByRole('region', { name: 'D3 临时遏制建议' })
    expect(within(d3).getByText('Agent 建议 · 未执行')).toBeVisible()
    expect(within(d3).getByText('建议隔离待核批次库存')).toBeVisible()
    expect(within(d3).queryByText('已执行')).not.toBeInTheDocument()
  })

  it('shows exactly the 24h/14d/30d timeline and keeps D4-D8 as follow-up plans', () => {
    render(<EightDInitialView pack={pack} />)

    const timeline = screen.getByRole('region', { name: '交付时间线' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(3)
    expect(within(timeline).getByText('24 小时')).toBeVisible()
    expect(within(timeline).getByText('14 天')).toBeVisible()
    expect(within(timeline).getByText('30 天')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'D4–D8 后续计划' })).toBeVisible()
    expect(screen.getAllByText('计划中')).toHaveLength(5)
    expect(screen.queryByText('已验证最终根因')).not.toBeInTheDocument()
    expect(screen.queryByText('责任结论')).not.toBeInTheDocument()
    expect(screen.queryByText('召回决定')).not.toBeInTheDocument()
    expect(screen.queryByText('赔偿承诺')).not.toBeInTheDocument()
  })
})
