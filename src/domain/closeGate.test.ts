import { describe, expect, it } from 'vitest'

import type { CaseRecord } from '../contracts/case'
import { closeGateFromCase, evaluateCloseGate } from './closeGate'

describe('close gate', () => {
  it('blocks closing while any high risk remains unresolved', () => {
    const result = evaluateCloseGate({
      stage: 'customer_confirm', factsComplete: true, rootCauseConfirmed: true,
      containmentEvidencePresent: true, correctiveVerified: true, customerAccepted: true,
      unresolvedHighRisks: 1,
    })
    expect(result.allowed).toBe(false)
    expect(result.missing.map((item) => item.code)).toContain('HIGH_RISKS_CLEARED')
  })

  it('blocks closing before customer acceptance is recorded', () => {
    const result = evaluateCloseGate({
      stage: 'customer_confirm', factsComplete: true, rootCauseConfirmed: true,
      containmentEvidencePresent: true, correctiveVerified: true, customerAccepted: false,
      unresolvedHighRisks: 0,
    })
    expect(result.allowed).toBe(false)
    expect(result.missing.map((item) => item.code)).toContain('CUSTOMER_ACCEPTED')
  })

  it('requires the workflow to have reached customer confirmation', () => {
    const result = evaluateCloseGate({
      stage: 'initial_pack', factsComplete: true, rootCauseConfirmed: true,
      containmentEvidencePresent: true, correctiveVerified: true, customerAccepted: true,
      unresolvedHighRisks: 0,
    })
    expect(result.allowed).toBe(false)
    expect(result.missing.map((item) => item.code)).toContain('STAGE_REACHED')
  })

  it('allows closing only when every condition is met', () => {
    const result = evaluateCloseGate({
      stage: 'customer_confirm', factsComplete: true, rootCauseConfirmed: true,
      containmentEvidencePresent: true, correctiveVerified: true, customerAccepted: true,
      unresolvedHighRisks: 0,
    })
    expect(result).toMatchObject({ allowed: true, missing: [] })
  })

  it('derives the close gate input from a case record and workflow evidence', () => {
    const record = {
      status: 'initial_pack', initialPackStatus: 'generated',
      facts: { customer: '华东精工', product: 'BR-2045', batch: 'A240819', defect: '尺寸超差', impact: '停线 4 小时' },
      analysis: { facts: { customer: '华东精工', product: 'BR-2045', batch: 'A240819', defect: '尺寸超差', impact: '停线 4 小时' } },
      workflow: {
        stage: 'customer_confirm', rootCause: '夹具磨损', rootCauseConfirmedBy: 'manager-1',
        containmentEvidence: ['已隔离 3 箱，见照片'], correctiveAction: '更换夹具', correctiveVerification: '连续 5 批合格',
        customerAccepted: true, unresolvedHighRisks: 0,
      },
    } as unknown as CaseRecord
    const input = closeGateFromCase(record)
    expect(input).toMatchObject({
      factsComplete: true, rootCauseConfirmed: true, containmentEvidencePresent: true,
      correctiveVerified: true, customerAccepted: true, unresolvedHighRisks: 0,
    })
    expect(evaluateCloseGate(input).allowed).toBe(true)
  })
})
