import { describe, expect, it, vi } from 'vitest'

import { MAX_IMAGE_SIZE_BYTES } from '../../../src/contracts/case'
import { createCloudbaseAttachmentVerifier } from '../src/services/attachmentVerifier'

const fileId = 'cloud://env-123/complaints/quality-manager-1/proof.png'
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const attachment = { fileId, mimeType: 'image/png' as const, size: png.byteLength, originalName: 'proof.png' }

describe('CloudBase attachment verifier', () => {
  it('fails closed on zero-byte trusted metadata without requesting a download URL or GET', async () => {
    const app = {
      getFileInfo: vi.fn().mockResolvedValue({ fileList: [{ fileID: fileId, size: 0, mime: 'image/png' }] }),
      getTempFileURL: vi.fn(),
    }
    const fetcher = vi.fn()

    await expect(createCloudbaseAttachmentVerifier(app, fetcher).verify('quality-manager-1', [attachment])).rejects.toThrow()
    expect(app.getTempFileURL).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancels the streamed GET once actual bytes exceed the hard limit despite a small file-info size', async () => {
    let cancelled = false
    const app = {
      getFileInfo: vi.fn().mockResolvedValue({ fileList: [{ fileID: fileId, size: png.byteLength, mime: 'image/png' }] }),
      getTempFileURL: vi.fn().mockResolvedValue({ fileList: [{ fileID: fileId, tempFileURL: 'https://signed.example/proof.png' }] }),
    }
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(png); controller.enqueue(new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1)) },
        cancel() { cancelled = true },
      }),
    })

    await expect(createCloudbaseAttachmentVerifier(app, fetcher).verify('quality-manager-1', [attachment])).rejects.toThrow('ATTACHMENT_TOO_LARGE')
    expect(app.getTempFileURL).toHaveBeenCalledWith({ fileList: [fileId] })
    expect(fetcher).toHaveBeenCalledWith('https://signed.example/proof.png', expect.any(Object))
    expect(cancelled).toBe(true)
  })
})
