import {
  CaseAnalysisSchema,
  CaseFactFieldSchema,
  CaseRecordSchema,
  ComplaintInputSchema,
  InitialPackFailureReasonSchema,
  InitialPackGenerationSchema,
  InitialPackSchema,
  InitialPackStatusSchema,
  ManagerDecisionSchema,
  type CaseRecord,
  type CaseStatus,
  type InitialPackFailureReason,
  type InitialPackStatus,
  type ManagerDecision,
} from '../../../../src/contracts/case'
import type { z } from 'zod'
import { HandoffPacketSchema, type HandoffPacket } from '../../../../src/contracts/handoff'

export type { CaseRecord, ManagerDecision }

export type CaseCreateInput = z.input<typeof ComplaintInputSchema>
export type CaseUpdate = Partial<Pick<CaseRecord,
  'status' | 'analysis' | 'analysisStatus' | 'managerDecision' | 'initialPack' |
  'initialPackStatus' | 'initialPackFailureReason' | 'initialPackGeneration'
>> & {
  clearInitialPackFailureReason?: boolean
  clearInitialPackGeneration?: boolean
}

export type CaseExpectedState = {
  version: number
  status: CaseStatus
  initialPackStatus?: InitialPackStatus | null
  generationId?: string
}

export type CaseTransitionRequest = {
  expectedVersion: number
  expectedStatus: CaseStatus
  expectedInitialPackStatus?: InitialPackStatus | null
  expectedGenerationId?: string
  patch: CaseUpdate
}

export type CaseEvent = {
  id: string
  caseId: string
  actorId: string
  type: 'case.created' | 'case.updated' | 'case.handoff'
  occurredAt: string
  data?: { reason: string; handoffId: string; packet?: HandoffPacket }
}

export interface CasePersistenceAdapter {
  insertCase(record: CaseRecord): Promise<void>
  findCase(id: string, createdBy: string): Promise<CaseRecord | undefined>
  findCases(createdBy: string): Promise<CaseRecord[]>
  compareAndSwapCase(id: string, createdBy: string, expected: CaseExpectedState, patch: CaseUpdate): Promise<boolean>
  insertEvent(event: CaseEvent): Promise<void>
  findEvents(caseId: string): Promise<CaseEvent[]>
}

const GENERATION_LEASE_MS = 5 * 60 * 1000

export class CaseRepository {
  constructor(private readonly adapter: CasePersistenceAdapter) {}

  async create(createdBy: string, input: CaseCreateInput): Promise<CaseRecord> {
    const complaint = ComplaintInputSchema.parse(input)
    const now = new Date().toISOString()
    const record = CaseRecordSchema.parse({
      id: createId('case'), content: complaint.content, facts: complaint.facts, attachments: complaint.attachments,
      status: 'intake', createdBy, createdAt: now, updatedAt: now, version: 1,
    })
    await this.adapter.insertCase(record)
    await this.recordEventBestEffort({ id: createId('event'), caseId: record.id, actorId: createdBy, type: 'case.created', occurredAt: now })
    return record
  }

  async get(id: string, actorId: string): Promise<CaseRecord> {
    const record = await this.adapter.findCase(id, actorId)
    if (!record) throw new Error('CASE_NOT_FOUND')
    return CaseRecordSchema.parse(record)
  }

  async list(actorId: string): Promise<CaseRecord[]> {
    return CaseRecordSchema.array().parse(await this.adapter.findCases(actorId))
  }

  async update(id: string, actorId: string, patch: CaseUpdate): Promise<CaseRecord> {
    const current = await this.get(id, actorId)
    return this.transition(id, actorId, {
      expectedVersion: current.version,
      expectedStatus: current.status,
      expectedInitialPackStatus: current.initialPackStatus ?? null,
      expectedGenerationId: current.initialPackGeneration?.generationId,
      patch,
    })
  }

  async transition(id: string, actorId: string, request: CaseTransitionRequest): Promise<CaseRecord> {
    const current = await this.get(id, actorId)
    if (!matchesExpectedState(current, request)) throw new Error('CASE_VERSION_CONFLICT')
    const patch = validateUpdate(request.patch)
    buildNextRecord(current, patch)
    const changed = await this.adapter.compareAndSwapCase(id, actorId, {
      version: request.expectedVersion,
      status: request.expectedStatus,
      initialPackStatus: request.expectedInitialPackStatus,
      generationId: request.expectedGenerationId,
    }, patch)
    if (!changed) throw new Error('CASE_VERSION_CONFLICT')
    await this.recordEventBestEffort({
      id: createId('event'), caseId: id, actorId, type: 'case.updated', occurredAt: new Date().toISOString(),
    })
    return this.get(id, actorId)
  }

