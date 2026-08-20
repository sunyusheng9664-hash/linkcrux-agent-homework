# 品质客诉 Agent 在线 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可登录、可输入真实客诉、可调用模型分析、可人工修改判断并生成首响与 D1–D3 初版的 CloudBase 在线纵向 MVP。

**Architecture:** Vite + React + TypeScript 前端通过 CloudBase Web SDK 登录并调用一个 `agent-api` 云函数。云函数内部以 action handler 实现规格中的逻辑函数，访问 CloudBase 文档数据库并通过服务端模型适配器调用结构化 JSON API。

**Tech Stack:** React, TypeScript, Vite, React Router, Zod, CloudBase Web/Node SDK, Vitest, Testing Library, Playwright, tsup

**Spec:** `02_设计方案/客诉Agent系统设计规格.md`

## Global Constraints

- 模型 API 密钥和云资源凭据不进入前端、GitHub、数据库或日志。
- AI 准备材料并提供建议，质量经理对高风险结论和对外承诺负责。
- 当天只生成 D1–D3 初版与 D4–D8 后续计划，不伪造最终调查结论。
- 模型输出必须经结构校验，不合格输出不写入正式结论。
- 在线版使用 CloudBase 用户名认证，不在代码中校验明文密码。
- 所有“事实、AI 抽取、AI 建议、待验证、Demo 模拟”内容均带文字标签，不仅依赖颜色。

---

## File Structure

```text
package.json                         # 根脚本、前端与测试依赖
src/contracts/                      # 前后端共用的 Zod 结构与 TypeScript 类型
src/domain/                         # 完整率、风险、证据标签等纯函数
src/services/cloudbase.ts           # CloudBase Web SDK 初始化
src/services/agentApi.ts            # 类型安全的云函数调用客户端
src/features/auth/                  # 登录状态与页面
src/features/cases/                 # 案件列表、新建、分析和人工判断
src/features/initial-pack/          # 首响、工单、8D 初版视图
cloudfunctions/agent-api/src/       # 单个部署单元内的 action handlers
cloudfunctions/agent-api/tests/     # 云函数单元与合同测试
tests/e2e/                          # Playwright 主流程测试
```

### Task 1: 工程骨架与共用业务合同

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`
- Create: `src/contracts/case.ts`, `src/contracts/api.ts`, `src/domain/completeness.ts`, `src/domain/risk.ts`
- Test: `src/domain/completeness.test.ts`, `src/domain/risk.test.ts`

**Interfaces:**
- Produces: `ComplaintInputSchema`, `CaseAnalysisSchema`, `InitialPackSchema`, `ApiRequestSchema`, `ApiResponseSchema`
- Produces: `calculateCompleteness(facts): number`, `evaluateHardRisk(facts): RiskSignal[]`

- [ ] **Step 1: 初始化工程和脚本**

Run:

```bash
npm init -y
npm install react react-dom react-router-dom zod @cloudbase/js-sdk @cloudbase/node-sdk
npm install -D typescript vite @vitejs/plugin-react vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event playwright tsup @types/node @types/react @types/react-dom
```

Set the following scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "build:function": "tsup cloudfunctions/agent-api/src/index.ts --bundle --platform node --format cjs --out-dir cloudfunctions/agent-api/dist",
    "check:secrets": "node scripts/check-secrets.mjs",
    "verify": "npm test && npm run typecheck && npm run build && npm run build:function && npm run test:e2e && npm run check:secrets"
  }
}
```

- [ ] **Step 2: 先写完整率与硬风险失败测试**

```ts
expect(calculateCompleteness({ product: 'BR-2045', defect: '尺寸超差' })).toBe(40)
expect(evaluateHardRisk({ impact: '客户人员受伤，要求召回' }))
  .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SAFETY' })]))
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- src/domain/completeness.test.ts src/domain/risk.test.ts`  
Expected: FAIL，原因为函数尚未定义。

- [ ] **Step 4: 实现合同、完整率和硬风险规则**

