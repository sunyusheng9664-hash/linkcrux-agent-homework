import {
  CaseRecordSchema,
  ComplaintInputSchema,
  ManagerDecisionSchema,
  managerSeverityBaseline,
  type CaseRecord,
  type InitialPack,
  type ManagerDecision,
} from '../contracts/case'
import { LOCAL_DEMO_COMPLAINT_CONTENT } from '../demo/mainComplaint'
import type { AgentApi } from './agentApi'
import type { AttachmentUpload, AuthService } from './cloudbase'

const SESSION_KEY = 'quality-complaint-agent:local-demo-session'
const CASE_KEY = 'quality-complaint-agent:local-demo-case'
const DEMO_USER_ID = 'local-demo-linghe'

export type LocalDemoServices = {
  auth: AuthService
  api: AgentApi
  uploadAttachment: AttachmentUpload
}

export function createLocalDemoServices(storage: Storage = window.localStorage): LocalDemoServices {
  // 演示时间以本次进入为准，避免固定日期导致时间线全部显示已超期。
  const startedAt = Date.now()
  const demoTime = (offsetMs: number): string => new Date(startedAt + offsetMs).toISOString()
  const auth: AuthService = {
    async signIn(username, password) {
      if (username !== 'linghe' || password !== 'shuzhi') throw new Error('LOCAL_DEMO_LOGIN_FAILED')
      storage.setItem(SESSION_KEY, DEMO_USER_ID)
    },
    async isSignedIn() {
      return storage.getItem(SESSION_KEY) === DEMO_USER_ID
    },
    async getCurrentUserId() {
      return storage.getItem(SESSION_KEY) === DEMO_USER_ID ? DEMO_USER_ID : undefined
    },
  }

  const api: AgentApi = {
    async createCase(rawInput) {
      const input = ComplaintInputSchema.parse(rawInput)
      if (input.content !== LOCAL_DEMO_COMPLAINT_CONTENT || input.attachments.length > 0) {
        throw new Error('LOCAL_DEMO_PRESET_ONLY')
      }
      const record = CaseRecordSchema.parse({
        id: 'demo-case-main',
        content: input.content,
        attachments: [],
        status: 'intake',
        createdBy: DEMO_USER_ID,
        createdAt: demoTime(0),
        updatedAt: demoTime(0),
        version: 1,
      })
      saveCase(storage, record)
      return record
    },
    async listCases() {
      const record = readCase(storage)
      return record ? [record] : []
    },
    async getCase(id) {
      return requireCase(storage, id)
    },
    async analyzeCase(id) {
      const record = requireCase(storage, id)
      if (record.status !== 'intake' && record.status !== 'analyzed') throw new Error('INVALID_CASE_STATE')
      if (record.analysis) return record
      const analyzed = CaseRecordSchema.parse({
        ...record,
        status: 'analyzed',
        updatedAt: demoTime(5_000),
        version: record.version + 1,
        analysisStatus: 'ai_completed',
        analysis: {
          facts: {
            customer: '华东精工',
            product: 'BR-2045',
            batch: 'A240819',
            defect: '尺寸超差',
            impact: '装配线停线 4 小时',
            request: '立即说明临时遏制措施',
          },
          missingFields: ['quantity'],
          informationCompleteness: 100,
          riskSuggestion: [{
            code: 'LINE_STOPPAGE',
            label: '重大停线风险',
            evidence: '装配线停线 4 小时',
            requiresHuman: true,
          }],
          departmentSuggestion: ['质量部', '生产部', '客户质量团队'],
          slaSuggestion: '24 小时内同步 D1-D3 初版与后续计划',
          start8dSuggestion: true,
          confidence: 0.92,
          evidenceSpans: [
            { field: 'customer', text: '华东精工' },
            { field: 'batch', text: '批次 A240819' },
            { field: 'impact', text: '装配线停线 4 小时' },
          ],
          routing: { highRisk: true, requiresHuman: true },
          analysisStatus: 'ai_completed',
        },
      })
      saveCase(storage, analyzed)
      return analyzed
    },
    async confirmCase({ id, ...rawDecision }) {
      const record = requireCase(storage, id)
      if (record.status !== 'analyzed' || !record.analysis) throw new Error('INVALID_CASE_STATE')
      const decision = ManagerDecisionSchema.parse(rawDecision)
      if (decision.outcome === 'accepted' && (
        decision.severity !== managerSeverityBaseline(record.analysis.routing.requiresHuman)
        || decision.start8d !== record.analysis.start8dSuggestion
      )) throw new Error('MANAGER_DECISION_MISMATCH')
      const confirmed = CaseRecordSchema.parse({
        ...record,
        status: 'confirmed',
        managerDecision: decision,
        updatedAt: demoTime(60_000),
        version: record.version + 1,
      })
      saveCase(storage, confirmed)
      return confirmed
    },
    async generateInitialPack(id) {
      const record = requireCase(storage, id)
      if (record.initialPack) return record
      if (record.status !== 'confirmed' || !record.managerDecision) throw new Error('INVALID_CASE_STATE')
      const generated = CaseRecordSchema.parse({
        ...record,
        status: 'initial_pack',
        initialPackStatus: 'generated',
        initialPack: createDemoInitialPack(record.managerDecision, demoTime),
        updatedAt: demoTime(65_000),
        version: record.version + 1,
      })
      saveCase(storage, generated)
      return generated
    },
    async ingestKnowledge() { throw new Error('LOCAL_DEMO_KNOWLEDGE_UNSUPPORTED') },
    async listPendingKnowledge() { throw new Error('LOCAL_DEMO_KNOWLEDGE_UNSUPPORTED') },
    async reviewKnowledge() { throw new Error('LOCAL_DEMO_KNOWLEDGE_UNSUPPORTED') },
    async getKnowledgeCitation() { throw new Error('LOCAL_DEMO_KNOWLEDGE_UNSUPPORTED') },
    async listHandoffs() { return [] },
    async answerKnowledge({ query, caseId }) {
      if (query.trim() === '尺寸超差后如何临时遏制？') return {
        decision: 'answer' as const,
        answer: 'Demo 模拟知识回答：建议隔离待核批次库存并暂停关联批次发运；该建议仍需质量经理确认执行。',
        citations: [{ itemId: 'demo-knowledge-1', documentId: 'demo-sop-1', documentName: 'Demo 来料异常 SOP', version: 'v1', chunkIds: ['demo-chunk-1'] }],
        missingInformation: ['受影响数量'],
      }
      return {
        decision: 'handoff' as const, answer: null, citations: [], missingInformation: [], reason: 'KNOWLEDGE_NOT_COVERED' as const,
        handoff: {
          id: 'demo-handoff-knowledge', caseId: caseId ?? 'demo-case-main', source: 'knowledge' as const, confirmedFacts: {}, missingFields: ['batch', 'quantity'], riskSignals: [], searchedKnowledge: [], reason: 'KNOWLEDGE_NOT_COVERED' as const,
          suggestedTeam: '质量经理人工接管', sla: '4 个工作小时内人工响应', transitionReply: 'Demo 模拟：已转交质量经理人工处理。', createdAt: demoTime(0),
        },
      }
    },
  }

  const uploadAttachment: AttachmentUpload = async () => {
    throw new Error('LOCAL_DEMO_ATTACHMENTS_UNSUPPORTED')
  }

  return { auth, api, uploadAttachment }
}

