import { describe, expect, it } from 'vitest'

import { calculateCompleteness } from './completeness'

describe('calculateCompleteness', () => {
  it('counts the supplied product and defect as 40 percent complete', () => {
    expect(calculateCompleteness({ product: 'BR-2045', defect: '尺寸超差' })).toBe(40)
  })
})
