import { createHashRouter, Navigate } from 'react-router-dom'

import { AuthGuard } from '../features/auth/AuthGuard'
import { LoginPage } from '../features/auth/LoginPage'
import { NewCasePage } from '../features/cases/NewCasePage'
import { AnalysisPage } from '../features/cases/AnalysisPage'
import { WorkbenchPage } from '../features/cases/WorkbenchPage'
import { InitialPackPage } from '../features/initial-pack/InitialPackPage'
import { KnowledgeLibraryPage } from '../features/knowledge/KnowledgeLibraryPage'
import { KnowledgeReviewPage } from '../features/knowledge/KnowledgeReviewPage'
import { CaseWorkbenchPage } from '../features/case-workbench/CaseWorkbenchPage'
import type { AgentApi } from '../services/agentApi'
import type { AttachmentUpload, AuthService } from '../services/cloudbase'

export function createAppRouter({ auth, api, uploadAttachment, offline = false }: { auth: AuthService; api: AgentApi; uploadAttachment: AttachmentUpload; offline?: boolean }) {
  const routes = [
    { path: '/login', element: <LoginPage auth={auth} onSignedIn={() => { window.location.assign('#/') }} /> },
    { path: '/', element: <AuthGuard auth={auth}><WorkbenchPage api={api} /></AuthGuard> },
    { path: '/cases/new', element: <AuthGuard auth={auth}><NewCasePage api={api} uploadAttachment={uploadAttachment} /></AuthGuard> },
    { path: '/cases/:id', element: <AuthGuard auth={auth}><CaseWorkbenchPage api={api} /></AuthGuard> },
    { path: '/cases/:id/analyze', element: <AuthGuard auth={auth}><AnalysisPage api={api} /></AuthGuard> },
    { path: '/cases/:id/initial-pack', element: <AuthGuard auth={auth}><InitialPackPage api={api} /></AuthGuard> },
    { path: '/knowledge', element: <AuthGuard auth={auth}><KnowledgeLibraryPage api={api} /></AuthGuard> },
    { path: '/knowledge/review', element: <AuthGuard auth={auth}><KnowledgeReviewPage api={api} /></AuthGuard> },
    { path: '*', element: <Navigate to="/" replace /> },
  ]
  return createHashRouter(routes)
}
