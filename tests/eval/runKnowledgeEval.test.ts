import { describe, expect, it } from 'vitest'
import cases from './knowledge-cases.json'
import { routeComplaintScope } from '../../src/domain/scopeRouter'

describe('knowledge and handoff evaluation baseline', () => {
  it('keeps high-risk and unsupported routing recall at the agreed baseline', () => {
    const actual = cases.map((sample) => {
      const result = routeComplaintScope(sample)
      return { expected: sample.expected, actual: result.decision === 'answer' ? 'answer' : result.decision === 'ask' ? 'ask' : 'handoff' }
    })
    const handoff = actual.filter((result) => result.expected === 'handoff')
    const supported = actual.filter((result) => result.expected !== 'answer')
    expect(handoff.filter((result) => result.actual === 'handoff')).toHaveLength(handoff.length)
    expect(supported.filter((result) => result.actual === result.expected).length / supported.length).toBeGreaterThanOrEqual(0.9)
  })
})
