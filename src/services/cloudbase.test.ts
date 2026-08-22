import { describe, expect, it, vi } from 'vitest'

import { createCloudbaseAttachmentUpload, createCloudbaseAuth, type CloudbaseClient } from './cloudbase'

describe('createCloudbaseAuth', () => {
  it('uses a real session rather than deprecated login state for the route guard and current user', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'test-fixture-session-token' }, user: { id: 'quality-manager-1' } },
      error: null,
    })
    const client = {
      auth: () => ({
        signInWithPassword: vi.fn(),
        getSession,
      }),
    } as unknown as CloudbaseClient

    const auth = createCloudbaseAuth(client)

    await expect(auth.isSignedIn()).resolves.toBe(true)
    await expect(auth.getCurrentUserId()).resolves.toBe('quality-manager-1')
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('does not treat a missing session as signed in', async () => {
    const client = {
      auth: () => ({
        signInWithPassword: vi.fn(),
        getSession: vi.fn().mockResolvedValue({ data: { session: undefined, user: undefined }, error: null }),
      }),
    } as unknown as CloudbaseClient

    await expect(createCloudbaseAuth(client).isSignedIn()).resolves.toBe(false)
    await expect(createCloudbaseAuth(client).getCurrentUserId()).resolves.toBeUndefined()
  })
})

describe('createCloudbaseAttachmentUpload', () => {
  it('uploads to the authenticated user legacy cloud path and persists the returned fileID', async () => {
    const uploadFile = vi.fn().mockResolvedValue({ fileID: 'cloud://env-123/complaints/quality-manager-1/uploaded.png' })
    const client = { uploadFile } as unknown as CloudbaseClient
    const auth = { getCurrentUserId: async () => 'quality-manager-1' }
    const file = new File(['png-bytes'], '现场照片.png', { type: 'image/png' })

    const attachment = await createCloudbaseAttachmentUpload(client, auth)(file)

    expect(uploadFile).toHaveBeenCalledWith({ cloudPath: expect.stringMatching(/^complaints\/quality-manager-1\/[0-9a-f-]{36}-.*\.png$/), filePath: file })
    expect(attachment).toMatchObject({ fileId: 'cloud://env-123/complaints/quality-manager-1/uploaded.png', mimeType: 'image/png', size: file.size, originalName: file.name })
  })
})
