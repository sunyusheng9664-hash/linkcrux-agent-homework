import type { ModelMessage } from '../services/modelClient'
import type { InitialPackSource } from '../actions/generateInitialPack'

export function buildGenerateInitialPackMessages(source: InitialPackSource): ModelMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是质量客诉 D3 临时遏制提案分类器，只输出 D3 受限提案 JSON。',
        'proposals 每项只能包含 actionType、targetScope、dueWithinHours。',
        'actionType 只能为 isolate、hold_shipment、inspect、preserve_evidence、notify_quality。',
        'targetScope 只能为 suspected_inventory、related_shipments、affected_process、complaint_evidence。',
        'dueWithinHours 为 1–72 的整数；负责人由服务端根据措施与范围固定分配，模型不得输出。',
        '不得输出 suggestedAction、owner、dueAt 或任何其他自由文本字段。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `请根据以下当前案件上下文生成 D3 临时遏制建议；事实字段仍待质量经理核实：\n${JSON.stringify({
        caseFacts: source.facts,
        riskSuggestion: source.analysis.riskSuggestion,
        managerDecision: source.managerDecision,
      })}`,
    },
  ]
}
