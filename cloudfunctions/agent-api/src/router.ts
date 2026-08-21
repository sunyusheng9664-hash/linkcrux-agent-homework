import { z } from 'zod'
import { Buffer } from 'node:buffer'

import { ApiRequestSchema, ApiResponseSchema, type ApiResponse } from '../../../src/contracts/api'
import {
  ComplaintInputSchema,
  ManagerDecisionSchema,
  managerSeverityBaseline,
  type CaseAnalysis,
  type InitialPackFailureReason,
  type InitialPack,
} from '../../../src/contracts/case'
import { KnowledgeScopeSchema, KnowledgeSourceTypeSchema, KnowledgeVisibilitySchema } from '../../../src/contracts/knowledge'
import type { InitialPackSource } from './actions/generateInitialPack'
import type { IngestKnowledgeInput } from './actions/ingestKnowledge'
import type { KnowledgeAnswer } from './actions/answerKnowledge'
import type { HandoffPacket, HandoffReason } from '../../../src/contracts/handoff'
import { evaluateHardRisk } from '../../../src/domain/risk'
import { CaseRepository, type ManagerDecision } from './repositories/caseRepository'
import { KnowledgeRepository } from './repositories/knowledgeRepository'
import { ModelUsageRepository } from './repositories/modelUsageRepository'
import type { AttachmentVerifier } from './services/attachmentVerifier'

const CaseIdPayloadSchema = z.object({ id: z.string().min(1) }).strict()
const GenerateInitialPackPayloadSchema = CaseIdPayloadSchema.extend({ retry: z.boolean().default(false) }).strict()
const ConfirmPayloadSchema = CaseIdPayloadSchema.extend({
  decision: ManagerDecisionSchema,
}).strict()
const KnowledgeIngestPayloadSchema = z.object({
  name: z.string().trim().min(1),
  mimeType: z.enum(['text/plain', 'text/markdown']),
  sourceType: KnowledgeSourceTypeSchema,
  originalFileId: z.string().min(1),
  version: z.string().trim().min(1),
  text: z.string().trim().min(1).max(2 * 1024 * 1024),
  owner: z.string().trim().min(1),
  scope: KnowledgeScopeSchema,
  visibility: KnowledgeVisibilitySchema,
  effectiveAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
}).strict()
const KnowledgeReviewPayloadSchema = z.object({ id: z.string().min(1), status: z.enum(['published', 'rejected']) }).strict()
const KnowledgeAnswerPayloadSchema = z.object({ query: z.string().trim().min(1).max(1000), scope: KnowledgeScopeSchema, caseId: z.string().min(1).optional() }).strict()
const HandoffPayloadSchema = z.object({ id: z.string().min(1), reason: z.enum(['OUT_OF_SCOPE', 'HIGH_RISK', 'INFORMATION_INSUFFICIENT', 'SYSTEM_QUERY_REQUIRED', 'KNOWLEDGE_NOT_COVERED', 'LOW_CONFIDENCE']), suggestedTeam: z.string().trim().min(1), searchedKnowledge: z.array(z.string().min(1)).max(3).default([]) }).strict()

export type AuthContext = { userId?: string; knowledgeRole?: 'quality_manager' | 'knowledge_owner' }
export type RouterDependencies = {
  caseRepository: CaseRepository
  modelUsageRepository: ModelUsageRepository
  attachmentVerifier: AttachmentVerifier
  analyzeComplaint: (input: z.input<typeof ComplaintInputSchema>) => Promise<CaseAnalysis>
  generateInitialPack?: (source: InitialPackSource) => Promise<InitialPack>
  knowledgeRepository?: KnowledgeRepository
  ingestKnowledge?: (input: IngestKnowledgeInput) => Promise<unknown>
  reviewKnowledgeItem?: (
    id: string,
    input: { status: 'published' | 'rejected' },
    reviewer: { userId: string; role: 'quality_manager' | 'knowledge_owner' },
  ) => Promise<unknown>
  answerKnowledge?: (query: string, context: { now: string; actorId: string; role: 'quality_manager' | 'knowledge_owner'; scope: z.infer<typeof KnowledgeScopeSchema> }, options?: { referenceOnly?: boolean }) => Promise<KnowledgeAnswer>
  createHandoff?: (id: string, actorId: string, input: { reason: HandoffReason; suggestedTeam: string; searchedKnowledge?: string[]; source?: 'complaint' | 'knowledge' }) => Promise<HandoffPacket>
}

