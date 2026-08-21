import { expect, test } from 'playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

test('offline backup opens directly from its generated index without a web server', async ({ page }) => {
  const offlineUrl = `${pathToFileURL(resolve(process.cwd(), 'offline-dist/index.html')).href}#/login`
  await page.goto(offlineUrl)

  await expect(page.getByText('本地验收模式 / Demo 模拟')).toBeVisible()
  await page.getByLabel('用户名').fill('linghe')
  await page.getByLabel('密码').fill('shuzhi')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '质量经理工作台' })).toBeVisible()
})
