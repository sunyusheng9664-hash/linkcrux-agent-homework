import { expect, test } from 'playwright/test'

import { MAIN_COMPLAINT } from '../fixtures/main-complaint'

test('interviewer completes one governed complaint decision in local acceptance mode', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('本地验收模式 / Demo 模拟')).toBeVisible()
  await page.getByLabel('用户名').fill('linghe')
  await page.getByLabel('密码').fill('shuzhi')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByRole('heading', { name: '质量经理工作台' })).toBeVisible()
  await page.getByRole('link', { name: '开始示例体验' }).click()
  await expect(page.getByLabel('客诉内容')).toHaveValue(MAIN_COMPLAINT.content)
  await page.getByRole('button', { name: '提交分析' }).click()

  await expect(page.getByRole('heading', { name: '案件分析与人工判断' })).toBeVisible()
  await expect(page.getByText('已核实事实')).toBeVisible()
  await expect(page.getByText('AI 抽取')).toBeVisible()
  await expect(page.getByText('缺失信息')).toBeVisible()
  await expect(page.getByText('AI 建议')).toBeVisible()
  await page.getByLabel('知识问题').fill('尺寸超差后如何临时遏制？')
  await page.getByRole('button', { name: '查询已发布知识' }).click()
  await expect(page.getByRole('heading', { name: '受控知识回答' })).toBeVisible()
  await expect(page.getByText(/Demo 模拟知识回答/)).toBeVisible()
  await expect(page.getByRole('list', { name: '知识引用' }).getByText(/Demo 来料异常 SOP v1/)).toBeVisible()
  await page.getByLabel('判断结果').selectOption('modified')
  await page.getByLabel('严重度').selectOption('critical')
  await page.getByLabel('修改原因').fill('客户产线停线，需升级处置')
  await page.getByRole('button', { name: '确认判断' }).click()

  await expect(page.getByRole('heading', { name: '8D 初版' })).toBeVisible()
  await expect(page.getByText('本地 Demo 模拟结果，不代表真实模型或 CloudBase 已验收。')).toBeVisible()
  await expect(page.getByRole('heading', { name: '内部工单草案' })).toBeVisible()
  await expect(page.getByText(/严重度调整为严重/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'D1 团队计划' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'D2 问题描述' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'D3 临时遏制建议' })).toBeVisible()
  await expect(page.getByText('AI 建议 · 未执行')).toHaveCount(2)
  const timeline = page.getByRole('region', { name: '交付时间线' })
  await expect(timeline.getByText('24h')).toBeVisible()
  await expect(timeline.getByText('14d')).toBeVisible()
  await expect(timeline.getByText('30d')).toBeVisible()
  const followUp = page.getByRole('region', { name: 'D4–D8 后续计划' })
  for (const phase of ['D4', 'D5', 'D6', 'D7', 'D8']) {
    await expect(followUp.getByText(phase, { exact: true })).toBeVisible()
  }
})
