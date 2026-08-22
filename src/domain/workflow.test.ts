import { describe, expect, it } from 'vitest'

import type { CaseRecord } from '../contracts/case'
import {
  CUSTOMER_PROGRESS_NODES,
  customerProgress,
  effectiveWorkflowStage,
  getAllowedTransitions,
  nextStage,
  workflowIndex,
} from './workflow'

function record(overrides: Partial<CaseRecord>): CaseRecord {
  return {
    id: 'case-1', content: '客诉', attachments: [], status: 'intake', createdBy: 'manager-1',
    createdAt: '2026-08-20T08:00:00+08:00', updatedAt: '2026-08-20T08:00:00+08:00', version: 1,
    ...overrides,
  } as CaseRecord
}

describe('workflow state machine', () => {
  it('only allows advancing to the next fixed stage', () => {
    expect(getAllowedTransitions('intake')).toEqual(['analysis'])
    expect(getAllowedTransitions('analysis')).toEqual(['decision'])
    expect(getAllowedTransitions('customer_confirm')).toEqual(['closed'])
    expect(getAllowedTransitions('closed')).toEqual([])
    expect(getAllowedTransitions('intake')).not.toContain('root_cause')
  })

  it('derives the effective stage from case status unless a workflow record exists', () => {
    expect(effectiveWorkflowStage(record({ status: 'intake' }))).toBe('intake')
    expect(effectiveWorkflowStage(record({ status: 'analyzed' }))).toBe('analysis')
    expect(effectiveWorkflowStage(record({ status: 'confirmed' }))).toBe('decision')
    expect(effectiveWorkflowStage(record({ status: 'initial_pack', initialPackStatus: 'generated' }))).toBe('initial_pack')
    expect(effectiveWorkflowStage(record({
      status: 'initial_pack', initialPackStatus: 'generated',
      workflow: { stage: 'root_cause', startedAt: '2026-08-20T08:00:00+08:00', updatedAt: '2026-08-20T08:00:00+08:00', updatedBy: 'manager-1', stageHistory: [], unresolvedHighRisks: 0 },
    }))).toBe('root_cause')
  })

  it('maps workflow stages to the five customer progress nodes', () => {
    const atIntake = customerProgress(record({ status: 'analyzed' }))
    expect(atIntake.nodes).toHaveLength(5)
    expect(CUSTOMER_PROGRESS_NODES.map((node) => node.label)).toEqual(['受理确认', '已分派', '根因定位', '对策确认', '闭环关闭'])
    expect(atIntake.nodes[0].status).toBe('current')
    expect(atIntake.nodes[1].status).toBe('upcoming')

    const atRootCause = customerProgress(record({
      status: 'initial_pack', initialPackStatus: 'generated',
      workflow: { stage: 'root_cause', startedAt: '2026-08-20T08:00:00+08:00', updatedAt: '2026-08-20T08:00:00+08:00', updatedBy: 'manager-1', stageHistory: [{ stage: 'initial_pack', at: '2026-08-20T08:00:00+08:00' }, { stage: 'containment', at: '2026-08-20T09:00:00+08:00' }, { stage: 'root_cause', at: '2026-08-20T10:00:00+08:00' }], unresolvedHighRisks: 0 },
    }))
    expect(atRootCause.nodes[1].status).toBe('done')
    expect(atRootCause.nodes[2].status).toBe('current')
    expect(atRootCause.nodes[2].at).toBe('2026-08-20T10:00:00+08:00')

    const atClosed = customerProgress(record({
      status: 'initial_pack', initialPackStatus: 'generated',
      workflow: { stage: 'closed', startedAt: '2026-08-20T08:00:00+08:00', updatedAt: '2026-08-20T12:00:00+08:00', updatedBy: 'manager-1', stageHistory: [{ stage: 'closed', at: '2026-08-20T12:00:00+08:00' }], unresolvedHighRisks: 0, closedAt: '2026-08-20T12:00:00+08:00' },
    }))
    expect(atClosed.nodes[4].status).toBe('current')
    expect(atClosed.nextSyncLabel).toContain('已闭环')
  })

  it('exposes a stable stage order', () => {
    expect(workflowIndex('intake')).toBe(0)
    expect(workflowIndex('closed')).toBe(8)
    expect(nextStage('corrective')).toBe('customer_confirm')
  })
})
