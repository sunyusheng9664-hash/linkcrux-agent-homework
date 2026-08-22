import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatCaseNumber, formatDateTime } from '../../domain/presentation'
import type { CaseRecord, InitialPackFailureReason } from '../../contracts/case'
import type { AgentApi } from '../../services/agentApi'
import { EightDInitialView } from './EightDInitialView'

export function InitialPackPage({
  api,
  pollIntervalMs = 1_000,
  maxPollAttempts = 3,
  now = () => new Date(),
}: {
  api: Pick<AgentApi, 'getCase' | 'generateInitialPack'>
  pollIntervalMs?: number
  maxPollAttempts?: number
  now?: () => Date
}) {
  const { id } = useParams()
  const [caseRecord, setCaseRecord] = useState<CaseRecord>()
  const [error, setError] = useState<string>()
  const [recoveryNotice, setRecoveryNotice] = useState<string>()
  const [retrying, setRetrying] = useState(false)
  const [pollExhausted, setPollExhausted] = useState(false)

  async function observeGenerating(found: CaseRecord, shouldUpdate: () => boolean = () => true) {
    if (!shouldUpdate()) return
    setCaseRecord(found)
    if (found.initialPackStatus !== 'generating') return
    setPollExhausted(false)
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await wait(pollIntervalMs)
      if (!shouldUpdate()) return
      const latest = await api.getCase(found.id)
      setCaseRecord(latest)
      if (latest.initialPackStatus !== 'generating') return
    }
    if (shouldUpdate()) setPollExhausted(true)
  }

  useEffect(() => {
    let active = true
    setPollExhausted(false)
    setRecoveryNotice(undefined)
    async function load() {
      if (!id) { setError('案件编号无效'); return }
      try {
        const found = await api.getCase(id)
        if (!active) return
        if (found.initialPack || found.initialPackStatus === 'manual_handoff') {
          setCaseRecord(found)
          return
        }
        if (found.initialPackStatus === 'generating') {
          await observeGenerating(found, () => active)
          return
        }
        try {
          const generated = await api.generateInitialPack(id)
          await observeGenerating(generated, () => active)
        } catch {
          const latest = await api.getCase(id)
          await observeGenerating(latest, () => active)
        }
      } catch {
        if (!active) return
        setError('首次处理包状态读取失败，请稍后重试。')
      }
    }
    void load()
    return () => { active = false }
  }, [api, id, maxPollAttempts, pollIntervalMs])

  async function refreshStatus() {
    if (!id) return
    setError(undefined)
    setRecoveryNotice(undefined)
    try {
      const latest = await api.getCase(id)
      await observeGenerating(latest)
    } catch {
      setError('首次处理包状态读取失败，请稍后重试。')
    }
  }

  async function retry() {
    if (!id) return
    setRetrying(true)
    setError(undefined)
    setRecoveryNotice(undefined)
    setPollExhausted(false)
    try {
      await observeGenerating(await api.generateInitialPack(id, { retry: true }))
    } catch {
      try {
        const latest = await api.getCase(id)
        if (latest.initialPackStatus === 'generating') {
          setRecoveryNotice('当前生成租约仍有效，请稍后刷新状态再恢复。')
        }
        await observeGenerating(latest)
      } catch {
        setError('首次处理包状态读取失败，请稍后重试。')
      }
    } finally {
      setRetrying(false)
    }
  }

  if (error) return <main className="page"><p role="alert">{error}</p></main>
  if (!caseRecord || (caseRecord.initialPackStatus === 'generating' && !pollExhausted)) return <main className="page"><p>正在生成首次处理包…</p></main>
  if (caseRecord.initialPackStatus === 'generating') {
    const leaseUntil = caseRecord.initialPackGeneration?.leaseUntil
    const leaseActive = Boolean(leaseUntil && Date.parse(leaseUntil) > now().getTime())
    return <main className="page">
      <h1>生成状态长时间未更新</h1>
      <p>请先刷新状态；确认原生成任务已中断后，可显式恢复生成。</p>
      {leaseUntil && <p>可恢复时间：<time dateTime={leaseUntil}>{leaseUntil}</time></p>}
      {recoveryNotice && <p role="alert">{recoveryNotice}</p>}
      <button type="button" onClick={() => void refreshStatus()}>刷新状态</button>
      <button type="button" disabled={retrying || leaseActive} onClick={() => void retry()}>{retrying ? '恢复中…' : '恢复生成'}</button>
    </main>
  }
  if (caseRecord.initialPackStatus === 'manual_handoff') {
    return <main className="page">
      <h1>首次处理包需要人工接管</h1>
      <p>原因：{failureReasonLabel(caseRecord.initialPackFailureReason)}</p>
      <button type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? '重试中…' : '人工确认后重试'}</button>
    </main>
  }
  if (!caseRecord.initialPack) return <main className="page"><p role="alert">首次处理包状态异常，请联系管理员。</p></main>
  const facts = { ...caseRecord.facts, ...caseRecord.analysis?.facts }
  return <main className="page">
    <nav className="breadcrumb" aria-label="面包屑">
      <Link to="/">工作台</Link><span aria-hidden="true">/</span><span>案件 {formatCaseNumber(caseRecord.id)}</span><span aria-hidden="true">/</span><span aria-current="page">首次处理包</span>
    </nav>
    {caseRecord.managerDecision && <section className="panel success-banner" role="status">
      <strong>人工判断已确认</strong>
      <p>案件 {formatCaseNumber(caseRecord.id)} · 版本 v{caseRecord.version} · 生成时间 {formatDateTime(caseRecord.updatedAt)}</p>
      <Link className="button secondary" to="/">返回工作台</Link>
    </section>}
    <EightDInitialView
      pack={caseRecord.initialPack}
      caseId={caseRecord.id}
      caseCreatedAt={caseRecord.createdAt}
      managerDecision={caseRecord.managerDecision}
      facts={facts}
    />
  </main>
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)))
}

function failureReasonLabel(reason?: InitialPackFailureReason): string {
  if (reason === 'INITIAL_PACK_UNSAFE_D3') return 'D3 建议包含不允许的完成态或结论态'
  if (reason === 'INITIAL_PACK_ASSEMBLY_FAILED') return '服务端处理包组装失败'
  return '模型生成失败'
}
