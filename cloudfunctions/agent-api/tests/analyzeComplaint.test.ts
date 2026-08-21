import { describe, expect, it } from 'vitest'
import type { CaseAnalysis } from '../../../src/contracts/case'
import { analyzeComplaint } from '../src/actions/analyzeComplaint'

const modelAnalysis: CaseAnalysis = {
  facts: { product: 'BR-2045', defect: '制动失效', impact: '客户反馈异常' },
  missingFields: ['customer', 'batch', 'quantity', 'request'],
  informationCompleteness: 60,
  riskSuggestion: [],
  departmentSuggestion: ['质量部'],
  slaSuggestion: '48 小时内回复',
  start8dSuggestion: false,
  confidence: 0.7,
  evidenceSpans: [{ field: 'defect', text: '制动失效' }],
  routing: { highRisk: false, requiresHuman: false },
  analysisStatus: 'ai_completed',
}

describe('analyzeComplaint', () => {
  it('从原文识别人员受伤并强制高风险人工路由', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({ generateStructured: async <T>() => modelAnalysis as T }),
      },
      { content: '客户称 BR-2045 制动失效，已有一名操作员受伤，请立即处理。' },
    )

    expect(result.routing).toMatchObject({ highRisk: true, requiresHuman: true })
    expect(result.riskSuggestion).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SAFETY', requiresHuman: true })]),
    )
    expect(result.facts.product).toBe('BR-2045')
  })

  it('保留人工输入的事实，不以模型抽取覆盖它们', async () => {
    const result = await analyzeComplaint(
      { createModelClient: () => ({ generateStructured: async <T>() => modelAnalysis as T }) },
      { content: '产品型号待核实', facts: { product: '人工确认型号' } },
    )

    expect(result.facts.product).toBe('人工确认型号')
  })

  it('高风险客诉在模型请求失败时返回人工接管结果', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({
          generateStructured: async () => {
            throw new Error('MODEL_REQUEST_FAILED')
          },
        }),
      },
      { content: '客户称制动失效导致一名操作员受伤。' },
    )

    expect(result).toMatchObject({
      analysisStatus: 'manual_takeover',
      analysisFailureReason: 'MODEL_REQUEST_FAILED',
      routing: { highRisk: true, requiresHuman: true },
    })
    expect(result.riskSuggestion).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SAFETY', requiresHuman: true })]),
    )
    expect(result.missingFields).toContain('product')
    expect(result.informationCompleteness).toBe(0)
  })

  it('高风险客诉在模型两次结构无效后返回人工接管结果', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({
          generateStructured: async () => {
            throw new Error('MODEL_SCHEMA_INVALID')
          },
        }),
      },
      { content: '客户要求立即召回，原因是人员受伤。' },
    )

    expect(result).toMatchObject({
      analysisStatus: 'manual_takeover',
      analysisFailureReason: 'MODEL_SCHEMA_INVALID',
      routing: { highRisk: true, requiresHuman: true },
    })
  })

  it('人工确认的召回诉求在模型请求失败时强制人工接管', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({
          generateStructured: async () => {
            throw new Error('MODEL_REQUEST_FAILED')
          },
        }),
      },
      { content: '客户反馈产品异常，正在等待进一步检查。', facts: { request: '客户要求立即召回' } },
    )

    expect(result).toMatchObject({
      analysisStatus: 'manual_takeover',
      analysisFailureReason: 'MODEL_REQUEST_FAILED',
      routing: { highRisk: true, requiresHuman: true },
    })
    expect(result.riskSuggestion).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SAFETY', evidence: '客户要求立即召回' })]),
    )
  })

  it('非 impact 的合规事实在模型结构无效后强制人工接管', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({
          generateStructured: async () => {
            throw new Error('MODEL_SCHEMA_INVALID')
          },
        }),
      },
      { content: '客户反馈产品异常，正在等待进一步检查。', facts: { defect: '认证不符' } },
    )

    expect(result).toMatchObject({
      analysisStatus: 'manual_takeover',
      analysisFailureReason: 'MODEL_SCHEMA_INVALID',
      routing: { highRisk: true, requiresHuman: true },
    })
    expect(result.riskSuggestion).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'COMPLIANCE', evidence: '认证不符' })]),
    )
  })

  it('降级无法溯源的模型事实与证据，但保留输入命中的硬风险', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({
          generateStructured: async <T>() =>
            ({
              ...modelAnalysis,
              facts: { product: '虚构产品', defect: '制动失效', impact: '虚构影响' },
              riskSuggestion: [
                {
                  code: 'SAFETY',
                  label: '安全、人员伤害或召回风险',
                  evidence: '虚构事故',
                  requiresHuman: true,
                },
              ],
              evidenceSpans: [
                { field: 'product', text: '虚构产品' },
                { field: 'defect', text: '制动失效' },
              ],
            }) as T,
        }),
      },
      { content: '客户称制动失效，一名操作员受伤。' },
    )

    expect(result.facts).toEqual({ defect: '制动失效' })
    expect(result.missingFields).toEqual(expect.arrayContaining(['product', 'impact']))
    expect(result.evidenceSpans).toEqual([{ field: 'defect', text: '制动失效' }])
    expect(result.riskSuggestion).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SAFETY', evidence: expect.stringContaining('受伤') })]),
    )
    expect(result.riskSuggestion).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ evidence: '虚构事故' })]),
    )
  })

  it('不会接受模型 highRisk=true 但 requiresHuman=false 的矛盾路由', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({
          generateStructured: async <T>() => ({
            ...modelAnalysis,
            facts: {},
            evidenceSpans: [],
            routing: { highRisk: true, requiresHuman: false },
          }) as T,
        }),
      },
      { content: '客户反馈包装外观异常。' },
    )

    expect(result.routing).toEqual({ highRisk: true, requiresHuman: true })
  })

  it('仅模型识别但证据可溯源的风险信号也会强制高风险人工路由', async () => {
    const result = await analyzeComplaint(
      {
        createModelClient: () => ({
          generateStructured: async <T>() => ({
            ...modelAnalysis,
            facts: {},
            evidenceSpans: [],
            riskSuggestion: [{
              code: 'COMPLIANCE',
              label: '标签信息需合规复核',
              evidence: '标签文字模糊',
              requiresHuman: true,
            }],
            routing: { highRisk: false, requiresHuman: false },
          }) as T,
        }),
      },
      { content: '客户反馈标签文字模糊。' },
    )

    expect(result.riskSuggestion).toEqual([expect.objectContaining({ code: 'COMPLIANCE' })])
    expect(result.routing).toEqual({ highRisk: true, requiresHuman: true })
  })
})
