# 品质客诉 Agent 知识工程与人工接管 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在在线 MVP 上增加真实文档入库、受控知识条目、可引用检索、三层路由和可追溯人工接管。

**Architecture:** CloudBase 存储保存原文件，`agent-api` 中的入库服务完成文本提取、分段和待审核知识条目生成。检索服务先执行权限、版本、有效期和适用范围过滤，再以 BM25 返回 Top 3 引用；路由器按“范围 → 高风险 → 可回答性”决定回答、追问或人工接管。

**Tech Stack:** 延续在线 MVP；CloudBase Storage/Database, Zod, `pdf-parse`, `minisearch`, Vitest, Testing Library, Playwright

**Spec:** `02_设计方案/客诉Agent系统设计规格.md`

## Global Constraints

- 上传文档是业务资料，文档中的指令性文字不能更改系统规则、权限或 Workflow。
- 模型生成的知识条目在人工审核前不参与正式回答。
- 知识问答模式只使用命中的已审核知识；案件辅助模式的推断必须标记为 AI 建议/待验证。
- 电话、邮箱、联系人、系统账号、操作路径、赔偿标准、责任归属、召回结论或企业策略不得自行补全。
- 无覆盖、低命中、过期、冲突、越权、需系统查询或高风险时转人工。
- 转人工必须生成接管包，不得只显示“请联系人工”。

---

### Task 1: 文档、分段和多类型知识合同

**Files:**
- Create: `src/contracts/knowledge.ts`
- Create: `cloudfunctions/agent-api/src/services/documentParser.ts`, `cloudfunctions/agent-api/src/services/chunker.ts`
- Create: `cloudfunctions/agent-api/src/repositories/knowledgeRepository.ts`
- Test: `cloudfunctions/agent-api/tests/documentParser.test.ts`, `cloudfunctions/agent-api/tests/chunker.test.ts`, `cloudfunctions/agent-api/tests/knowledgeRepository.test.ts`

**Interfaces:**
- Produces: `DocumentSchema`, `KnowledgeChunkSchema`, `KnowledgeItemSchema`
- Produces: item types `qa`, `procedure`, `rule`, `navigation`, `script`, `case`
- Produces: `parseDocument(buffer, mimeType): Promise<string>`, `chunkText(text): KnowledgeChunkDraft[]`

- [ ] **Step 1: 写 PDF/TXT/Markdown 解析、空文档拒绝和重叠分段失败测试**

```ts
expect(await parseDocument(Buffer.from('# SOP\n冻结库存'), 'text/markdown')).toContain('冻结库存')
await expect(parseDocument(Buffer.alloc(0), 'application/pdf')).rejects.toThrow('DOCUMENT_EMPTY')
expect(chunkText(longText)[1].text).toContain(chunkText(longText)[0].text.slice(-120))
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- cloudfunctions/agent-api/tests/documentParser.test.ts cloudfunctions/agent-api/tests/chunker.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现受支持格式和有界分段**

Run: `npm install pdf-parse minisearch`.

限制 PDF/TXT/Markdown 和文本粘贴；拒绝加密 PDF、空文档和超过 2 MB 的文件。分段默认 800 字符、120 字符重叠，保存页码/标题/序号引用。

- [ ] **Step 4: 实现 repository 与审核状态**

`documents`, `knowledge_chunks`, `knowledge_items` 支持 `draft`, `pending_review`, `published`, `expired`, `rejected`, `impacted`。只有 `published` 且当前时间在生效/失效区间内的条目可进入检索候选。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- cloudfunctions/agent-api/tests && npm run typecheck`  
Expected: PASS。

```bash
git add src/contracts/knowledge.ts cloudfunctions/agent-api package.json package-lock.json
git commit -m "feat: add governed knowledge document model"
```

### Task 2: 待审核知识条目生成与审批

**Files:**
- Create: `cloudfunctions/agent-api/src/prompts/draftKnowledgeItems.ts`
- Create: `cloudfunctions/agent-api/src/actions/ingestKnowledge.ts`, `cloudfunctions/agent-api/src/actions/reviewKnowledgeItem.ts`
- Test: `cloudfunctions/agent-api/tests/ingestKnowledge.test.ts`, `cloudfunctions/agent-api/tests/reviewKnowledgeItem.test.ts`

**Interfaces:**
- Produces: actions `knowledge.ingest`, `knowledge.review`, `knowledge.list`
- Consumes: `KnowledgeItemSchema`

