import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ModelClient } from '../src/services/modelClient'

const AnswerSchema = z.object({ answer: z.string().min(1) })
const messages = [{ role: 'user' as const, content: '请返回结构化结果' }]

describe('ModelClient', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it('在一次格式修复后仍拒绝不符合结构的模型输出', async () => {
    process.env.LLM_BASE_URL = 'https://model.example.test/v1'
    process.env.LLM_API_KEY = 'test-api-key'
    process.env.LLM_MODEL = 'test-model'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"unexpected":true}' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new ModelClient()

    await expect(client.generateStructured(AnswerSchema, messages)).rejects.toThrow('MODEL_SCHEMA_INVALID')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('把服务端配置与授权头发送给模型端点', async () => {
    process.env.LLM_BASE_URL = 'https://model.example.test/v1/'
    process.env.LLM_API_KEY = 'test-api-key'
    process.env.LLM_MODEL = 'test-model'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"answer":"ok"}' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ModelClient().generateStructured(AnswerSchema, messages)).resolves.toEqual({ answer: 'ok' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://model.example.test/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    )
  })

  it('在一次格式修复后返回第二次符合结构的结果', async () => {
    process.env.LLM_BASE_URL = 'https://model.example.test/v1'
    process.env.LLM_API_KEY = 'test-api-key'
    process.env.LLM_MODEL = 'test-model'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"unexpected":true}' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"answer":"repaired"}' } }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ModelClient().generateStructured(AnswerSchema, messages)).resolves.toEqual({ answer: 'repaired' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondRequest.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: '{"unexpected":true}' }),
        expect.objectContaining({ role: 'user', content: expect.stringContaining('不符合要求') }),
      ]),
    )
  })
})