export function createRouter(deps: RouterDependencies) {
  return { route: (request: z.input<typeof ApiRequestSchema>, context: AuthContext) => route(request, context, deps) }
}

export async function route(request: z.input<typeof ApiRequestSchema>, context: AuthContext, deps: RouterDependencies): Promise<ApiResponse> {
  const parsedRequest = ApiRequestSchema.parse(request)
  const userId = requireUser(context)
  switch (parsedRequest.action) {
    case 'cases.create': {
      const complaint = ComplaintInputSchema.parse(parsedRequest.payload)
      const attachments = await deps.attachmentVerifier.verify(userId, complaint.attachments)
      const created = await deps.caseRepository.create(userId, { ...complaint, attachments })
      return success(created)
    }
    case 'cases.list': return success(await deps.caseRepository.list(userId))
    case 'cases.get': return success(await deps.caseRepository.get(CaseIdPayloadSchema.parse(parsedRequest.payload).id, userId))
    case 'cases.analyze': return analyzeCase(CaseIdPayloadSchema.parse(parsedRequest.payload).id, userId, deps)
    case 'cases.confirm': {
      const { id, decision } = parseConfirmation(parsedRequest.payload)
      return confirmCase(id, userId, decision, deps)
    }
    case 'cases.generateInitialPack': {
      const { id, retry } = GenerateInitialPackPayloadSchema.parse(parsedRequest.payload)
      return generateCaseInitialPack(id, userId, retry, deps)
    }
    case 'knowledge.ingest': {
      if (!deps.ingestKnowledge) throw new Error('KNOWLEDGE_UNAVAILABLE')
      const payload = KnowledgeIngestPayloadSchema.parse(parsedRequest.payload)
      return success(await deps.ingestKnowledge({ ...payload, actorId: userId, buffer: Buffer.from(payload.text, 'utf8') }))
    }
    case 'knowledge.review': {
      if (!deps.reviewKnowledgeItem) throw new Error('KNOWLEDGE_UNAVAILABLE')
      const payload = KnowledgeReviewPayloadSchema.parse(parsedRequest.payload)
      return success(await deps.reviewKnowledgeItem(payload.id, { status: payload.status }, {
        userId,
        role: context.knowledgeRole ?? 'quality_manager',
      }))
    }
    case 'knowledge.list': {
      if (!deps.knowledgeRepository) throw new Error('KNOWLEDGE_UNAVAILABLE')
      return success(await deps.knowledgeRepository.listDocuments(userId))
    }
    case 'knowledge.pending': {
      if (!deps.knowledgeRepository) throw new Error('KNOWLEDGE_UNAVAILABLE')
      if (context.knowledgeRole !== 'knowledge_owner') throw new Error('FORBIDDEN')
      return success(await deps.knowledgeRepository.listPendingReview())
    }
    case 'knowledge.citation': {
      if (!deps.knowledgeRepository) throw new Error('KNOWLEDGE_UNAVAILABLE')
      if (context.knowledgeRole !== 'knowledge_owner') throw new Error('FORBIDDEN')
      const item = await deps.knowledgeRepository.getItem(CaseIdPayloadSchema.parse(parsedRequest.payload).id)
      return success(await deps.knowledgeRepository.getCitationSource(item))
    }
    case 'knowledge.answer': {
      if (!deps.answerKnowledge) throw new Error('KNOWLEDGE_UNAVAILABLE')
      const payload = KnowledgeAnswerPayloadSchema.parse(parsedRequest.payload)
      const caseRecord = payload.caseId ? await deps.caseRepository.get(payload.caseId, userId) : undefined
      const caseFacts = caseRecord?.facts ?? caseRecord?.analysis?.facts ?? {}
      const highRisk = caseRecord ? evaluateHardRisk(caseFacts, caseRecord.content).length > 0 : false
      // For a high-risk case, use the incident wording to find relevant published SOPs.
      // The returned material remains manager-only reference; it never becomes an automatic customer reply.
      const retrievalQuery = highRisk ? `${payload.query}\n${caseRecord!.content}` : payload.query
      const answer = await deps.answerKnowledge(retrievalQuery, {
        now: new Date().toISOString(), actorId: userId, role: context.knowledgeRole ?? 'quality_manager', scope: payload.scope,
      }, { referenceOnly: highRisk })
      if (highRisk && answer.decision === 'answer') {
        if (!payload.caseId || !deps.createHandoff) throw new Error('HANDOFF_UNAVAILABLE')
        const handoff = await deps.createHandoff(payload.caseId, userId, {
          reason: 'HIGH_RISK', suggestedTeam: '质量经理人工接管', searchedKnowledge: answer.citations.map((citation) => citation.itemId), source: 'knowledge',
        })
        return success({ ...answer, decision: 'handoff', reason: 'HIGH_RISK', handoff })
      }
      if (answer.decision !== 'handoff' || !payload.caseId || !deps.createHandoff) return success(answer)
      const handoff = await deps.createHandoff(payload.caseId, userId, {
        reason: knowledgeHandoffReason(answer.reason), suggestedTeam: '质量经理人工接管', searchedKnowledge: answer.citations.map((citation) => citation.itemId), source: 'knowledge',
      })
      return success({ ...answer, handoff })
    }
    case 'handoff.create': {
      if (!deps.createHandoff) throw new Error('HANDOFF_UNAVAILABLE')
      const payload = HandoffPayloadSchema.parse(parsedRequest.payload)
      return success(await deps.createHandoff(payload.id, userId, payload))
    }
    case 'handoff.list': {
      const { id } = CaseIdPayloadSchema.parse(parsedRequest.payload)
      return success(await deps.caseRepository.listHandoffs(id, userId))
    }
    default: throw new Error('ACTION_NOT_ALLOWED')
  }
}

