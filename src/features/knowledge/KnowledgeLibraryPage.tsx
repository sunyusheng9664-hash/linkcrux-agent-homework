import type { AgentApi } from '../../services/agentApi'
import { Link } from 'react-router-dom'
import { KnowledgeUploadForm } from './KnowledgeUploadForm'

export function KnowledgeLibraryPage({ api }: { api: Pick<AgentApi, 'ingestKnowledge'> }) {
  return <main className="page page--wide"><header><h1>知识库管理</h1><p>先上传资料生成候选条目，再由知识负责人审核发布。未审核内容不会参与正式问答。</p><Link className="button secondary" to="/knowledge/review">进入审核队列</Link></header><KnowledgeUploadForm api={api} /></main>
}
