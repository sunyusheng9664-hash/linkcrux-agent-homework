import { ApiResponseSchema } from '../contracts/api'
import {
  CaseRecordSchema,
  ComplaintInputSchema,
  ManagerDecisionSchema,
  type CaseRecord,
  type ComplaintInput,
  type ManagerDecision,
} from '../contracts/case'
import { createCloudbaseClient, type CloudbaseClient } from './cloudbase'
import { z } from 'zod'
import { DocumentSchema, KnowledgeChunkSchema, KnowledgeItemSchema, KnowledgeScopeSchema, KnowledgeSourceTypeSchema, KnowledgeVisibilitySchema } from '../contracts/knowledge'
import { HandoffPacketSchema } from '../contracts/handoff'
import { AdvanceCasePayloadSchema, type AdvanceCaseInput } from '../contracts/workflow'

const KnowledgeIngestResultSchema = z.object({ document: DocumentSchema, items: z.array(KnowledgeItemSchema) }).passthrough()
const KnowledgeCitationSourceSchema = z.object({
  documentId: z.string().min(1),
  documentName: z.string().min(1),
  version: z.string().min(1),
  chunks: z.array(KnowledgeChunkSchema),
}).strict()
const KnowledgeAnswerSchema = z.object({
  decision: z.enum(['answer', 'handoff']),
  answer: z.string().nullable(),
  citations: z.array(z.object({ itemId: z.string().min(1), documentId: z.string().min(1), documentName: z.string().min(1), version: z.string().min(1), chunkIds: z.array(z.string().min(1)).min(1) }).strict()).max(3),
  missingInformation: z.array(z.string().min(1)).max(10),
  reason: z.enum(['HIGH_RISK', 'SENSITIVE_REQUEST', 'KNOWLEDGE_NOT_COVERED', 'UNSUPPORTED_CITATION', 'MODEL_FAILED']).optional(),
  handoff: HandoffPacketSchema.optional(),
}).strict()
export type KnowledgeIngestInput = {
  name: string; mimeType: 'text/plain' | 'text/markdown'; sourceType: z.input<typeof KnowledgeSourceTypeSchema>; originalFileId: string; version: string; text: string; owner: string; scope: z.input<typeof KnowledgeScopeSchema>; visibility: z.input<typeof KnowledgeVisibilitySchema>; effectiveAt: string; expiresAt?: string; confidentiality?: 'internal' | 'confidential'
}

export type AgentApi = {
  createCase(input: ComplaintInput): Promise<CaseRecord>
  listCases(): Promise<CaseRecord[]>
  getCase(id: string): Promise<CaseRecord>
  analyzeCase(id: string): Promise<CaseRecord>
  confirmCase(input: { id: string } & ManagerDecision): Promise<CaseRecord>
  generateInitialPack(id: string, options?: { retry?: boolean }): Promise<CaseRecord>
  advanceCase(id: string, input: AdvanceCaseInput): Promise<CaseRecord>
  closeCase(id: string): Promise<CaseRecord>
  generateKnowledgeCard(id: string): Promise<{ item: z.infer<typeof KnowledgeItemSchema>; caseNumber: string }>
  ingestKnowledge(input: KnowledgeIngestInput): Promise<z.infer<typeof KnowledgeIngestResultSchema>>
  listPendingKnowledge(): Promise<z.infer<typeof KnowledgeItemSchema>[]>
  reviewKnowledge(id: string, status: 'published' | 'rejected', reason?: string): Promise<z.infer<typeof KnowledgeItemSchema>>
  getKnowledgeCitation(id: string): Promise<z.infer<typeof KnowledgeCitationSourceSchema>>
  listHandoffs(id: string): Promise<z.infer<typeof HandoffPacketSchema>[]>
  answerKnowledge(input: { query: string; scope: z.input<typeof KnowledgeScopeSchema>; caseId?: string }): Promise<z.infer<typeof KnowledgeAnswerSchema>>
}

export function createAgentApi(client: CloudbaseClient = createCloudbaseClient()): AgentApi {
  return {
    async createCase(input) {
      const data = await call(client, 'cases.create', ComplaintInputSchema.parse(input))
      return CaseRecordSchema.parse(data)
    },
    async listCases() {
      const data = await call(client, 'cases.list', {})
      return CaseRecordSchema.array().parse(data)
    },
    async getCase(id) {
      return CaseRecordSchema.parse(await call(client, 'cases.get', { id }))
    },
    async analyzeCase(id) {
      return CaseRecordSchema.parse(await call(client, 'cases.analyze', { id }))
    },
    async confirmCase({ id, ...decision }) {
      const data = await call(client, 'cases.confirm', { id, decision: ManagerDecisionSchema.parse(decision) })
      return CaseRecordSchema.parse(data)
    },
    async generateInitialPack(id, options) {
      return CaseRecordSchema.parse(await call(client, 'cases.generateInitialPack', { id, retry: options?.retry ?? false }))
    },
    async advanceCase(id, input) {
      return CaseRecordSchema.parse(await call(client, 'cases.advance', { id, ...AdvanceCasePayloadSchema.parse(input) }))
    },
    async closeCase(id) {
      return CaseRecordSchema.parse(await call(client, 'cases.close', { id }))
    },
    async generateKnowledgeCard(id) {
      const data = await call(client, 'cases.generateKnowledgeCard', { id }) as { item: unknown; caseNumber: string }
      return { item: KnowledgeItemSchema.parse(data.item), caseNumber: data.caseNumber }
    },
    async ingestKnowledge(input) {
      return KnowledgeIngestResultSchema.parse(await call(client, 'knowledge.ingest', input))
    },
    async listPendingKnowledge() {
      return KnowledgeItemSchema.array().parse(await call(client, 'knowledge.pending', {}))
    },
    async reviewKnowledge(id, status, reason) {
      return KnowledgeItemSchema.parse(await call(client, 'knowledge.review', { id, status, reason }))
    },
    async getKnowledgeCitation(id) {
      return KnowledgeCitationSourceSchema.parse(await call(client, 'knowledge.citation', { id }))
    },
    async listHandoffs(id) {
      return z.array(HandoffPacketSchema).parse(await call(client, 'handoff.list', { id }))
    },
    async answerKnowledge(input) {
      return KnowledgeAnswerSchema.parse(await call(client, 'knowledge.answer', input))
    },
  }
}

async function call(client: CloudbaseClient, action: string, payload: unknown): Promise<unknown> {
  let result: { result: unknown }
  try {
    result = await client.callFunction<unknown>({ name: 'agent-api', data: { action, payload }, parse: true })
  } catch (err) {
    // 云端 SDK 某些出错路径会以对象而非 Error 抛出，统一转成可读错误码，避免界面显示 [object Object]。
    throw new Error(readableErrorCode(err))
  }
  const response = ApiResponseSchema.parse(result.result)
  if (!response.ok) throw new Error(response.error.code)
  return response.data
}

function readableErrorCode(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object') {
    const obj = err as { code?: unknown; message?: unknown }
    const code = typeof obj.code === 'string' && obj.code.trim() ? obj.code : ''
    const message = typeof obj.message === 'string' && obj.message.trim() ? obj.message : ''
    return code || message || 'REQUEST_FAILED'
  }
  return 'REQUEST_FAILED'
}
