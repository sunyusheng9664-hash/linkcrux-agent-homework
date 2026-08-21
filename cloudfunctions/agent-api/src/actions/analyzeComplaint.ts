import { z } from 'zod'
import {
  CaseAnalysisSchema,
  ComplaintInputSchema,
  type CaseAnalysis,
  type CaseFacts,
  type RiskSignal,
} from '../../../../src/contracts/case'
import { calculateCompleteness } from '../../../../src/domain/completeness'
import { evaluateHardRisk } from '../../../../src/domain/risk'
import { buildAnalyzeComplaintMessages } from '../prompts/analyzeComplaint'
import type { ModelClient } from '../services/modelClient'

export type AnalyzeComplaintDependencies = {
  createModelClient: () => Pick<ModelClient, 'generateStructured'>
}

export async function analyzeComplaint(
  deps: AnalyzeComplaintDependencies,
  input: z.input<typeof ComplaintInputSchema>,
): Promise<CaseAnalysis> {
  const validatedInput = ComplaintInputSchema.parse(input)
  const inputHardRisks = evaluateHardRisk(validatedInput.facts ?? {}, validatedInput.content)

  try {
    const modelAnalysis = await deps.createModelClient().generateStructured(
      CaseAnalysisSchema,
      buildAnalyzeComplaintMessages(validatedInput),
    )
    const sources = evidenceSources(validatedInput)
    const facts = { ...verifiedModelFacts(modelAnalysis.facts, sources), ...validatedInput.facts }
    const hardRisks = mergeRiskSuggestions(
      inputHardRisks,
      evaluateHardRisk(facts, validatedInput.content),
    )
    const riskSuggestion = mergeRiskSuggestions(
      verifiedRiskSuggestions(modelAnalysis.riskSuggestion, sources),
      hardRisks,
    )
    const highRisk = modelAnalysis.routing.highRisk || riskSuggestion.length > 0

    return CaseAnalysisSchema.parse({
      ...modelAnalysis,
      facts,
      missingFields: missingFieldsFor(facts),
      informationCompleteness: calculateCompleteness(facts),
      riskSuggestion,
      evidenceSpans: modelAnalysis.evidenceSpans.filter((span) => isInSources(span.text, sources)),
      routing: {
        highRisk,
        requiresHuman: modelAnalysis.routing.requiresHuman || highRisk,
      },
      analysisStatus: 'ai_completed',
      analysisFailureReason: undefined,
    })
  } catch (error) {
    if (inputHardRisks.length === 0) {
      throw error
    }

    return manualTakeoverAnalysis(validatedInput.facts ?? {}, inputHardRisks, error)
  }
}

function manualTakeoverAnalysis(
  facts: CaseFacts,
  hardRisks: RiskSignal[],
  error: unknown,
): CaseAnalysis {
  return CaseAnalysisSchema.parse({
    facts,
    missingFields: missingFieldsFor(facts),
    informationCompleteness: calculateCompleteness(facts),
    riskSuggestion: hardRisks,
    departmentSuggestion: ['待质量经理确认'],
    slaSuggestion: '待质量经理确认',
    start8dSuggestion: true,
    confidence: 0,
    evidenceSpans: [],
    routing: { highRisk: true, requiresHuman: true },
    analysisStatus: 'manual_takeover',
    analysisFailureReason: modelFailureReason(error),
  })
}

function mergeRiskSuggestions(modelSuggestions: RiskSignal[], hardRisks: RiskSignal[]): RiskSignal[] {
  const signalsByCode = new Map(modelSuggestions.map((signal) => [signal.code, signal]))

  for (const hardRisk of hardRisks) {
    signalsByCode.set(hardRisk.code, hardRisk)
  }

  return [...signalsByCode.values()]
}

function missingFieldsFor(facts: CaseAnalysis['facts']): CaseAnalysis['missingFields'] {
  const fields: CaseAnalysis['missingFields'] = [
    'customer',
    'product',
    'batch',
    'defect',
    'quantity',
    'impact',
    'request',
  ]

  return fields.filter((field) => !facts[field]?.trim())
}

function evidenceSources(input: z.output<typeof ComplaintInputSchema>): string[] {
  return [input.content, ...Object.values(input.facts ?? {})].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
}

function verifiedModelFacts(facts: CaseFacts, sources: string[]): CaseFacts {
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => typeof value === 'string' && isInSources(value, sources)),
  )
}

function verifiedRiskSuggestions(suggestions: RiskSignal[], sources: string[]): RiskSignal[] {
  return suggestions.filter((signal) => isInSources(signal.evidence, sources))
}

function isInSources(value: string, sources: string[]): boolean {
  return sources.some((source) => source.includes(value))
}

function modelFailureReason(error: unknown): 'MODEL_CONFIG_MISSING' | 'MODEL_REQUEST_FAILED' | 'MODEL_RESPONSE_INVALID' | 'MODEL_SCHEMA_INVALID' | 'MODEL_UNAVAILABLE' {
  const message = error instanceof Error ? error.message : ''

  if (message === 'MODEL_CONFIG_MISSING' || message === 'MODEL_REQUEST_FAILED' || message === 'MODEL_RESPONSE_INVALID' || message === 'MODEL_SCHEMA_INVALID') {
    return message
  }

  return 'MODEL_UNAVAILABLE'
}