```ts
export function calculateCompleteness(facts: Partial<CaseFacts>): number {
  const required: (keyof CaseFacts)[] = ['customer', 'product', 'batch', 'defect', 'impact']
  return Math.round(required.filter((key) => Boolean(facts[key])).length / required.length * 100)
}
```

`evaluateHardRisk` 仅命中安全、人员伤害、召回、合规、重大停线和批量失效硬规则，输出 `code`, `label`, `evidence`, `requiresHuman: true`。

- [ ] **Step 5: 验证并提交**

Run: `npm test && npm run typecheck && npm run build`  
Expected: PASS。

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts index.html src
git commit -m "chore: scaffold quality complaint agent"
```

### Task 2: 模型适配器与结构化客诉分析

**Files:**
- Create: `cloudfunctions/agent-api/package.json`, `cloudfunctions/agent-api/tsconfig.json`
- Create: `cloudfunctions/agent-api/src/services/modelClient.ts`, `cloudfunctions/agent-api/src/prompts/analyzeComplaint.ts`
- Create: `cloudfunctions/agent-api/src/actions/analyzeComplaint.ts`
- Test: `cloudfunctions/agent-api/tests/modelClient.test.ts`, `cloudfunctions/agent-api/tests/analyzeComplaint.test.ts`

**Interfaces:**
- Consumes: `ComplaintInputSchema`, `CaseAnalysisSchema`
- Produces: `ModelClient.generateStructured<T>(schema, messages): Promise<T>`
- Produces: `analyzeComplaint(deps, input): Promise<CaseAnalysis>`

- [ ] **Step 1: 写失败测试，要求结构校验和硬风险优先**

```ts
await expect(client.generateStructured(CaseAnalysisSchema, messages)).rejects.toThrow('MODEL_SCHEMA_INVALID')
expect((await analyzeComplaint(deps, injuryInput)).routing).toMatchObject({ highRisk: true, requiresHuman: true })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- cloudfunctions/agent-api/tests/modelClient.test.ts cloudfunctions/agent-api/tests/analyzeComplaint.test.ts`  
Expected: FAIL，缺少 model client 与 action。

- [ ] **Step 3: 实现模型适配器**

`modelClient.ts` 从 `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` 读取配置，使用 `Authorization: Bearer` 从服务端发起请求，不记录 header。解析后执行 `schema.safeParse`；只允许一次格式修复请求。

- [ ] **Step 4: 实现分析 prompt 与 action**

Prompt 强制输出 `facts`, `missingFields`, `informationCompleteness`, `riskSuggestion`, `departmentSuggestion`, `slaSuggestion`, `start8dSuggestion`, `confidence`, `evidenceSpans`, `routing`。硬风险规则的 `requiresHuman` 不允许被模型覆盖。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- cloudfunctions/agent-api/tests && npm run typecheck`  
Expected: PASS，日志快照中不含 `LLM_API_KEY`。

```bash
git add cloudfunctions src/contracts package.json package-lock.json
git commit -m "feat: add structured complaint analysis"
```

### Task 3: CloudBase 案件持久化与云函数路由

**Files:**
- Create: `cloudfunctions/agent-api/src/repositories/caseRepository.ts`, `cloudfunctions/agent-api/src/repositories/modelUsageRepository.ts`
- Create: `cloudfunctions/agent-api/src/index.ts`, `cloudfunctions/agent-api/src/router.ts`
- Test: `cloudfunctions/agent-api/tests/caseRepository.test.ts`, `cloudfunctions/agent-api/tests/router.test.ts`

**Interfaces:**
- Produces: actions `cases.create`, `cases.list`, `cases.get`, `cases.analyze`, `cases.confirm`
- Produces: `CaseRepository.create/get/list/update`, `ModelUsageRepository.record`

- [ ] **Step 1: 为未登录请求、案件持久化和 action 白名单写失败测试**