async function confirmCase(id: string, userId: string, decision: ManagerDecision, deps: RouterDependencies): Promise<ApiResponse> {
  const caseRecord = await deps.caseRepository.get(id, userId)
  if ((caseRecord.status !== 'analyzed' && caseRecord.status !== 'confirmed') || caseRecord.initialPackStatus) {
    throw new Error('CASE_STATE_INVALID')
  }
  if (!caseRecord.analysis) throw new Error('CASE_STATE_INVALID')
  if (decision.outcome === 'accepted') {
    const severityBaseline = managerSeverityBaseline(caseRecord.analysis.routing.requiresHuman)
    if (decision.start8d !== caseRecord.analysis.start8dSuggestion || decision.severity !== severityBaseline) {
      throw new Error('CONFIRMATION_INVALID')
    }
  }
  return success(await deps.caseRepository.transition(id, userId, {
    expectedVersion: caseRecord.version,
    expectedStatus: caseRecord.status,
    expectedInitialPackStatus: null,
    patch: { status: 'confirmed', managerDecision: decision },
  }))
}

async function generateCaseInitialPack(id: string, userId: string, retry: boolean, deps: RouterDependencies): Promise<ApiResponse> {
  const caseRecord = await deps.caseRepository.get(id, userId)
  if (caseRecord.status === 'initial_pack' && caseRecord.initialPackStatus === 'generated' && caseRecord.initialPack) return success(caseRecord)
  if (caseRecord.status !== 'confirmed' || !caseRecord.managerDecision || !caseRecord.analysis) {
    throw new Error('CASE_NOT_CONFIRMED')
  }
  if (!deps.generateInitialPack) throw new Error('INITIAL_PACK_UNAVAILABLE')
  const claimed = await deps.caseRepository.claimInitialPackGeneration(id, userId, { retry })
  const generationId = claimed.initialPackGeneration!.generationId

  let initialPack: InitialPack
  try {
    initialPack = await deps.generateInitialPack({
      caseId: claimed.id,
      content: claimed.content,
      facts: claimed.facts,
      analysis: claimed.analysis!,
      managerDecision: claimed.managerDecision!,
    })
  } catch (error) {
    const failureReason = initialPackFailureReason(error)
    await deps.caseRepository.finalizeInitialPackFailure(id, userId, {
      expectedVersion: claimed.version, generationId, failureReason,
    })
    await recordUsageBestEffort(deps.modelUsageRepository, { caseId: id, actorId: userId, action: 'cases.generateInitialPack', outcome: 'failed' })
    throw new Error(failureReason)
  }

  const updated = await deps.caseRepository.finalizeInitialPackSuccess(id, userId, {
    expectedVersion: claimed.version, generationId, initialPack,
  })
  await recordUsageBestEffort(deps.modelUsageRepository, { caseId: id, actorId: userId, action: 'cases.generateInitialPack', outcome: 'generated' })
  return success(updated)
}

