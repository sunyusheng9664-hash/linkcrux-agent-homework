import { z } from 'zod'

export const SupportedKnowledgeMimeTypeSchema = z.enum(['application/pdf', 'text/plain', 'text/markdown'])
export const KnowledgeSourceTypeSchema = z.enum(['enterprise_document', 'public_methodology', 'historical_case', 'interaction_learning'])
export const DocumentStatusSchema = z.enum(['uploaded', 'parsed', 'failed', 'superseded', 'expired'])
export const KnowledgeItemStatusSchema = z.enum(['draft', 'pending_review', 'published', 'expired', 'rejected', 'impacted'])
export const KnowledgeVisibilitySchema = z.enum(['quality_team', 'quality_manager', 'knowledge_owner'])
export const KnowledgeConfidentialitySchema = z.enum(['internal', 'confidential'])

export const KnowledgeScopeSchema = z.object({
  factories: z.array(z.string().trim().min(1)).max(20).optional(),
  customers: z.array(z.string().trim().min(1)).max(50).optional(),
  products: z.array(z.string().trim().min(1)).max(100).optional(),
  processes: z.array(z.string().trim().min(1)).max(100).optional(),
}).strict()

export const DocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  mimeType: SupportedKnowledgeMimeTypeSchema,
  sourceType: KnowledgeSourceTypeSchema,
  originalFileId: z.string().min(1),
  version: z.string().trim().min(1),
  status: DocumentStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()

export const KnowledgeChunkSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  sequence: z.number().int().positive(),
  text: z.string().trim().min(1).max(800),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().positive(),
  heading: z.string().trim().min(1).optional(),
  page: z.number().int().positive().optional(),
}).strict().superRefine((chunk, context) => {
  if (chunk.charEnd <= chunk.charStart) {
    context.addIssue({ code: 'custom', path: ['charEnd'], message: '分段结束位置必须大于起始位置' })
  }
})

const QaContentSchema = z.object({ question: z.string().trim().min(1), answer: z.string().trim().min(1) }).strict()
const ProcedureContentSchema = z.object({ steps: z.array(z.string().trim().min(1)).min(1) }).strict()
const RuleContentSchema = z.object({ when: z.string().trim().min(1), then: z.string().trim().min(1) }).strict()
const NavigationContentSchema = z.object({ system: z.string().trim().min(1), path: z.array(z.string().trim().min(1)).min(1) }).strict()
const ScriptContentSchema = z.object({ scenario: z.string().trim().min(1), script: z.string().trim().min(1) }).strict()
const CaseContentSchema = z.object({ summary: z.string().trim().min(1), lessons: z.array(z.string().trim().min(1)).min(1) }).strict()

const KnowledgeItemBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  sourceDocumentId: z.string().min(1),
  sourceChunkIds: z.array(z.string().min(1)).min(1),
  owner: z.string().trim().min(1),
  scope: KnowledgeScopeSchema,
  visibility: KnowledgeVisibilitySchema,
  status: KnowledgeItemStatusSchema,
  reviewedBy: z.string().min(1).optional(),
  reviewedAt: z.string().datetime().optional(),
  rejectionReason: z.string().trim().min(1).optional(),
  confidentiality: KnowledgeConfidentialitySchema.optional(),
  effectiveAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()

export const KnowledgeItemSchema = z.discriminatedUnion('type', [
  KnowledgeItemBaseSchema.extend({ type: z.literal('qa'), content: QaContentSchema }),
  KnowledgeItemBaseSchema.extend({ type: z.literal('procedure'), content: ProcedureContentSchema }),
  KnowledgeItemBaseSchema.extend({ type: z.literal('rule'), content: RuleContentSchema }),
  KnowledgeItemBaseSchema.extend({ type: z.literal('navigation'), content: NavigationContentSchema }),
  KnowledgeItemBaseSchema.extend({ type: z.literal('script'), content: ScriptContentSchema }),
  KnowledgeItemBaseSchema.extend({ type: z.literal('case'), content: CaseContentSchema }),
]).superRefine((item, context) => {
  if (item.status === 'published' && (!item.reviewedBy || !item.reviewedAt)) {
    context.addIssue({ code: 'custom', path: ['reviewedBy'], message: '发布知识必须记录人工审核人和时间' })
  }
  if (item.expiresAt && Date.parse(item.expiresAt) <= Date.parse(item.effectiveAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: '失效时间必须晚于生效时间' })
  }
})

export type Document = z.infer<typeof DocumentSchema>
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>
export type KnowledgeVisibility = z.infer<typeof KnowledgeVisibilitySchema>
export type KnowledgeConfidentiality = z.infer<typeof KnowledgeConfidentialitySchema>
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>