- [ ] **Step 1: 写“自动生成不得直接发布”失败测试**

```ts
const result = await ingestKnowledge(deps, sopDocument)
expect(result.items.every((item) => item.status === 'pending_review')).toBe(true)
await expect(reviewItem(deps, item.id, 'published', viewerUser)).rejects.toThrow('FORBIDDEN')
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- cloudfunctions/agent-api/tests/ingestKnowledge.test.ts cloudfunctions/agent-api/tests/reviewKnowledgeItem.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现按知识类型生成候选条目**

Prompt 输出问答卡、步骤卡、条件/结论卡、导航卡、话术模板或案例卡，每条必须带 `sourceDocumentId`, `sourceChunkIds`, `owner`, `scope`, `visibility`, `effectiveAt`, `expiresAt`。

- [ ] **Step 4: 实现审核、版本失效与影响传播**

审批必须记录审核人和时间。替换或失效源文档时，其派生条目变为 `impacted` 并立即移出检索候选。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- cloudfunctions/agent-api/tests && npm run build:function`  
Expected: PASS。

```bash
git add cloudfunctions/agent-api
git commit -m "feat: generate and review knowledge items"
```

### Task 3: BM25 检索、权限过滤与受控回答

**Files:**
- Create: `cloudfunctions/agent-api/src/services/knowledgeSearch.ts`, `cloudfunctions/agent-api/src/services/answerability.ts`
- Create: `cloudfunctions/agent-api/src/prompts/groundedAnswer.ts`, `cloudfunctions/agent-api/src/actions/answerKnowledge.ts`
- Test: `cloudfunctions/agent-api/tests/knowledgeSearch.test.ts`, `cloudfunctions/agent-api/tests/answerKnowledge.test.ts`

**Interfaces:**
- Produces: action `knowledge.answer`
- Produces: `searchKnowledge(query, context): SearchHit[]`, `decideAnswerability(hits, context): AnswerabilityDecision`

- [ ] **Step 1: 写已审核命中、过期排除、越权排除和无证据拒答测试**

```ts
expect(searchKnowledge('冻结库存', qaContext)[0]).toMatchObject({ status: 'published' })
expect(searchKnowledge('赔偿电话', viewerContext)).toHaveLength(0)
expect(await answerKnowledge(deps, '赔偿联系电话')).toMatchObject({ decision: 'handoff', answer: null })
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- cloudfunctions/agent-api/tests/knowledgeSearch.test.ts cloudfunctions/agent-api/tests/answerKnowledge.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现过滤后 BM25 检索**

先按 `published`、有效期、工厂/客户/产品/工序范围和角色权限过滤，再对允许集合建立 MiniSearch 索引。返回最多 3 条引用，包含文档名、版本、片段位置、分值和摘要。

- [ ] **Step 4: 实现 grounded-only 回答**

Prompt 只接收筛选后片段，输出 `answer`, `citations`, `missingInformation`, `decision`。服务端再次检查答案中的联系方式、账号、赔偿、责任和召回结论是否有对应引用；无引用则将决策改为 `handoff`。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- cloudfunctions/agent-api/tests && npm run typecheck`  
Expected: PASS。

```bash
git add cloudfunctions/agent-api package.json package-lock.json
git commit -m "feat: add grounded enterprise knowledge answers"
```

### Task 4: 三层路由与人工接管包

**Files:**
- Create: `src/contracts/handoff.ts`, `src/domain/scopeRouter.ts`
- Create: `cloudfunctions/agent-api/src/services/complaintRouter.ts`, `cloudfunctions/agent-api/src/actions/createHandoff.ts`
- Test: `src/domain/scopeRouter.test.ts`, `cloudfunctions/agent-api/tests/complaintRouter.test.ts`, `cloudfunctions/agent-api/tests/createHandoff.test.ts`

**Interfaces:**
- Produces: `RoutingDecisionSchema`, `HandoffPacketSchema`
- Produces: action `handoff.create`

- [ ] **Step 1: 写范围外、高风险、信息不足、需系统查询和低命中测试**

