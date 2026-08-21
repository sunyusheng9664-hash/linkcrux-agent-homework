import type { CaseFacts } from '../contracts/case'

export function calculateCompleteness(facts: Partial<CaseFacts>): number {
  const required: (keyof CaseFacts)[] = ['customer', 'product', 'batch', 'defect', 'impact']
  const completed = required.filter((key) => Boolean(facts[key]?.trim())).length

  return Math.round((completed / required.length) * 100)
}
