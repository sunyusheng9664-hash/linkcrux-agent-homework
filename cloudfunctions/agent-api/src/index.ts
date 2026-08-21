import cloudbase from '@cloudbase/node-sdk'

import { ApiRequestSchema, ApiResponseSchema, type ApiResponse } from '../../../src/contracts/api'
import { analyzeComplaint } from './actions/analyzeComplaint'
import { generateInitialPack } from './actions/generateInitialPack'
import { ingestKnowledge } from './actions/ingestKnowledge'
import { reviewKnowledgeItem } from './actions/reviewKnowledgeItem'
import { answerKnowledge } from './actions/answerKnowledge'
import { createHandoff } from './actions/createHandoff'
import { createCloudBaseCaseAdapter, CaseRepository } from './repositories/caseRepository'
import { createCloudBaseKnowledgeAdapter, KnowledgeRepository } from './repositories/knowledgeRepository'
import { CloudBaseModelUsageAdapter, ModelUsageRepository } from './repositories/modelUsageRepository'
import { createRouter } from './router'
import { ModelClient } from './services/modelClient'
import { createCloudbaseAttachmentVerifier } from './services/attachmentVerifier'
import { resolveKnowledgeRole } from './services/knowledgeAuthorization'

/** Cloud function entrypoint. Auth identity is read from CloudBase's trusted runtime context only. */
export async function main(event: unknown): Promise<ApiResponse> {
  try {
    const request = ApiRequestSchema.parse(event)
    const app = cloudbase.init()
    const user = app.auth().getUserInfo()
    const userId = user.customUserId || user.uid
    if (!userId || user.isAnonymous) throw new Error('UNAUTHENTICATED')

    const db = app.database()
    const caseRepository = new CaseRepository(createCloudBaseCaseAdapter(db))
    const knowledgeRepository = new KnowledgeRepository(createCloudBaseKnowledgeAdapter(db))
    const router = createRouter({
      caseRepository,
      modelUsageRepository: new ModelUsageRepository(new CloudBaseModelUsageAdapter(db)),
      attachmentVerifier: createCloudbaseAttachmentVerifier(app),
      analyzeComplaint: (input) => analyzeComplaint({ createModelClient: () => new ModelClient() }, input),
      generateInitialPack: (source) => generateInitialPack({ createModelClient: () => new ModelClient() }, source),
      knowledgeRepository,
      ingestKnowledge: (input) => ingestKnowledge({ repository: knowledgeRepository, createModelClient: () => new ModelClient() }, input),
      reviewKnowledgeItem: (id, input, reviewer) => reviewKnowledgeItem({ repository: knowledgeRepository }, id, input, reviewer),
      answerKnowledge: (query, context) => answerKnowledge({ repository: knowledgeRepository, createModelClient: () => new ModelClient() }, query, context),
      createHandoff: (id, actorId, input) => createHandoff({ repository: caseRepository }, id, actorId, input),
    })
    return router.route(request, { userId, knowledgeRole: resolveKnowledgeRole(userId) })
  } catch (error) {
    return failure(error)
  }
}

function failure(error: unknown): ApiResponse {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR'
  const message = code === 'UNAUTHENTICATED' ? '请先登录后再操作' : code === 'ACTION_NOT_ALLOWED' ? '不允许的操作' : '请求处理失败'
  return ApiResponseSchema.parse({ ok: false, error: { code, message } })
}