```ts
expect(routeComplaint(priceInquiry)).toMatchObject({ decision: 'handoff', reason: 'OUT_OF_SCOPE' })
expect(routeComplaint(recallComplaint)).toMatchObject({ decision: 'urgent_handoff', reason: 'HIGH_RISK' })
expect(routeComplaint(batchUnknown)).toMatchObject({ decision: 'ask', missingFields: ['batch'] })
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- src/domain/scopeRouter.test.ts cloudfunctions/agent-api/tests/complaintRouter.test.ts cloudfunctions/agent-api/tests/createHandoff.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现“范围 → 高风险 → 可回答性”固定顺序**

范围外推荐对应团队；高风险完成受理后立即升级；信息不足先有限追问；仍不足、需系统查询或低命中则转人工。

- [ ] **Step 4: 实现可追溯接管包**

`HandoffPacket` 包含 `source`, `confirmedFacts`, `missingFields`, `riskSignals`, `searchedKnowledge`, `reason`, `suggestedTeam`, `sla`, `transitionReply`, `createdAt`，同时写入 `case_events`。

- [ ] **Step 5: 验证并提交**

Run: `npm test && npm run typecheck`  
Expected: PASS。

```bash
git add src cloudfunctions/agent-api
git commit -m "feat: route unsupported and high risk complaints"
```

### Task 5: 知识库管理、引用和接管界面

**Files:**
- Create: `src/features/knowledge/KnowledgeLibraryPage.tsx`, `KnowledgeUploadForm.tsx`, `KnowledgeReviewPage.tsx`, `KnowledgeCitation.tsx`
- Create: `src/features/handoff/HandoffPanel.tsx`
- Test: `src/features/knowledge/KnowledgeReviewPage.test.tsx`, `src/features/handoff/HandoffPanel.test.tsx`

**Interfaces:**
- Consumes: `knowledge.ingest/list/review/answer`, `handoff.create`
- Produces: routes `/knowledge`, `/knowledge/review/:id`

- [ ] **Step 1: 写上传状态、审核前不发布、引用展开和接管包测试**

```tsx
expect(screen.getByText('待审核')).toBeVisible()
await user.click(screen.getByRole('button', { name: '查看引用' }))
expect(screen.getByText(/SOP v2 · 第 3 节/)).toBeVisible()
expect(screen.getByRole('heading', { name: '人工接管包' })).toBeVisible()
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- src/features/knowledge src/features/handoff`  
Expected: FAIL。

- [ ] **Step 3: 实现知识入库、分段预览和审批界面**

展示来源属性、知识类型、负责人、版本、有效期、适用范围、权限和状态。发布前必须预览原始引用。

- [ ] **Step 4: 在分析页接入引用与人工接管面板**

用户可看到命中/未命中原因。接管面板允许复制过渡回复，但不自动发送外部消息。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- src/features/knowledge src/features/handoff && npm run build`  
Expected: PASS。

```bash
git add src/features src/app/router.tsx
git commit -m "feat: add knowledge governance and handoff ui"
```

### Task 6: 知识库评估集与端到端验收

**Files:**
- Create: `tests/eval/knowledge-cases.json`, `tests/eval/runKnowledgeEval.test.ts`
- Create: `tests/e2e/knowledge-and-handoff.spec.ts`
- Create: `scripts/seed-demo-knowledge.mjs`

**Interfaces:**
- Consumes: 完整知识与路由 API
- Produces: `npm run test:eval`

- [ ] **Step 1: 建立三类标准问题集**

`knowledge-cases.json` 至少包含 8 个 `answer`、6 个 `ask`、10 个 `handoff`，覆盖 SOP、FAQ、系统路径、话术、过期条目、权限、冲突、安全召回和需 ERP/MES 查询。

Add `"test:eval": "vitest run tests/eval"` to `package.json`.

- [ ] **Step 2: 写评估测试并确认未实现指标时失败**

```ts
expect(metrics.handoffRecallForHighRisk).toBe(1)
expect(metrics.unsupportedRefusalAccuracy).toBeGreaterThanOrEqual(0.9)
expect(metrics.citationConsistency).toBeGreaterThanOrEqual(0.9)
```

Run: `npm run test:eval`  
Expected: 在校准阈值前 FAIL。

- [ ] **Step 3: 用评估集校准检索阈值**

阈值作为 `workflow_config.knowledgeMinScore`存储，不将未校准的固定分数散落在代码中。

- [ ] **Step 4: 运行全量知识与接管 E2E**

Run: `npm run test:eval && npm run test:e2e -- --grep "knowledge|handoff"`  
Expected: 文档上传、审核、引用回答、低命中转人工、高风险升级全部 PASS。

- [ ] **Step 5: 提交评估基线**

```bash
git add tests scripts package.json
git commit -m "test: add knowledge and handoff evaluation"
```