```ts
await expect(route({ action: 'cases.list' }, anonymousContext)).rejects.toThrow('UNAUTHENTICATED')
expect(await repo.get(created.id)).toMatchObject({ status: 'intake', createdBy: 'user-1' })
await expect(route({ action: 'admin.eval' } as never, userContext)).rejects.toThrow('ACTION_NOT_ALLOWED')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- cloudfunctions/agent-api/tests/router.test.ts cloudfunctions/agent-api/tests/caseRepository.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 用依赖注入实现 repository 与 auth context**

Repository 测试使用内存 adapter，生产 adapter 使用 CloudBase Node SDK 访问 `cases`, `case_events`, `model_usage`。只允许用户读取其有权访问的案件。

- [ ] **Step 4: 实现单函数 action router 并构建部署产物**

`src/index.ts` 只解析 `ApiRequestSchema`、获取认证用户、调用白名单 handler 并返回 `ApiResponseSchema`。`npm run build:function` 用 tsup 打包为 `cloudfunctions/agent-api/dist/index.js`。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- cloudfunctions/agent-api/tests && npm run build:function`  
Expected: PASS；打包文件不含本地 `.env` 值。

```bash
git add cloudfunctions package.json package-lock.json
git commit -m "feat: persist cases through cloudbase api"
```

### Task 4: CloudBase 登录、工作台和新建客诉

**Files:**
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/app/router.tsx`, `src/styles/global.css`
- Create: `src/services/cloudbase.ts`, `src/services/agentApi.ts`, `src/services/attachments.ts`
- Create: `src/features/auth/LoginPage.tsx`, `src/features/auth/AuthGuard.tsx`
- Create: `src/features/cases/WorkbenchPage.tsx`, `src/features/cases/NewCasePage.tsx`
- Test: `src/features/auth/LoginPage.test.tsx`, `src/features/cases/NewCasePage.test.tsx`

**Interfaces:**
- Consumes: CloudBase username auth, actions `cases.create/list`
- Produces: routes `/login`, `/`, `/cases/new`, `/cases/:id/analyze`

- [ ] **Step 1: 写登录与客诉输入失败测试**

```tsx
await user.type(screen.getByLabelText('用户名'), 'linghe')
await user.type(screen.getByLabelText('密码'), 'test-password')
await user.click(screen.getByRole('button', { name: '登录' }))
expect(auth.signIn).toHaveBeenCalledWith('linghe', 'test-password')

await user.click(screen.getByRole('button', { name: '提交分析' }))
expect(screen.getByText('请输入客诉内容')).toBeVisible()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/features/auth src/features/cases`  
Expected: FAIL。

- [ ] **Step 3: 实现 CloudBase SDK 封装与认证守卫**

`cloudbase.ts` 只从 `VITE_CLOUDBASE_ENV_ID` 读取环境 ID。`AuthGuard` 在未登录时跳转 `/login`，不在前端比较固定密码。

- [ ] **Step 4: 实现工作台、示例入口与新建表单**

新建页支持自由文本、示例案例加载和图片附件。`attachments.ts` 使用 CloudBase Storage SDK 上传图片，案件仅保存 file ID、MIME、大小和原始文件名；限制单文件 5 MB，上传失败时不创建伪附件记录。文档知识上传留给第二份计划。

- [ ] **Step 5: 验证无障碍基线并提交**

Run: `npm test -- src/features/auth src/features/cases && npm run build`  
Expected: PASS；所有表单控件有 label，键盘可达。

```bash
git add src index.html package.json package-lock.json
git commit -m "feat: add authenticated complaint intake"
```

### Task 5: 分析证据、质量经理判断与首次处理包

**Files:**
- Create: `src/features/cases/AnalysisPage.tsx`, `src/features/cases/EvidenceTag.tsx`, `src/features/cases/ManagerDecisionForm.tsx`
- Create: `src/features/initial-pack/InitialPackPage.tsx`, `src/features/initial-pack/EightDInitialView.tsx`
- Create: `cloudfunctions/agent-api/src/prompts/generateInitialPack.ts`, `cloudfunctions/agent-api/src/actions/generateInitialPack.ts`
- Test: `src/features/cases/AnalysisPage.test.tsx`, `src/features/initial-pack/EightDInitialView.test.tsx`, `cloudfunctions/agent-api/tests/generateInitialPack.test.ts`

**Interfaces:**
- Consumes: actions `cases.analyze`, `cases.confirm`
- Produces: action `cases.generateInitialPack`, route `/cases/:id/initial-pack`

- [ ] **Step 1: 写人工修改与 D1–D3 边界失败测试**

```tsx
await user.selectOptions(screen.getByLabelText('严重度'), 'critical')
await user.type(screen.getByLabelText('修改原因'), '客户产线停线')
await user.click(screen.getByRole('button', { name: '确认判断' }))
expect(api.confirmCase).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }))
expect(screen.getByText('D4–D8 后续计划')).toBeVisible()
expect(screen.queryByText('已验证最终根因')).not.toBeInTheDocument()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/features/cases/AnalysisPage.test.tsx src/features/initial-pack cloudfunctions/agent-api/tests/generateInitialPack.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现带依据的分析和人工判断**

