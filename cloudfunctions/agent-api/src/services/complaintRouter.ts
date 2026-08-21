import type { CaseFacts } from '../../../../src/contracts/case'
import { routeComplaintScope, type ComplaintScopeDecision } from '../../../../src/domain/scopeRouter'

/** Server-side entrypoint for the fixed complaint routing order. */
export function routeComplaint(input: { content: string; facts?: CaseFacts }): ComplaintScopeDecision {
  return routeComplaintScope(input)
}