function createDemoInitialPack(decision: ManagerDecision, demoTime: (offsetMs: number) => string): InitialPack {
  const severityLabel = { low: '低', medium: '中', high: '高', critical: '严重' }[decision.severity]
  return {
    customerReply: 'Demo 模拟草案：已收到本次客诉。当前仅确认批次、尺寸超差与停线描述；根因、责任、召回及补偿均待调查和人工批准。',
    internalTicket: `Demo 模拟工单：案件 demo-case-main；质量经理已将严重度调整为${severityLabel}，需补充受影响数量并核验现场证据。`,
    d1: 'Demo 模拟计划：由质量经理牵头，协调生产、工程与客户质量团队参加初步响应。',
    d2: 'Demo 模拟已知信息：华东精工反馈 BR-2045 批次 A240819 尺寸超差并描述停线 4 小时；受影响数量待核实。',
    d3: {
      containmentActions: [
        {
          suggestedAction: '建议隔离待核批次库存并暂停关联批次发运',
          owner: '质量经理',
          dueAt: demoTime(8 * 60 * 60 * 1000),
          executionStatus: 'suggested',
          evidence: [],
        },
        {
          suggestedAction: '建议保全客诉样品、测量记录与现场照片',
          owner: '客户质量工程师',
          dueAt: demoTime(24 * 60 * 60 * 1000),
          executionStatus: 'suggested',
          evidence: [],
        },
      ],
    },
    timeline24h14d30d: [
      { milestone: '24h', delivery: '同步客户首响、D1-D3 初版及缺失信息清单' },
      { milestone: '14d', delivery: '同步 D4-D6 调查、措施选择与验证计划进展' },
      { milestone: '30d', delivery: '同步 D7-D8 预防复发与结案评审计划进展' },
    ],
    d4ToD8Plan: [
      { phase: 'D4', plan: '计划收集测量、过程和批次证据，验证可能原因。' },
      { phase: 'D5', plan: '计划基于证据评估永久纠正措施选项。' },
      { phase: 'D6', plan: '计划在人工批准后验证纠正措施效果。' },
      { phase: 'D7', plan: '计划评估标准、培训与防错机制以预防复发。' },
      { phase: 'D8', plan: '计划在证据齐备后组织结案评审并同步客户。' },
    ],
  }
}

function readCase(storage: Storage): CaseRecord | undefined {
  const value = storage.getItem(CASE_KEY)
  return value ? CaseRecordSchema.parse(JSON.parse(value)) : undefined
}

function requireCase(storage: Storage, id: string): CaseRecord {
  const record = readCase(storage)
  if (!record || record.id !== id) throw new Error('CASE_NOT_FOUND')
  return record
}

function saveCase(storage: Storage, record: CaseRecord): void {
  storage.setItem(CASE_KEY, JSON.stringify(record))
}