  async claimInitialPackGeneration(
    id: string,
    actorId: string,
    options: { retry: boolean; now?: Date },
  ): Promise<CaseRecord> {
    const record = await this.get(id, actorId)
    if (record.status !== 'confirmed') throw new Error('CASE_STATE_INVALID')

    const now = options.now ?? new Date()
    if (record.initialPackStatus === 'generating') {
      const leaseUntil = Date.parse(record.initialPackGeneration!.leaseUntil)
      if (leaseUntil > now.getTime()) throw new Error('INITIAL_PACK_GENERATING')
      if (!options.retry) throw new Error('INITIAL_PACK_LEASE_EXPIRED')
    } else if (record.initialPackStatus === 'manual_handoff') {
      if (!options.retry) throw new Error('INITIAL_PACK_MANUAL_HANDOFF')
    } else if (record.initialPackStatus === 'generated') {
      throw new Error('INITIAL_PACK_ALREADY_GENERATED')
    } else if (options.retry) {
      throw new Error('INITIAL_PACK_RETRY_NOT_ALLOWED')
    }

    const claimedAt = now.toISOString()
    return this.transition(id, actorId, {
      expectedVersion: record.version,
      expectedStatus: 'confirmed',
      expectedInitialPackStatus: record.initialPackStatus ?? null,
      expectedGenerationId: record.initialPackGeneration?.generationId,
      patch: {
        initialPackStatus: 'generating',
        initialPackGeneration: {
          generationId: createId('generation'),
          claimedAt,
          leaseUntil: new Date(now.getTime() + GENERATION_LEASE_MS).toISOString(),
        },
        clearInitialPackFailureReason: true,
      },
    })
  }

  async finalizeInitialPackSuccess(
    id: string,
    actorId: string,
    input: { expectedVersion: number; generationId: string; initialPack: CaseRecord['initialPack'] },
  ): Promise<CaseRecord> {
    if (!input.initialPack) throw new Error('INITIAL_PACK_ASSEMBLY_FAILED')
    return this.transition(id, actorId, {
      expectedVersion: input.expectedVersion,
      expectedStatus: 'confirmed',
      expectedInitialPackStatus: 'generating',
      expectedGenerationId: input.generationId,
      patch: {
        status: 'initial_pack', initialPackStatus: 'generated', initialPack: input.initialPack,
        clearInitialPackFailureReason: true, clearInitialPackGeneration: true,
      },
    })
  }

  async finalizeInitialPackFailure(
    id: string,
    actorId: string,
    input: { expectedVersion: number; generationId: string; failureReason: InitialPackFailureReason },
  ): Promise<CaseRecord> {
    return this.transition(id, actorId, {
      expectedVersion: input.expectedVersion,
      expectedStatus: 'confirmed',
      expectedInitialPackStatus: 'generating',
      expectedGenerationId: input.generationId,
      patch: {
        initialPackStatus: 'manual_handoff', initialPackFailureReason: input.failureReason,
        clearInitialPackGeneration: true,
      },
    })
  }

  async recordHandoff(id: string, actorId: string, packet: HandoffPacket): Promise<void> {
    await this.get(id, actorId)
    await this.recordEventBestEffort({
      id: createId('event'), caseId: id, actorId, type: 'case.handoff', occurredAt: new Date().toISOString(),
      data: { reason: packet.reason, handoffId: packet.id, packet },
    })
  }

  async listHandoffs(id: string, actorId: string): Promise<HandoffPacket[]> {
    await this.get(id, actorId)
    const events = await this.adapter.findEvents(id)
    return events
      .filter((event) => event.type === 'case.handoff' && event.data?.packet)
      .map((event) => HandoffPacketSchema.parse(event.data!.packet))
  }

  private async recordEventBestEffort(event: CaseEvent): Promise<void> {
    try { await this.adapter.insertEvent(event) } catch { /* state is already committed */ }
  }
}

