import { describe, expect, it } from 'vitest'

import { evaluateHardRisk } from './risk'

describe('evaluateHardRisk', () => {
  it('raises a human-review safety signal for injury and recall language', () => {
    expect(evaluateHardRisk({ impact: '客户人员受伤，要求召回' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SAFETY', requiresHuman: true })]),
    )
  })

  it('checks every non-empty confirmed fact as a hard-risk evidence source', () => {
    expect(evaluateHardRisk({ request: '客户要求立即召回', defect: '认证不符' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SAFETY', evidence: '客户要求立即召回' }),
        expect.objectContaining({ code: 'COMPLIANCE', evidence: '认证不符' }),
      ]),
    )
  })

  it.each([
    ['safety device failure from the original complaint', '制动失灵，操作员可能受伤', 'SAFETY'],
    ['protective device failure synonym', '防护罩失效，存在伤人隐患', 'SAFETY'],
    ['personal injury wording', '发生人身伤害，客户要求立即处理', 'SAFETY'],
    ['compliance wording', '认证不符，存在合规风险', 'COMPLIANCE'],
    ['line stoppage synonym', '客户产线停摆 4 小时', 'LINE_STOPPAGE'],
    ['batch quantity wording', '同批 500 件均出现裂纹', 'BATCH_FAILURE'],
    ['multi-batch anomaly synonym', '多批次异常，需隔离排查', 'BATCH_FAILURE'],
  ])('raises %s', (_name, complaint, code) => {
    expect(evaluateHardRisk({}, complaint)).toEqual(expect.arrayContaining([expect.objectContaining({ code })]))
  })

  it.each([
    ['safety inventory', '安全库存不足，暂未造成影响'],
    ['negated injury', '现场确认未发生人员受伤'],
    ['negated line stoppage', '客户确认未停线，现场仍在生产'],
    ['prevented recall', '已采取措施避免召回'],
    ['negated compliance issue', '尚未发现合规问题'],
    ['negated batch issue', '检验无批量异常'],
  ])('does not raise a hard-risk signal for %s', (_name, impact) => {
    expect(evaluateHardRisk({ impact })).toEqual([])
  })

  it.each([
    ['safety', '经确认未发生人员受伤，但后续操作员受伤', 'SAFETY'],
    ['line stoppage', '未发生停线，但产线停摆 2 小时', 'LINE_STOPPAGE'],
    ['batch failure', '检验无批量异常，但同批 500 件均出现裂纹', 'BATCH_FAILURE'],
    ['compliance', '已排除合规风险，但认证不符', 'COMPLIANCE'],
  ])('raises %s when a real risk follows an earlier negated mention', (_name, impact, code) => {
    expect(evaluateHardRisk({ impact })).toEqual(expect.arrayContaining([expect.objectContaining({ code })]))
  })

  it.each([
    ['no need for recall', '客户无需召回，当前无风险'],
    ['not a compliance issue', '这不是合规问题'],
    ['excluded compliance risk', '已排除合规风险'],
  ])('does not raise a hard-risk signal for explicit exclusion: %s', (_name, impact) => {
    expect(evaluateHardRisk({ impact })).toEqual([])
  })
})
