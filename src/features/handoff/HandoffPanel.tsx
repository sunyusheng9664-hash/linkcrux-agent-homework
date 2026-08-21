import type { CaseFactField } from '../../contracts/case'

type Packet = { caseId: string; reason: string; suggestedTeam: string; sla: string; missingFields: CaseFactField[]; transitionReply: string; searchedKnowledge: string[] }

export function HandoffPanel({ packet, copy = (text) => navigator.clipboard.writeText(text) }: { packet: Packet; copy?: (text: string) => Promise<void> | void }) {
  return <section className="panel" aria-labelledby="handoff-heading"><h2 id="handoff-heading">人工接管包</h2>
    <p>原因：{packet.reason}</p><p>建议团队：{packet.suggestedTeam}</p><p>SLA：{packet.sla}</p>
    <p>待补信息：{packet.missingFields.length ? packet.missingFields.join('、') : '无'}</p>
    <p>已检索知识：{packet.searchedKnowledge.length ? packet.searchedKnowledge.join('、') : '无命中'}</p>
    <p>客户过渡回复：{packet.transitionReply}</p><button onClick={() => void copy(packet.transitionReply)}>复制过渡回复</button>
  </section>
}