function validateUpdate(patch: CaseUpdate): CaseUpdate {
  const result: CaseUpdate = {}
  if (patch.status) result.status = patch.status
  if (patch.analysis) result.analysis = CaseAnalysisSchema.parse(patch.analysis)
  if (patch.analysisStatus) result.analysisStatus = patch.analysisStatus
  if (patch.managerDecision) result.managerDecision = ManagerDecisionSchema.parse(patch.managerDecision)
  if (patch.initialPack) result.initialPack = InitialPackSchema.parse(patch.initialPack)
  if (patch.initialPackStatus) result.initialPackStatus = InitialPackStatusSchema.parse(patch.initialPackStatus)
  if (patch.initialPackFailureReason) result.initialPackFailureReason = InitialPackFailureReasonSchema.parse(patch.initialPackFailureReason)
  if (patch.initialPackGeneration) result.initialPackGeneration = InitialPackGenerationSchema.parse(patch.initialPackGeneration)
  if (patch.clearInitialPackFailureReason) result.clearInitialPackFailureReason = true
  if (patch.clearInitialPackGeneration) result.clearInitialPackGeneration = true
  return result
}

export class InMemoryCaseAdapter implements CasePersistenceAdapter {
  private readonly cases = new Map<string, CaseRecord>()
  private readonly events: CaseEvent[] = []

  async insertCase(record: CaseRecord): Promise<void> { this.cases.set(record.id, clone(CaseRecordSchema.parse(record))) }
  async findCase(id: string, createdBy: string): Promise<CaseRecord | undefined> {
    const record = this.cases.get(id)
    return record?.createdBy === createdBy ? CaseRecordSchema.parse(clone(record)) : undefined
  }
  async findCases(createdBy: string): Promise<CaseRecord[]> {
    return CaseRecordSchema.array().parse([...this.cases.values()].filter((record) => record.createdBy === createdBy).map(clone))
  }
  async compareAndSwapCase(id: string, createdBy: string, expected: CaseExpectedState, patch: CaseUpdate): Promise<boolean> {
    const record = this.cases.get(id)
    if (!record || record.createdBy !== createdBy || record.version !== expected.version || record.status !== expected.status) return false
    if (expected.initialPackStatus !== undefined && (record.initialPackStatus ?? null) !== expected.initialPackStatus) return false
    if (expected.generationId !== undefined && record.initialPackGeneration?.generationId !== expected.generationId) return false

    this.cases.set(id, buildNextRecord(record, patch))
    return true
  }
  async insertEvent(event: CaseEvent): Promise<void> { this.events.push(clone(event)) }
  async eventsFor(caseId: string): Promise<CaseEvent[]> { return this.events.filter((event) => event.caseId === caseId).map(clone) }
  async findEvents(caseId: string): Promise<CaseEvent[]> { return this.eventsFor(caseId) }
}

/** Production adapter. CloudBase credentials are resolved only by the server runtime. */
export class CloudBaseCaseAdapter implements CasePersistenceAdapter {
  constructor(private readonly db: any) {}

  async insertCase(record: CaseRecord): Promise<void> { await this.db.collection('cases').add(toCloudRecord(CaseRecordSchema.parse(record))) }
  async findCase(id: string, createdBy: string): Promise<CaseRecord | undefined> {
    const result = await this.db.collection('cases').where({ _id: id, createdBy }).get()
    return result.data[0] ? fromCloudRecord(result.data[0]) : undefined
  }
  async findCases(createdBy: string): Promise<CaseRecord[]> {
    const result = await this.db.collection('cases').where({ createdBy }).get()
    return CaseRecordSchema.array().parse(result.data.map(fromCloudRecord))
  }
  async compareAndSwapCase(id: string, createdBy: string, expected: CaseExpectedState, patch: CaseUpdate): Promise<boolean> {
    const condition: Record<string, unknown> = { _id: id, createdBy, version: expected.version, status: expected.status }
    if (expected.initialPackStatus === null) condition.initialPackStatus = this.db.command.exists(false)
    else if (expected.initialPackStatus !== undefined) condition.initialPackStatus = expected.initialPackStatus
    if (expected.generationId !== undefined) condition['initialPackGeneration.generationId'] = expected.generationId

    const { clearInitialPackFailureReason, clearInitialPackGeneration, ...persistedPatch } = patch
    const update: Record<string, unknown> = {
      ...persistedPatch,
      version: this.db.command.inc(1),
      updatedAt: new Date().toISOString(),
    }
    if (clearInitialPackFailureReason) update.initialPackFailureReason = this.db.command.remove()
    if (clearInitialPackGeneration) update.initialPackGeneration = this.db.command.remove()
    const result = await this.db.collection('cases').where(condition).update(update)
    return Number(result.updated ?? result.stats?.updated ?? 0) > 0
  }
  async insertEvent(event: CaseEvent): Promise<void> { await this.db.collection('case_events').add({ ...event, _id: event.id }) }
  async findEvents(caseId: string): Promise<CaseEvent[]> {
    const result = await this.db.collection('case_events').where({ caseId }).get()
    return result.data.map((event: Record<string, unknown>) => {
      const { _id: _ignored, ...rest } = event
      return rest as CaseEvent
    })
  }
}

