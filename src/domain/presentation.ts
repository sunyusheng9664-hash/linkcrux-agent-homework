import type { CaseFactField, CaseRecord, CaseStatus, InitialPackStatus, ManagerDecision } from '../contracts/case'
import type { KnowledgeVisibility } from '../contracts/knowledge'

export const CASE_FLOW_STEPS = ['受理', 'Agent 分析', '人工判断', '首次处理包'] as const

/** 新建客诉向导的步骤文案（QCA-005：1.录入 → 2.Agent 分析 → 3.人工判断 → 4.首次处理包）。 */
export const CASE_ENTRY_STEPS = ['录入', 'Agent 分析', '人工判断', '首次处理包'] as const

const FACT_LABELS: Record<CaseFactField, string> = {
  customer: '客户',
  product: '产品',
  batch: '批次',
  defect: '缺陷',
  quantity: '受影响数量',
  impact: '影响',
  request: '客户诉求',
}

const SEVERITY_LABELS: Record<ManagerDecision['severity'], string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

const VISIBILITY_LABELS: Record<KnowledgeVisibility, string> = {
  quality_team: '质量团队',
  quality_manager: '质量经理',
  knowledge_owner: '知识负责人',
}

export function factLabel(field: CaseFactField): string {
  return FACT_LABELS[field]
}

export function severityLabel(severity: ManagerDecision['severity']): string {
  return SEVERITY_LABELS[severity]
}

export function visibilityLabel(visibility: KnowledgeVisibility): string {
  return VISIBILITY_LABELS[visibility]
}

/** 稳定的短案件号，用于业务侧区分案件；完整 UUID 只在详情中出现。 */
export function formatCaseNumber(id: string): string {
  let hash = 7
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `KS-${String(hash % 100000).padStart(5, '0')}`
}

export type StatusTone = 'neutral' | 'warning' | 'info' | 'success' | 'danger'

export function caseStatusMeta(record: CaseRecord): { label: string; tone: StatusTone } {
  if (record.initialPackStatus === 'generating') return { label: '首次处理包生成中', tone: 'info' }
  if (record.initialPackStatus === 'manual_handoff') return { label: '首次处理包需人工接管', tone: 'danger' }
  const labels: Record<CaseStatus, { label: string; tone: StatusTone }> = {
    intake: { label: '待受理', tone: 'neutral' },
    analyzed: { label: '待质量经理判断', tone: 'warning' },
    confirmed: { label: '待生成首次处理包', tone: 'info' },
    initial_pack: { label: '首次处理包已生成', tone: 'success' },
  }
  return labels[record.status]
}

/** 返回已完成的流程步数（0-4），用于进度条展示。 */
export function caseProgressCompleted(record: CaseRecord): number {
  if (record.status === 'initial_pack' && record.initialPackStatus === 'generated') return 4
  if (record.status === 'confirmed') return 3
  if (record.status === 'analyzed') return 2
  if (record.status === 'intake') return 0
  return 0
}

export function confidenceLevel(confidence: number): { key: 'high' | 'medium' | 'low'; label: string } {
  if (confidence >= 0.85) return { key: 'high', label: '高' }
  if (confidence >= 0.6) return { key: 'medium', label: '中' }
  return { key: 'low', label: '低' }
}

export type TimelineMilestone = '24h' | '14d' | '30d'

export const TIMELINE_MILESTONE_LABELS: Record<TimelineMilestone, string> = {
  '24h': '24 小时',
  '14d': '14 天',
  '30d': '30 天',
}

export function milestoneDeadline(createdAt: string, milestone: TimelineMilestone): Date {
  const base = new Date(createdAt)
  const fallback = Number.isNaN(base.getTime()) ? Date.now() : base.getTime()
  const offset = milestone === '24h' ? 24 * 60 * 60 * 1000 : milestone === '14d' ? 14 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
  return new Date(fallback + offset)
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

export function timelineStatus(deadline: Date, now: Date): { overdue: boolean; label: string } {
  const remaining = deadline.getTime() - now.getTime()
  if (remaining <= 0) return { overdue: true, label: '已超期' }
  return { overdue: false, label: `剩余 ${formatDuration(remaining)}` }
}

export type InitialPackStatusKey = NonNullable<InitialPackStatus>

export function initialPackStatusLabel(status: InitialPackStatusKey): string {
  const labels: Record<InitialPackStatusKey, string> = {
    generating: '生成中',
    generated: '已生成',
    manual_handoff: '需人工接管',
  }
  return labels[status]
}
