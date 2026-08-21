import type { CaseFacts, RiskSignal } from '../contracts/case'

type RiskRule = Omit<RiskSignal, 'evidence' | 'requiresHuman'> & { patterns: RegExp[] }

const HARD_RISK_RULES: RiskRule[] = [
  {
    code: 'SAFETY',
    label: '安全、人员伤害或召回风险',
    patterns: [
      /人身伤害|人员(?:受伤|伤害)|伤人|伤及|受伤|制动(?:失灵|失效|故障)|防护(?:失效|损坏|故障)|安全(?:事故|隐患|风险)|召回/u,
    ],
  },
  {
    code: 'COMPLIANCE',
    label: '合规风险',
    patterns: [/合规(?:风险|问题|不符|失效)|违法|违规|监管(?:处罚|风险)|认证(?:失效|不符)/u],
  },
  {
    code: 'LINE_STOPPAGE',
    label: '重大停线风险',
    patterns: [/(?:产线|生产线|客户)?(?:停线|停产|停摆|停机)|停线|停产|停摆|停机/u],
  },
  {
    code: 'BATCH_FAILURE',
    label: '批量失效风险',
    patterns: [
      /(?:批量|大批量|整批|全数)(?:失效|不良|报废|异常)|多批(?:次)?(?:异常|不良|失效|报废)|同批(?:次)?\s*\d+\s*件(?:均|全部).{0,6}(?:异常|不良|失效|裂纹)|\d+\s*件(?:均|全部).{0,6}(?:异常|不良|失效|裂纹)/u,
    ],
  },
]

function isExplicitlyNegated(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 8), matchIndex)

  return /(?:未|无|尚未|避免|没有|并未|未曾)(?:发生|出现|造成|导致|产生|引发|发现)?\s*$|(?:无需|不是|已排除)\s*$/u.test(prefix)
}

function findPositiveMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const matcher = new RegExp(pattern.source, flags)
    let match: RegExpExecArray | null

    while ((match = matcher.exec(text)) !== null) {
      if (!isExplicitlyNegated(text, match.index)) {
        return true
      }

      if (match[0].length === 0) {
        matcher.lastIndex += 1
      }
    }

    return false
  })
}

export function evaluateHardRisk(facts: Partial<CaseFacts>, complaintText?: string): RiskSignal[] {
  const evidenceSources = [complaintText, ...Object.values(facts)]
    .filter((source): source is string => Boolean(source?.trim()))
    .map((source) => source.trim())

  if (evidenceSources.length === 0) {
    return []
  }

  return HARD_RISK_RULES.flatMap((rule) => {
    const evidence = evidenceSources.find((source) => findPositiveMatch(source, rule.patterns))

    return evidence
      ? [
          {
            code: rule.code,
            label: rule.label,
            evidence,
            requiresHuman: true,
          },
        ]
      : []
  })
}
