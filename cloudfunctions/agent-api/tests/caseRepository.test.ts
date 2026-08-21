import { describe, expect, it, vi } from 'vitest'

import { CaseRepository, CloudBaseCaseAdapter, InMemoryCaseAdapter } from '../src/repositories/caseRepository'

const analysis = {
  facts: {}, missingFields: [], informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
  slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0.8, evidenceSpans: [],
  routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed' as const,
}
const decision = { outcome: 'accepted' as const, severity: 'medium' as const, start8d: false }

describe('CaseRepository', () => {
  it('persists server-owned status and creator while excluding client protected fields', async () => {
    const repo = new CaseRepository(new InMemoryCaseAdapter())

    const created = await repo.create('user-1', {
      content: '客户反馈 BR-2045 尺寸超差',
      facts: { product: 'BR-2045', defect: '尺寸超差' },
      // @ts-expect-error protected fields are never accepted from a caller
      createdBy: 'attacker',
    })

    expect(await repo.get(created.id, 'user-1')).toMatchObject({
      status: 'intake',
      version: 1,
      createdBy: 'user-1',
      facts: { product: 'BR-2045', defect: '尺寸超差' },
    })
  })

  it('rejects a stale compare-and-swap transition without overwriting the newer state', async () => {
    const repo = new CaseRepository(new InMemoryCaseAdapter())
    const created = await repo.create('user-1', { content: '并发案件' })
    const transition = (repo as unknown as { transition: (...args: unknown[]) => Promise<unknown> }).transition.bind(repo)

    await transition(created.id, 'user-1', {
      expectedVersion: 1, expectedStatus: 'intake', patch: { status: 'analyzed', analysis, analysisStatus: 'ai_completed' },
    })
    await expect(transition(created.id, 'user-1', {
      expectedVersion: 1, expectedStatus: 'intake', patch: { status: 'confirmed', managerDecision: decision },
    })).rejects.toThrow('CASE_VERSION_CONFLICT')
    expect(await repo.get(created.id, 'user-1')).toMatchObject({ status: 'analyzed', version: 2 })
  })

  it('recovers only an expired generation lease explicitly and rejects stale generation finalization', async () => {
    const repo = new CaseRepository(new InMemoryCaseAdapter())
    const created = await repo.create('user-1', { content: '租约恢复' })
    const transition = (repo as unknown as { transition: (...args: unknown[]) => Promise<any> }).transition.bind(repo)
    const analyzed = await transition(created.id, 'user-1', {
      expectedVersion: 1, expectedStatus: 'intake', patch: { status: 'analyzed', analysis, analysisStatus: 'ai_completed' },
    })
    const confirmed = await transition(created.id, 'user-1', {
      expectedVersion: analyzed.version, expectedStatus: 'analyzed', patch: { status: 'confirmed', managerDecision: decision },
    })
    const claim = (repo as unknown as { claimInitialPackGeneration: (...args: unknown[]) => Promise<any> }).claimInitialPackGeneration.bind(repo)
    const first = await claim(created.id, 'user-1', { retry: false, now: new Date('2026-08-20T08:00:00.000Z') })

    await expect(claim(created.id, 'user-1', { retry: true, now: new Date('2026-08-20T08:04:59.000Z') })).rejects.toThrow('INITIAL_PACK_GENERATING')
    const recovered = await claim(created.id, 'user-1', { retry: true, now: new Date('2026-08-20T08:05:01.000Z') })
    expect(recovered.initialPackGeneration.generationId).not.toBe(first.initialPackGeneration.generationId)
    expect(recovered.version).toBe(confirmed.version + 2)

    const finalizeFailure = (repo as unknown as { finalizeInitialPackFailure: (...args: unknown[]) => Promise<unknown> }).finalizeInitialPackFailure.bind(repo)
    await expect(finalizeFailure(created.id, 'user-1', {
      expectedVersion: first.version,
      generationId: first.initialPackGeneration.generationId,
      failureReason: 'INITIAL_PACK_MODEL_FAILED',
    })).rejects.toThrow('CASE_VERSION_CONFLICT')
    expect(await repo.get(created.id, 'user-1')).toMatchObject({
      initialPackStatus: 'generating',
      version: recovered.version,
    })
  })

  it('does not disclose cases to a different authenticated user', async () => {
    const repo = new CaseRepository(new InMemoryCaseAdapter())
    const created = await repo.create('user-1', { content: '仅 owner 可读' })

    await expect(repo.get(created.id, 'user-2')).rejects.toThrow('CASE_NOT_FOUND')
    expect(await repo.list('user-2')).toEqual([])
  })

  it('requires ownership for updates and records a server-authored event', async () => {
    const adapter = new InMemoryCaseAdapter()
    const repo = new CaseRepository(adapter)
    const created = await repo.create('user-1', { content: '需要确认' })

    const patch = { status: 'analyzed' as const, analysis, analysisStatus: 'ai_completed' as const }
    await expect(repo.update(created.id, 'user-2', patch)).rejects.toThrow('CASE_NOT_FOUND')
    await repo.update(created.id, 'user-1', patch)

    expect(await adapter.eventsFor(created.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ actorId: 'user-1', type: 'case.updated' })]),
    )
  })

  it('claims initial-pack generation only once for the same status version', async () => {
    const repo = new CaseRepository(new InMemoryCaseAdapter())
    const created = await repo.create('user-1', { content: '需要生成首次处理包' })
    await repo.update(created.id, 'user-1', { status: 'analyzed', analysis, analysisStatus: 'ai_completed' })
    const confirmed = await repo.update(created.id, 'user-1', { status: 'confirmed', managerDecision: decision })

    await expect(repo.claimInitialPackGeneration(created.id, 'user-1', { retry: false })).resolves.toMatchObject({
      initialPackStatus: 'generating',
      version: confirmed.version + 1,
    })
    await expect(repo.claimInitialPackGeneration(created.id, 'user-1', { retry: false })).rejects.toThrow('INITIAL_PACK_GENERATING')
  })

  it('uses owner, version, status and missing initial status in a CloudBase compare-and-swap', async () => {
    const where = vi.fn().mockReturnThis()
    const update = vi.fn().mockResolvedValue({ updated: 1 })
    const absent = { $exists: false }
    const increment = { $inc: 1 }
    const db = {
      command: { exists: vi.fn().mockReturnValue(absent), inc: vi.fn().mockReturnValue(increment) },
      collection: vi.fn().mockReturnValue({ where, update }),
    }
    const adapter = new CloudBaseCaseAdapter(db)
    const compareAndSwap = (adapter as unknown as { compareAndSwapCase: (...args: unknown[]) => Promise<boolean> }).compareAndSwapCase.bind(adapter)

    await expect(compareAndSwap(
      'case-1',
      'user-1',
      { version: 3, status: 'confirmed', initialPackStatus: null },
      { initialPackStatus: 'generating' },
    )).resolves.toBe(true)
    expect(where).toHaveBeenCalledWith({
      _id: 'case-1',
      createdBy: 'user-1',
      status: 'confirmed',
      version: 3,
      initialPackStatus: absent,
    })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      initialPackStatus: 'generating',
      version: increment,
    }))
  })

  it('removes a persisted failure reason when a retry succeeds', async () => {
    const removeToken = { $remove: true }
    const where = vi.fn().mockReturnThis()
    const update = vi.fn().mockResolvedValue({ updated: 1 })
    const increment = { $inc: 1 }
    const db = {
      command: { remove: vi.fn().mockReturnValue(removeToken), inc: vi.fn().mockReturnValue(increment) },
      collection: vi.fn().mockReturnValue({ where, update }),
    }
    const adapter = new CloudBaseCaseAdapter(db)
    const compareAndSwap = (adapter as unknown as { compareAndSwapCase: (...args: unknown[]) => Promise<boolean> }).compareAndSwapCase.bind(adapter)

    await expect(compareAndSwap('case-1', 'user-1', { version: 4, status: 'confirmed', initialPackStatus: 'generating' }, {
      initialPackStatus: 'generated',
      clearInitialPackFailureReason: true,
    })).resolves.toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ initialPackFailureReason: removeToken }))
  })

  it('rejects malformed CloudBase case records at the database boundary', async () => {
    const db = {
      collection: () => ({
        where: () => ({ get: async () => ({ data: [{ _id: 'case-1', createdBy: 'user-1' }] }) }),
      }),
    }

    await expect(new CloudBaseCaseAdapter(db).findCase('case-1', 'user-1')).rejects.toThrow()
  })

  it('recovers grounded facts from evidence spans for a legacy analyzed case', async () => {
    const db = {
      collection: () => ({
        where: () => ({ get: async () => ({ data: [{
          _id: 'case-legacy', content: '发现来料尺寸超差时应如何处理？', attachments: [],
          status: 'analyzed', createdBy: 'user-1', version: 2,
          createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:01:00.000Z',
          analysisStatus: 'ai_completed',
          analysis: {
            missingFields: ['customer', 'product', 'batch', 'defect', 'quantity', 'impact', 'request'],
            informationCompleteness: 0, riskSuggestion: [], departmentSuggestion: ['质量部'],
            slaSuggestion: '24 小时', start8dSuggestion: false, confidence: 0,
            evidenceSpans: [{ field: 'defect', text: '来料尺寸超差' }],
            routing: { highRisk: false, requiresHuman: false }, analysisStatus: 'ai_completed',
          },
        }] }) }),
      }),
    }

    await expect(new CloudBaseCaseAdapter(db).findCases('user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'case-legacy',
        analysis: expect.objectContaining({
          facts: { defect: '来料尺寸超差' },
          missingFields: ['customer', 'product', 'batch', 'quantity', 'impact', 'request'],
          informationCompleteness: 14,
        }),
      }),
    ])
  })

  it('validates the complete next record before a CloudBase transition can update storage', async () => {
    const update = vi.fn().mockResolvedValue({ updated: 1 })
    const where = vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: [{
        _id: 'case-invalid', content: '非法状态转换', attachments: [], status: 'intake', createdBy: 'user-1',
        createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z', version: 1,
      }] }),
      update,
    })
    const db = {
      command: { exists: vi.fn(), inc: vi.fn() },
      collection: vi.fn().mockReturnValue({ where }),
    }
    const repo = new CaseRepository(new CloudBaseCaseAdapter(db))

    await expect(repo.transition('case-invalid', 'user-1', {
      expectedVersion: 1,
      expectedStatus: 'intake',
      expectedInitialPackStatus: null,
      patch: { status: 'confirmed', managerDecision: decision },
    })).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not pollute an in-memory record when the complete transition candidate is invalid', async () => {
    const repo = new CaseRepository(new InMemoryCaseAdapter())
    const created = await repo.create('user-1', { content: '非法状态转换' })

    await expect(repo.transition(created.id, 'user-1', {
      expectedVersion: created.version,
      expectedStatus: 'intake',
      expectedInitialPackStatus: null,
      patch: { status: 'confirmed', managerDecision: decision },
    })).rejects.toThrow()
    expect(await repo.get(created.id, 'user-1')).toEqual(created)
  })
})
