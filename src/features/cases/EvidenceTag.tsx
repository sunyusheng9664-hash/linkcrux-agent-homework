import type { ReactNode } from 'react'

const LABELS = {
  statement: '客户陈述（待核实）',
  extracted: 'AI 抽取',
  suggested: 'AI 建议',
  missing: '缺失信息',
  confirmed: '人工确认',
} as const

export function EvidenceTag({ kind, children }: { kind: keyof typeof LABELS; children?: ReactNode }) {
  return <span className={`evidence-tag evidence-tag--${kind}`}>{children ?? LABELS[kind]}</span>
}
