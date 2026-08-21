import { describe, expect, it, vi } from 'vitest'

import { createAgentApi } from './agentApi'
import type { CloudbaseClient } from './cloudbase'

describe('AgentApi case validation', () => {
  it('rejects a malformed case record returned by the cloud function', async () => {
    const client = {
      callFunction: vi.fn().mockResolvedValue({ result: { ok: true, data: { id: 'case-1' } } }),
    } as unknown as CloudbaseClient

    await expect(createAgentApi(client).getCase('case-1')).rejects.toThrow()
  })
})