分析页三栏展示原文、Agent 结果、质量经理判断。修改或驳回必须填写原因。高风险 `requiresHuman` 不允许在前端关闭。

- [ ] **Step 4: 实现首次处理包**

生成结构必须包含 `customerReply`, `internalTicket`, `d1`, `d2`, `d3`, `timeline24h14d30d`。“建议措施”和“已执行”分字段存储。

- [ ] **Step 5: 验证并提交**

Run: `npm test && npm run typecheck && npm run build && npm run build:function`  
Expected: PASS。

```bash
git add src cloudfunctions
git commit -m "feat: add manager decision and initial 8d pack"
```

### Task 6: 在线 MVP 端到端验收与 CloudBase 部署检查点

**Files:**
- Create: `tests/e2e/online-mvp.spec.ts`, `tests/fixtures/main-complaint.ts`
- Create: `.env.example`, `.gitignore`, `scripts/check-secrets.mjs`, `README.md` additions
- Modify: `package.json`

**Interfaces:**
- Consumes: 完整 MVP 路由和 CloudBase function
- Produces: `npm run verify`, `npm run check:secrets`

- [ ] **Step 1: 写端到端主流程测试**

```ts
await page.getByRole('button', { name: '开始示例体验' }).click()
await page.getByRole('button', { name: '提交分析' }).click()
await page.getByLabel('严重度').selectOption('critical')
await page.getByLabel('修改原因').fill('客户停线 4 小时')
await page.getByRole('button', { name: '确认判断' }).click()
await expect(page.getByText('8D 初版')).toBeVisible()
```

- [ ] **Step 2: 实现云服务 mock 和本地 E2E 模式**

E2E 使用 `VITE_API_MODE=mock` 走与 CloudBase 相同的 `AgentApi` 接口，但不说明为真实云端验收。真实 CloudBase 验收在部署环境另跑同一套用例。

- [ ] **Step 3: 实现密钥扫描**

`check-secrets.mjs` 扫描 `src`, `dist`, `cloudfunctions/*/dist` 和 Git tracked files，拒绝 `AKID`, `LLM_API_KEY=` 非空值、`SecretKey` 值和常见 Bearer token 模式。

- [ ] **Step 4: 运行全量本地验证**

Run: `npm run verify`  
Expected: unit, component, E2E, typecheck, frontend build, function build, secret scan 全部 PASS。

- [ ] **Step 5: 在 CloudBase 控制台配置而不传递密钥**

创建 `linghe` 用户；设置 `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`；部署 `agent-api` 和静态网站。使用者在控制台完成这些输入，不将值粘贴进聊天。

- [ ] **Step 6: 冒烟验证并提交**

Export the deployed URL in the terminal with `export CLOUDBASE_DEPLOYED_URL='https://the-domain-shown-in-cloudbase-console'`, then run: `CLOUDBASE_BASE_URL="$CLOUDBASE_DEPLOYED_URL" npm run test:e2e -- --grep "online smoke"`  
Expected: 登录、案件持久化、分析、人工修改和首次处理包全部 PASS。已部署域名仅存在当前终端会话，不写入仓库。

```bash
git add tests scripts .env.example .gitignore README.md package.json
git commit -m "test: verify online complaint mvp"
```
