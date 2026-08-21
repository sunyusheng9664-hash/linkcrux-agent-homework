import { describe, expect, it } from 'vitest'

import { ApiResponseSchema } from './api'

describe('ApiResponseSchema', () => {
  it('accepts complete success and failure responses', () => {
    expect(ApiResponseSchema.safeParse({ ok: true, data: { id: 'case-1' } }).success).toBe(true)
    expect(ApiResponseSchema.safeParse({ ok: false, error: { code: 'NOT_FOUND', message: '案件不存在' } }).success).toBe(true)
  })

  it.each([
    ['a success response with an error', { ok: true, error: { code: 'E', message: 'x' } }],
    ['a failure response with data', { ok: false, data: { id: '1' } }],
    ['a failure response without an error', { ok: false }],
  ])('rejects %s', (_name, response) => {
    expect(ApiResponseSchema.safeParse(response).success).toBe(false)
  })
})
