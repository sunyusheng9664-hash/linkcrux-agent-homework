import cloudbase from '@cloudbase/js-sdk'

import { AttachmentSchema, complaintAttachmentPathPrefix, type Attachment } from '../contracts/case'

export type AuthService = {
  signIn(username: string, password: string): Promise<void>
  isSignedIn(): Promise<boolean>
  getCurrentUserId(): Promise<string | undefined>
}

export type CloudbaseClient = {
  callFunction<T>(options: { name: string; data: unknown; parse?: boolean }): Promise<{ result: T }>
  auth(): {
    signInWithPassword(params: { username: string; password: string }): Promise<{ error: unknown | null }>
    getSession(): Promise<{ data: { session?: unknown; user?: { id?: string; uid?: string; customUserId?: string } }; error: unknown | null }>
  }
  uploadFile(options: { cloudPath: string; filePath: File }): Promise<{ fileID: string }>
}

export function createCloudbaseClient(): CloudbaseClient {
  const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID
  const accessKey = import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY
  if (!envId) throw new Error('CLOUDBASE_ENV_ID_MISSING')
  if (!accessKey) throw new Error('CLOUDBASE_PUBLISHABLE_KEY_MISSING')
  return cloudbase.init({ env: envId, accessKey, auth: { detectSessionInUrl: true } }) as unknown as CloudbaseClient
}

export function createCloudbaseAuth(client = createCloudbaseClient()): AuthService {
  return {
    async signIn(username, password) {
      const result = await client.auth().signInWithPassword({ username, password })
      if (result.error) throw result.error
    },
    async isSignedIn() {
      const result = await client.auth().getSession()
      return !result.error && Boolean(result.data.session)
    },
    async getCurrentUserId() {
      const result = await client.auth().getSession()
      if (result.error || !result.data.session) return undefined
      const user = result.data.user
      return user?.id || user?.customUserId || user?.uid
    },
  }
}

export type AttachmentUpload = (file: File) => Promise<Attachment>

export function createCloudbaseAttachmentUpload(client = createCloudbaseClient(), auth: Pick<AuthService, 'getCurrentUserId'> = createCloudbaseAuth(client)): AttachmentUpload {
  return async (file) => {
    const userId = await auth.getCurrentUserId()
    if (!userId) throw new Error('ATTACHMENT_USER_MISSING')
    const objectName = `${crypto.randomUUID()}-${safeFileName(file.name)}`
    const result = await client.uploadFile({ cloudPath: `${complaintAttachmentPathPrefix(userId)}${objectName}`, filePath: file })
    if (!result.fileID) throw new Error('ATTACHMENT_UPLOAD_FAILED')
    return AttachmentSchema.parse({ fileId: result.fileID, mimeType: file.type, size: file.size, originalName: file.name })
  }
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'image'
}
