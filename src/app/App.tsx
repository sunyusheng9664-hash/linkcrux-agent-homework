import { RouterProvider } from 'react-router-dom'

import { createAppRouter } from './router'
import { createAgentApi } from '../services/agentApi'
import { createCloudbaseAttachmentUpload, createCloudbaseAuth } from '../services/cloudbase'

export function App() {
  const auth = createCloudbaseAuth()
  const router = createAppRouter({ auth, api: createAgentApi(), uploadAttachment: createCloudbaseAttachmentUpload(undefined, auth) })
  return <RouterProvider router={router} />
}
