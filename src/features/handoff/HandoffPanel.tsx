import { factLabel } from '../../domain/presentation'
import type { CaseFactField } from '../../contracts/case'

type Packet = { caseId: string; reason: string; suggestedTeam: string; sla: string; missingFields: CaseFactField[]; transitionReply: string; searchedKnowledge: string[] }

export function HandoffPanel({ packet, copy = (text) => navigator.clipboard.writeText(text) }: { packet: Packet; copy?: (text: string) => Promise<void> | void }) {
  return <section className="handoff-card" aria-labelledby="handoff-heading">
    <h2 id="handoff-heading" className="handoff-card__title">案件接管包</h2>
    <div className="handoff-card__grid">
      <div><span className="handoff-card__label">原因</span><span className="handoff-card__value">{packet.reason}</span></div>
      <div><span className="handoff-card__label">建议团队</span><span className="handoff-card__value">{packet.suggestedTeam}</span></div>
      <div><span className="handoff-card__label">SLA</span><span className="handoff-card__value">{packet.sla}</span></div>
      <div><span className="handoff-card__label">待补信息</span><span className="handoff-card__value">{packet.missingFields.length ? packet.missingFields.map(factLabel).join('、') : '无'}</span></div>
      <div><span className="handoff-card__label">已检索知识</span><span className="handoff-card__value">{packet.searchedKnowledge.length ? packet.searchedKnowledge.join('、') : '无命中'}</span></div>
    </div>
    <span className="handoff-card__reply-title">临时客户回复</span>
    <p className="handoff-card__reply">{packet.transitionReply}</p>
    <button onClick={() => void copy(packet.transitionReply)}>复制临时回复</button>
  </section>
}
