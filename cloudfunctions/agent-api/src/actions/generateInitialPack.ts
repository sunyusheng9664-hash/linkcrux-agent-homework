import {
  InitialPackD3ProposalSchema,
  InitialPackSchema,
  type CaseAnalysis,
  type CaseFacts,
  type InitialPack,
  type InitialPackD3,
  type InitialPackD3Proposal,
  type ManagerDecision,
} from '../../../../src/contracts/case'
import { buildGenerateInitialPackMessages } from '../prompts/generateInitialPack'
import type { ModelClient } from '../services/modelClient'

export type InitialPackSource = {
  caseId: string
  content: string
  facts?: CaseFacts
  analysis: CaseAnalysis
  managerDecision: ManagerDecision
}

export type GenerateInitialPackDependencies = {
  createModelClient: () => Pick<ModelClient, 'generateStructured'>
}

const ACTION_LABELS: Record<InitialPackD3Proposal['proposals'][number]['actionType'], string> = {
  isolate: '隔离并标识待核对象',
  hold_shipment: '暂停待核范围出库',
  inspect: '对待核范围安排检查',
  preserve_evidence: '保全相关证据',
  notify_quality: '通知相关质量响应角色',
}
const TARGET_LABELS: Record<InitialPackD3Proposal['proposals'][number]['targetScope'], string> = {
  suspected_inventory: '疑似受影响库存',
  related_shipments: '相关待核出货',
  affected_process: '相关待核过程',
  complaint_evidence: '本案投诉证据',
}
type ProposalItem = InitialPackD3Proposal['proposals'][number]
const OWNER_BY_ACTION_TARGET: Record<ProposalItem['actionType'], Partial<Record<ProposalItem['targetScope'], string>>> = {
  isolate: { suspected_inventory: '仓储负责人', affected_process: '生产负责人' },
  hold_shipment: { suspected_inventory: '仓储负责人', related_shipments: '仓储负责人' },
  inspect: { suspected_inventory: '质量经理', related_shipments: '质量经理', affected_process: '质量经理' },
  preserve_evidence: { complaint_evidence: '质量经理' },
  notify_quality: { complaint_evidence: '客服负责人', affected_process: '生产负责人' },
}
const UNSAFE_CASE_FACT = /(?:\+?\d[\d -]{6,}\d)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|微信|wechat|根因(?:已|为|是)|承担责任|召回|赔偿|补偿|已完成|已落实|均已采取/i

export async function generateInitialPack(
  deps: GenerateInitialPackDependencies,
  source: InitialPackSource,
): Promise<InitialPack> {
  let generated: unknown
  try {
    generated = await deps.createModelClient().generateStructured(
      InitialPackD3ProposalSchema,
      buildGenerateInitialPackMessages(source),
    )
  } catch {
    throw new Error('INITIAL_PACK_MODEL_FAILED')
  }

  const parsed = InitialPackD3ProposalSchema.safeParse(generated)
  if (!parsed.success) throw new Error('INITIAL_PACK_MODEL_FAILED')

  const assembled = InitialPackSchema.safeParse(assembleInitialPack(source, renderD3(parsed.data)))
  if (!assembled.success) throw new Error('INITIAL_PACK_ASSEMBLY_FAILED')
  return assembled.data
}

function renderD3(proposal: InitialPackD3Proposal): InitialPackD3 {
  return {
    containmentActions: proposal.proposals.map((item) => ({
      suggestedAction: `建议${ACTION_LABELS[item.actionType]}；适用范围：${TARGET_LABELS[item.targetScope]}`,
      owner: OWNER_BY_ACTION_TARGET[item.actionType][item.targetScope]!,
      dueAt: `建议在 ${item.dueWithinHours} 小时内完成`,
      executionStatus: 'suggested',
      evidence: [],
    })),
  }
}

function assembleInitialPack(source: InitialPackSource, d3: InitialPackD3): InitialPack {
  const facts = { ...source.analysis.facts, ...source.facts }
  const displayFact = (field: keyof CaseFacts) => {
    const caseInput = source.facts?.[field]?.trim()
    const extracted = source.analysis.facts[field]?.trim()
    const value = caseInput || extracted
    if (!value) return '待确认'
    if (UNSAFE_CASE_FACT.test(value)) return '待人工查看'
    return `[${caseInput ? '案件输入' : 'AI抽取'}·待验证] ${value.slice(0, 80)}`
  }
  return {
    customerReply: '已收到质量投诉。我们将在 24 小时内同步首次核实进展；当前根因、责任、召回与赔偿均尚未确认，相关结论须经人工审核。',
    internalTicket: `案件 ${source.caseId} 已由质量经理确认进入首次处理；严重度：${source.managerDecision.severity}；8D：${source.managerDecision.start8d ? '启动' : '暂不启动'}。请补齐缺失事实并保留证据。`,
    d1: '计划由质量经理牵头，协调质量、生产与客服人员开展首次响应；成员与职责需人工确认。',
    d2: `当前案件记录（待质量经理逐项核实）：产品：${displayFact('product')}；批次：${displayFact('batch')}；缺陷：${displayFact('defect')}；数量：${displayFact('quantity')}；影响：${displayFact('impact')}。客户及诉求联系信息不进入处理包；未列字段及影响范围待人工核实。`,
    d3,
    timeline24h14d30d: [
      { milestone: '24h', delivery: '首次响应及 D1–D3 建议更新' },
      { milestone: '14d', delivery: 'D4–D6 调查与验证计划更新' },
      { milestone: '30d', delivery: 'D7–D8 预防与闭环计划更新' },
    ],
    d4ToD8Plan: [
      { phase: 'D4', plan: '计划收集证据并验证可能原因，原因仍待人工核实。' },
      { phase: 'D5', plan: '计划评估纠正措施选项，责任与处置范围仍待人工核实。' },
      { phase: 'D6', plan: '计划在人工批准后验证候选措施效果。' },
      { phase: 'D7', plan: '计划评估预防复发机制及适用范围。' },
      { phase: 'D8', plan: '计划在证据齐备后组织结案评审，赔偿事项尚未确认。' },
    ],
  }
}
