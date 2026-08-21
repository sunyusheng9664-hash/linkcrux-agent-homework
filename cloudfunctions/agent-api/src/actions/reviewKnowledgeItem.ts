import { z } from 'zod'

import { KnowledgeRepository } from '../repositories/knowledgeRepository'

const ReviewStatusSchema = z.enum(['published', 'rejected'])
const ReviewerRoleSchema = z.enum(['quality_manager', 'knowledge_owner'])

export async function reviewKnowledgeItem(
  deps: { repository: KnowledgeRepository },
  itemId: string,
  input: { status: z.input<typeof ReviewStatusSchema> },
  reviewer: { userId: string; role: z.input<typeof ReviewerRoleSchema> },
) {
  if (reviewer.role !== 'knowledge_owner') throw new Error('FORBIDDEN')
  return deps.repository.reviewItem(itemId, reviewer.userId, ReviewStatusSchema.parse(input.status))
}
