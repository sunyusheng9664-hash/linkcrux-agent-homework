import type { InitialPack } from '../../contracts/case'

export function EightDInitialView({ pack }: { pack: InitialPack }) {
  return <article>
    <header><h1>8D 初版</h1><p>首次处理范围为 D1–D3；后续阶段均为待验证计划。</p></header>

    <section className="panel"><h2>客户首次回复草案</h2><p>{pack.customerReply}</p></section>
    <section className="panel"><h2>内部工单草案</h2><p>{pack.internalTicket}</p></section>
    <section className="panel"><h2>D1 团队计划</h2><p>{pack.d1}</p></section>
    <section className="panel"><h2>D2 问题描述</h2><p>{pack.d2}</p></section>

    <section className="panel" aria-labelledby="d3-heading">
      <h2 id="d3-heading">D3 临时遏制建议</h2>
      <p className="hint">以下仅为 AI 建议，不能代表措施已经执行。执行状态必须由人工在独立记录中确认并附证据。</p>
      <ul className="card-list">
        {pack.d3.containmentActions.map((action, index) => <li key={`${action.suggestedAction}-${index}`}>
          <strong>AI 建议 · 未执行</strong>
          <p>{action.suggestedAction}</p>
          <p>建议负责人：{action.owner}</p>
          <p>建议完成时间：{action.dueAt}</p>
        </li>)}
      </ul>
    </section>

    <section className="panel" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">交付时间线</h2>
      <ol>{pack.timeline24h14d30d.map((item) => <li key={item.milestone}><strong>{item.milestone}</strong>：{item.delivery}</li>)}</ol>
    </section>

    <section className="panel" aria-labelledby="follow-up-heading">
      <h2 id="follow-up-heading">D4–D8 后续计划</h2>
      <p className="hint">这些内容是下一阶段工作计划，不是已经核实的结论或已完成事项。</p>
      <ol>{pack.d4ToD8Plan.map((item) => <li key={item.phase}><strong>{item.phase}</strong> <span className="evidence-tag evidence-tag--missing">计划中</span><p>{item.plan}</p></li>)}</ol>
    </section>
  </article>
}