async function analyzeCase(id: string, userId: string, deps: RouterDependencies): Promise<ApiResponse> {
  const caseRecord = await deps.caseRepository.get(id, userId)
  if (caseRecord.status !== 'intake' && caseRecord.status !== 'analyzed') throw new Error('CASE_STATE_INVALID')
  try {
    const analysis = await deps.analyzeComplaint({ content: caseRecord.content, facts: caseRecord.facts, attachments: caseRecord.attachments })
    const updated = await deps.caseRepository.transition(id, userId, {
      expectedVersion: caseRecord.version,
      expectedStatus: caseRecord.status,
      expectedInitialPackStatus: null,
      patch: { analysis, analysisStatus: analysis.analysisStatus, status: 'analyzed' },
    })
    await recordUsageBestEffort(deps.modelUsageRepository, { caseId: id, actorId: userId, action: 'cases.analyze', outcome: analysis.analysisStatus })
    return success(updated)
  } catch (error) {
    await recordUsageBestEffort(deps.modelUsageRepository, { caseId: id, actorId: userId, action: 'cases.analyze', outcome: 'failed' })
    throw error
  }
}

async function recordUsageBestEffort(
  repository: ModelUsageRepository,
  input: Parameters<ModelUsageRepository['record']>[0],
): Promise<void> {
  try { await repository.record(input) } catch { /* state transition already committed */ }
}

function initialPackFailureReason(error: unknown): InitialPackFailureReason {
  const message = error instanceof Error ? error.message : ''
  if (message === 'INITIAL_PACK_UNSAFE_D3' || message === 'INITIAL_PACK_ASSEMBLY_FAILED') return message
  return 'INITIAL_PACK_MODEL_FAILED'
}

function parseConfirmation(payload: unknown): { id: string; decision: ManagerDecision } {
  const parsed = ConfirmPayloadSchema.safeParse(payload)
  if (!parsed.success) throw new Error('CONFIRMATION_INVALID')
  return parsed.data
}
function requireUser(context: AuthContext): string { if (!context.userId) throw new Error('UNAUTHENTICATED'); return context.userId }
function knowledgeHandoffReason(reason: KnowledgeAnswer['reason']): HandoffReason {
  if (reason === 'HIGH_RISK') return 'HIGH_RISK'
  if (reason === 'KNOWLEDGE_NOT_COVERED') return 'KNOWLEDGE_NOT_COVERED'
  if (reason === 'SENSITIVE_REQUEST') return 'OUT_OF_SCOPE'
  return 'LOW_CONFIDENCE'
}
function success(data: unknown): ApiResponse { return ApiResponseSchema.parse({ ok: true, data }) }
