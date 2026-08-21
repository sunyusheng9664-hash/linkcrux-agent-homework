import { describe, expect, it } from 'vitest'

import { resolveKnowledgeRole } from '../src/services/knowledgeAuthorization'

describe('resolveKnowledgeRole', () => {
  it('grants knowledge owner only to a server-configured identity', () => {
    expect(resolveKnowledgeRole('owner-1', 'owner-1, owner-2')).toBe('knowledge_owner')
    expect(resolveKnowledgeRole('quality-manager-1', 'owner-1, owner-2')).toBe('quality_manager')
    expect(resolveKnowledgeRole('owner-1', undefined)).toBe('quality_manager')
  })
})
