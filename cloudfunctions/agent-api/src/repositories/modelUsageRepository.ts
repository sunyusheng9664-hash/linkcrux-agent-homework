export type ModelUsageRecord = {
  id: string
  caseId: string
  actorId: string
  action: 'cases.analyze' | 'cases.generateInitialPack'
  outcome: 'ai_completed' | 'manual_takeover' | 'generated' | 'failed'
  recordedAt: string
}

export interface ModelUsagePersistenceAdapter {
  insertModelUsage(record: ModelUsageRecord): Promise<void>
}

export class ModelUsageRepository {
  constructor(private readonly adapter: ModelUsagePersistenceAdapter) {}
  async record(input: Omit<ModelUsageRecord, 'id' | 'recordedAt'>): Promise<void> {
    await this.adapter.insertModelUsage({ id: globalThis.crypto?.randomUUID?.() ?? `usage-${Date.now()}`, recordedAt: new Date().toISOString(), ...input })
  }
}

export class InMemoryModelUsageAdapter implements ModelUsagePersistenceAdapter {
  readonly records: ModelUsageRecord[] = []
  async insertModelUsage(record: ModelUsageRecord): Promise<void> { this.records.push(structuredClone(record)) }
}

export class CloudBaseModelUsageAdapter implements ModelUsagePersistenceAdapter {
  constructor(private readonly db: any) {}
  async insertModelUsage(record: ModelUsageRecord): Promise<void> { await this.db.collection('model_usage').add({ ...record, _id: record.id }) }
}
