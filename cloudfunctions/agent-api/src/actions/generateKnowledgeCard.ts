import { CaseWorkflowSchema } from '../../../../src/contracts/workflow'
import type { KnowledgeItem } from '../../../../src/contracts/knowledge'
import { formatCaseNumber } from '../../../../src/domain/presentation'
import type { CaseRepository } from '../repositories/caseRepository'
import type { KnowledgeRepository } from '../repositories/knowledgeRepository'
import { chunkText } from '../services/chunker'

export async function generateKnowledgeCard(
  deps: { caseRepository: CaseRepository; knowledgeRepository: KnowledgeRepository },
  id: string,
  actorId: string,
): Promise<{ item: KnowledgeItem; caseNumber: string }> {
  const record = await deps.caseRepository.get(id, actorId)
  const workflow = record.workflow
  if (!workflow || workflow.stage !== 'closed' || !workflow.closedAt) throw new Error('CASE_NOT_CLOSED')
  if (workflow.knowledgeSedimentation === 'generated') throw new Error('KNOWLEDGE_CARD_ALREADY_GENERATED')

  const facts = { ...record.facts, ...record.analysis?.facts }
  const caseNumber = formatCaseNumber(record.id)
  const sourceText = [
    `案件 ${caseNumber}：${facts.customer ?? '客户待补充'}｜${facts.product ?? '产品待补充'}｜${facts.defect ?? '缺陷待补充'}`,
    `根因：${workflow.rootCause ?? '未记录'}`,
    `永久对策：${workflow.correctiveAction ?? '未记录'}；验证：${workflow.correctiveVerification ?? '未记录'}`,
    `客户反馈原文：${record.content}`,
  ].join('\n')

  const document = await deps.knowledgeRepository.createDocument(actorId, {
    name: `案件沉淀｜${caseNumber}.md`,
    mimeType: 'text/markdown',
    sourceType: 'interaction_learning',
    originalFileId: `case:${id}`,
    version: 'v1',
  })
  await deps.knowledgeRepository.markDocumentParsed(document.id, actorId)
  const chunks = await deps.knowledgeRepository.saveChunks(document.id, actorId, chunkText(sourceText))
  const item = await deps.knowledgeRepository.createItem(actorId, {
    type: 'case',
    title: `${facts.defect ?? '客诉'}案例沉淀｜${facts.product ?? caseNumber}`,
    content: {
      summary: `${facts.customer ?? ''}反馈 ${facts.product ?? ''} ${facts.defect ?? ''}，根因确认为${workflow.rootCause ?? '待补充'}，已实施${workflow.correctiveAction ?? '对策'}并通过验证。`,
      lessons: [
        `根因：${workflow.rootCause ?? '待补充'}`,
        `对策：${workflow.correctiveAction ?? '待补充'}（验证：${workflow.correctiveVerification ?? '待补充'}）`,
      ],
    },
    sourceDocumentId: document.id,
    sourceChunkIds: chunks.map((chunk) => chunk.id),
    owner: '质量部',
    scope: {
      ...(facts.product ? { products: [facts.product] } : {}),
      ...(facts.customer ? { customers: [facts.customer] } : {}),
    },
    visibility: 'quality_team',
    effectiveAt: new Date().toISOString(),
  })

  const now = new Date().toISOString()
  const updatedWorkflow = CaseWorkflowSchema.parse({
    ...workflow,
    knowledgeSedimentation: 'generated',
    updatedAt: now,
    updatedBy: actorId,
  })
  await deps.caseRepository.transition(record.id, actorId, {
    expectedVersion: record.version,
    expectedStatus: record.status,
    expectedInitialPackStatus: record.initialPackStatus ?? null,
    patch: { workflow: updatedWorkflow },
  })
  return { item, caseNumber }
}
