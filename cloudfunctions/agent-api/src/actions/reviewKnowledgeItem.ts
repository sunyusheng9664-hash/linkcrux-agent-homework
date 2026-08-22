import { z } from 'zod'

import { KnowledgeRepository } from '../repositories/knowledgeRepository'

const ReviewStatusSchema = z.enum(['published', 'rejected'])
const ReviewInputSchema = z.object({ status: ReviewStatusSchema, reason: z.string().trim().min(1).optional() }).strict()
const ReviewerRoleSchema = z.enum(['quality_manager', 'knowledge_owner'])

export async function reviewKnowledgeItem(
  deps: { repository: KnowledgeRepository },
  itemId: string,
  input: z.input<typeof ReviewInputSchema>,
  reviewer: { userId: string; role: z.input<typeof ReviewerRoleSchema> },
) {
  if (reviewer.role !== 'knowledge_owner') throw new Error('FORBIDDEN')
  const parsed = ReviewInputSchema.parse(input)
  if (parsed.status === 'rejected' && !parsed.reason) throw new Error('REJECTION_REASON_REQUIRED')
  return deps.repository.reviewItem(itemId, reviewer.userId, parsed.status, parsed.reason)
}
