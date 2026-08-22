import { describe, expect, it } from 'vitest'

import type { CaseRecord } from '../contracts/case'
import {
  caseProgressCompleted,
  caseStatusMeta,
  confidenceLevel,
  factLabel,
  formatCaseNumber,
  formatDateTime,
  formatDuration,
  milestoneDeadline,
  severityLabel,
  timelineStatus,
  visibilityLabel,
} from './presentation'

const baseCase = {
  id: 'case-1', content: '客诉', attachments: [], createdBy: 'manager-1',
  createdAt: '2026-08-20T08:00:00+08:00', updatedAt: '2026-08-20T08:00:00+08:00', version: 1,
} as const

function record(overrides: Partial<CaseRecord>): CaseRecord {
  return { ...baseCase, status: 'intake', ...overrides } as CaseRecord
}

describe('case presentation helpers', () => {
  it('maps fact fields, severities and visibility to business Chinese labels', () => {
    expect(factLabel('customer')).toBe('客户')
    expect(factLabel('quantity')).toBe('受影响数量')
    expect(severityLabel('critical')).toBe('严重')
    expect(visibilityLabel('knowledge_owner')).toBe('知识负责人')
  })

  it('derives a stable short case number from the record id', () => {
    expect(formatCaseNumber('case-1')).toBe(formatCaseNumber('case-1'))
    expect(formatCaseNumber('case-1')).toMatch(/^KS-\d{5}$/)
    expect(formatCaseNumber('case-2')).not.toBe(formatCaseNumber('case-1'))
  })

  it('maps case status to a readable label and tone', () => {
    expect(caseStatusMeta(record({ status: 'analyzed' }))).toMatchObject({ label: '待质量经理判断', tone: 'warning' })
    expect(caseStatusMeta(record({ status: 'initial_pack', initialPackStatus: 'generated' }))).toMatchObject({ label: '首次处理包已生成', tone: 'success' })
    expect(caseStatusMeta(record({ status: 'confirmed', initialPackStatus: 'manual_handoff', initialPackFailureReason: 'INITIAL_PACK_MODEL_FAILED' }))).toMatchObject({ label: '首次处理包需人工接管', tone: 'danger' })
    expect(caseStatusMeta(record({ status: 'confirmed', initialPackStatus: 'generating' }))).toMatchObject({ label: '首次处理包生成中', tone: 'info' })
  })

  it('computes progress completion per state', () => {
    expect(caseProgressCompleted(record({ status: 'intake' }))).toBe(0)
    expect(caseProgressCompleted(record({ status: 'analyzed' }))).toBe(2)
    expect(caseProgressCompleted(record({ status: 'confirmed' }))).toBe(3)
    expect(caseProgressCompleted(record({ status: 'initial_pack', initialPackStatus: 'generated' }))).toBe(4)
  })

  it('maps confidence to coarse levels instead of false precision', () => {
    expect(confidenceLevel(0.95)).toMatchObject({ key: 'high', label: '高' })
    expect(confidenceLevel(0.81)).toMatchObject({ key: 'medium', label: '中' })
    expect(confidenceLevel(0.4)).toMatchObject({ key: 'low', label: '低' })
  })

  it('computes concrete SLA deadlines and remaining time from the case creation time', () => {
    const deadline = milestoneDeadline('2026-08-20T09:00:00+08:00', '24h')
    expect(deadline.toISOString()).toBe('2026-08-21T01:00:00.000Z')
    expect(timelineStatus(deadline, new Date('2026-08-20T10:00:00+08:00'))).toMatchObject({ overdue: false, label: '剩余 23 小时' })
    expect(timelineStatus(deadline, new Date('2026-08-22T10:00:00+08:00'))).toMatchObject({ overdue: true, label: '已超期' })
  })

  it('formats durations and datetimes for business display', () => {
    expect(formatDuration(30 * 60 * 1000)).toBe('30 分钟')
    expect(formatDuration(23 * 60 * 60 * 1000)).toBe('23 小时')
    expect(formatDuration(3 * 24 * 60 * 60 * 1000)).toBe('3 天')
    expect(formatDateTime('2026-08-20T09:00:00+08:00')).toContain('2026/')
  })
})
