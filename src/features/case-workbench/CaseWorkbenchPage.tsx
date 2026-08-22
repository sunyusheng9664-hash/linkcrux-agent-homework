import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import type { CaseRecord } from '../../contracts/case'
import type { AdvanceCaseInput } from '../../contracts/workflow'
import type { AgentApi } from '../../services/agentApi'
import { closeGateFromCase, evaluateCloseGate } from '../../domain/closeGate'
import { effectiveWorkflowStage, getAllowedTransitions, WORKFLOW_STAGE_LABELS } from '../../domain/workflow'
import { caseStatusMeta, formatCaseNumber, formatDateTime, milestoneDeadline, severityLabel, timelineStatus } from '../../domain/presentation'
import { EightDInitialView } from '../initial-pack/EightDInitialView'
import { CollaborationLog } from './CollaborationLog'
import { CustomerView } from './CustomerView'
import { WorkflowTimeline } from './WorkflowTimeline'
import '../../styles/case-workbench.css'

/** 仅“首次处理包生成之后”的节点可在案件处理台里用 advanceCase 推进；此前阶段由新建/分析/确认/生成处理包流程完成。 */
const ADVANCEABLE_STAGES = new Set<string>(['containment', 'root_cause', 'corrective', 'customer_confirm'])

export function CaseWorkbenchPage({ api }: { api: Pick<AgentApi, 'getCase' | 'advanceCase' | 'closeCase' | 'generateKnowledgeCard'> }) {
  const { id } = useParams<{ id: string }>()
  const [record, setRecord] = useState<CaseRecord>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [rootCause, setRootCause] = useState('')
  const [containmentEvidence, setContainmentEvidence] = useState('')
  const [correctiveAction, setCorrectiveAction] = useState('')
  const [correctiveVerification, setCorrectiveVerification] = useState('')
  const [customerAccepted, setCustomerAccepted] = useState(false)
  const [customerFeedback, setCustomerFeedback] = useState('')

  async function refresh() {
    if (!id) return
    setRecord(await api.getCase(id))
  }

  useEffect(() => {
    setError('')
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [id])

  if (!record) {
    return (
      <main className="page">
        <p>{error || '正在加载案件…'}</p>
      </main>
    )
  }

  const currentStage = effectiveWorkflowStage(record)
  const next = getAllowedTransitions(currentStage)[0]
  const closed = currentStage === 'closed'
  const closeReady = currentStage === 'customer_confirm'
  const gate = closeReady ? evaluateCloseGate(closeGateFromCase(record)) : undefined
  const status = caseStatusMeta(record)

  const severity = record.managerDecision ? severityLabel(record.managerDecision.severity) : '待确认'
  const severityNote = record.analysis?.riskSuggestion[0]?.label ?? (record.facts?.impact ? `影响：${record.facts.impact}` : '待质量经理确认')
  const lead = record.analysis?.departmentSuggestion?.[0] ?? '质量经理'
  const deadline24 = milestoneDeadline(record.createdAt, '24h')
  const deadlineStatus = timelineStatus(deadline24, new Date())
  const riskChips = record.analysis?.riskSuggestion ?? []

  function buildAdvanceInput(): AdvanceCaseInput {
    if (!next) throw new Error('WORKFLOW_ALREADY_CLOSED')
    const input: AdvanceCaseInput = { stage: next }
    if (next === 'root_cause') {
      input.rootCause = rootCause
    } else if (next === 'containment') {
      input.containmentEvidence = containmentEvidence.split(/\n+/).map((item) => item.trim()).filter(Boolean)
    } else if (next === 'corrective') {
      input.correctiveAction = correctiveAction
      input.correctiveVerification = correctiveVerification
    } else if (next === 'customer_confirm') {
      input.customerAccepted = customerAccepted
      if (customerFeedback.trim()) input.customerFeedback = customerFeedback.trim()
    }
    return input
  }

  async function advance() {
    if (!id) return
    setBusy(true)
    setError('')
    try {
      setRecord(await api.advanceCase(id, buildAdvanceInput()))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function close() {
    if (!id) return
    setBusy(true)
    setError('')
    try {
      setRecord(await api.closeCase(id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function generateKnowledge() {
    if (!id) return
    setBusy(true)
    setError('')
    try {
      await api.generateKnowledgeCard(id)
      setRecord(await api.getCase(id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page cb-page">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/">工作台</Link>
        <span>/</span>
        <span>案件 {formatCaseNumber(record.id)}</span>
        <span>/</span>
        <span aria-current="page">处理台</span>
      </nav>

      <header className="cb-hero">
        <div className="cb-hero-top">
          <div>
            <h1>案件处理台</h1>
            <p className="cb-hero-sub">{formatCaseNumber(record.id)} · {status.label} · 创建 {formatDateTime(record.createdAt)}</p>
            <div className="cb-chips">
              <span className="cb-chip primary">当前阶段：{WORKFLOW_STAGE_LABELS[currentStage]}</span>
              {record.managerDecision?.start8d && <span className="cb-chip accent">8D 已启动</span>}
              {riskChips.map((risk) => (
                <span className="cb-chip danger" key={risk.code}>{risk.label}</span>
              ))}
            </div>
          </div>

          <div className="cb-metrics">
            <div className="cb-metric">
              <div className="cb-metric-label">严重度</div>
              <div className="cb-metric-value">{severity}</div>
              <div className="cb-metric-note">{severityNote}</div>
            </div>
            <div className="cb-metric">
              <div className="cb-metric-label">牵头负责人</div>
              <div className="cb-metric-value" style={{ fontSize: '22px' }}>{lead}</div>
              <div className="cb-metric-note">需确认执行与外部同步</div>
            </div>
            <div className="cb-metric">
              <div className="cb-metric-label">24 小时节点</div>
              <div className="cb-metric-value" style={{ fontSize: '22px' }}>{deadlineStatus.label}</div>
              <div className="cb-metric-note">截至 {formatDateTime(deadline24)}</div>
            </div>
          </div>
        </div>
      </header>

      {error && <p className="cb-error" role="alert">{error}</p>}

      <section className="cb-section" aria-label="处理操作">
        <div className="cb-section-head">
          <div>
            <h2 className="cb-title">下一步</h2>
            <p className="cb-desc">
              {closed
                ? record.workflow?.knowledgeSedimentation === 'generated'
                  ? '案件已沉淀为知识卡，进入待审核队列。'
                  : '案件已闭环，可将本次案例沉淀为可复用的知识卡。'
                : closeReady
                  ? '客户已接受处理结果后，即可执行关单。'
                  : `把「${next ? WORKFLOW_STAGE_LABELS[next] : '当前节点'}」作为当前唯一聚焦任务。`}
            </p>
          </div>
          {closeReady && <span className={`cb-badge ${gate?.allowed ? 'green' : 'warning'}`}>{gate?.allowed ? '可关单' : '关单条件未满足'}</span>}
        </div>

        <div className="cb-subcard">
          {closed ? (
            record.workflow?.knowledgeSedimentation === 'generated'
              ? <p className="cb-hint">已沉淀为知识卡，进入待审核队列。</p>
              : (
                <div className="cb-btn-row">
                  <button type="button" className="cb-btn cb-btn-primary" disabled={busy} onClick={generateKnowledge}>
                    {busy ? '正在生成…' : '沉淀为知识卡'}
                  </button>
                </div>
              )
          ) : closeReady ? (
            <>
              <div className="cb-btn-row">
                <button type="button" className="cb-btn cb-btn-primary" disabled={!gate?.allowed || busy} onClick={close}>
                  {busy ? '正在关单…' : '关单'}
                </button>
              </div>
              {gate && !gate.allowed && (
                <ul className="cb-close-gate">
                  {gate.missing.map((condition) => (
                    <li key={condition.code}>{condition.label}</li>
                  ))}
                </ul>
              )}
            </>
          ) : next && ADVANCEABLE_STAGES.has(next) ? (
            <>
              {next === 'root_cause' && (
                <label>
                  根因（需质量经理确认）
                  <textarea aria-label="根因" value={rootCause} onChange={(event) => setRootCause(event.target.value)} rows={3} />
                </label>
              )}
              {next === 'containment' && (
                <label>
                  临时遏制措施与证据（每行一条）
                  <textarea aria-label="临时遏制证据" value={containmentEvidence} onChange={(event) => setContainmentEvidence(event.target.value)} rows={3} />
                </label>
              )}
              {next === 'corrective' && (
                <>
                  <label>
                    永久对策
                    <input aria-label="永久对策" value={correctiveAction} onChange={(event) => setCorrectiveAction(event.target.value)} />
                  </label>
                  <label>
                    对策验证结果
                    <input aria-label="对策验证结果" value={correctiveVerification} onChange={(event) => setCorrectiveVerification(event.target.value)} />
                  </label>
                </>
              )}
              {next === 'customer_confirm' && (
                <>
                  <label className="cb-confirm-line">
                    <input type="checkbox" checked={customerAccepted} onChange={(event) => setCustomerAccepted(event.target.checked)} />
                    客户已接受处理结果
                  </label>
                  <label>
                    客户反馈（可选）
                    <textarea aria-label="客户反馈" value={customerFeedback} onChange={(event) => setCustomerFeedback(event.target.value)} rows={2} />
                  </label>
                </>
              )}
              <div className="cb-btn-row">
                <button type="button" className="cb-btn cb-btn-primary" disabled={busy} onClick={advance}>
                  {busy ? '正在推进…' : next ? `推进到「${WORKFLOW_STAGE_LABELS[next]}」` : '已到当前节点'}
                </button>
              </div>
            </>
          ) : (
            <p className="cb-hint">当前案件仍处于受理 / 分析 / 人工判断 / 生成处理包阶段；请回到「新建客诉」流程完成人工判断并生成首次处理包后，再在本页推进临时遏制、根因、对策与客户确认。</p>
          )}
        </div>
      </section>

      <WorkflowTimeline record={record} />
      <CustomerView record={record} />
      {record.initialPack && (
        <EightDInitialView pack={record.initialPack} caseId={record.id} caseCreatedAt={record.createdAt} managerDecision={record.managerDecision} facts={record.facts} />
      )}
      <CollaborationLog record={record} />
    </main>
  )
}
