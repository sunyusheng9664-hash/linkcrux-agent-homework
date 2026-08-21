export type KnowledgeRole = 'quality_manager' | 'knowledge_owner'

/** Server-only authorization mapping. Client request data must never determine reviewer authority. */
export function resolveKnowledgeRole(userId: string, configuredOwnerIds = process.env.KNOWLEDGE_OWNER_USER_IDS): KnowledgeRole {
  const owners = new Set((configuredOwnerIds ?? '').split(',').map((id) => id.trim()).filter(Boolean))
  return owners.has(userId) ? 'knowledge_owner' : 'quality_manager'
}