export function createCloudBaseCaseAdapter(db: unknown): CloudBaseCaseAdapter {
  return new CloudBaseCaseAdapter(db)
}

function toCloudRecord(record: CaseRecord) { const { id, ...rest } = record; return { ...rest, _id: id } }
function fromCloudRecord(record: Record<string, unknown>): CaseRecord {
  const { _id, id: _storedId, ...rest } = record
  return CaseRecordSchema.parse({ id: String(_id), ...normalizeLegacyAnalysis(rest) })
}

function normalizeLegacyAnalysis(record: Record<string, unknown>): Record<string, unknown> {
  const analysis = record.analysis
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis) || 'facts' in analysis) return record

  const legacy = analysis as Record<string, unknown>
  const facts: Record<string, string> = {}
  if (record.facts && typeof record.facts === 'object' && !Array.isArray(record.facts)) {
    for (const [field, value] of Object.entries(record.facts)) {
      if (CaseFactFieldSchema.safeParse(field).success && typeof value === 'string' && value.trim()) facts[field] = value.trim()
    }
  }
  if (Array.isArray(legacy.evidenceSpans)) {
    for (const span of legacy.evidenceSpans) {
      if (!span || typeof span !== 'object' || Array.isArray(span)) continue
      const { field, text } = span as Record<string, unknown>
      if (CaseFactFieldSchema.safeParse(field).success && typeof field === 'string' && typeof text === 'string' && text.trim() && !facts[field]) {
        facts[field] = text.trim()
      }
    }
  }

  const recoveredFields = new Set(Object.keys(facts))
  const missingFields = Array.isArray(legacy.missingFields)
    ? legacy.missingFields.filter((field) => typeof field === 'string' && !recoveredFields.has(field))
    : []
  return {
    ...record,
    analysis: {
      ...legacy,
      facts,
      missingFields,
      informationCompleteness: Math.round((recoveredFields.size / 7) * 100),
    },
  }
}
function clone<T>(value: T): T { return structuredClone(value) }
function matchesExpectedState(record: CaseRecord, expected: CaseTransitionRequest): boolean {
  if (record.version !== expected.expectedVersion || record.status !== expected.expectedStatus) return false
  if (expected.expectedInitialPackStatus !== undefined && (record.initialPackStatus ?? null) !== expected.expectedInitialPackStatus) return false
  if (expected.expectedGenerationId !== undefined && record.initialPackGeneration?.generationId !== expected.expectedGenerationId) return false
  return true
}
function buildNextRecord(record: CaseRecord, patch: CaseUpdate): CaseRecord {
  const { clearInitialPackFailureReason, clearInitialPackGeneration, ...persistedPatch } = clone(patch)
  const next: CaseRecord = {
    ...record,
    ...persistedPatch,
    version: record.version + 1,
    updatedAt: timestampAfter(record.updatedAt),
  }
  if (clearInitialPackFailureReason) delete next.initialPackFailureReason
  if (clearInitialPackGeneration) delete next.initialPackGeneration
  return CaseRecordSchema.parse(next)
}
function createId(prefix: string): string { return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function timestampAfter(previous: string): string {
  const now = Date.now()
  const previousTime = Date.parse(previous)
  return new Date(Number.isFinite(previousTime) && now <= previousTime ? previousTime + 1 : now).toISOString()
}
