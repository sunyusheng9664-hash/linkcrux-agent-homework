import { MAX_IMAGE_SIZE_BYTES, complaintAttachmentPathPrefix, type Attachment } from '../../../../src/contracts/case'

export type AttachmentDownloader = { download(fileId: string): Promise<Uint8Array> }
export type AttachmentInspector = { inspect(fileId: string): Promise<{ size: number; mimeType?: string }> }
export type AttachmentVerifier = { verify(userId: string, attachments: Attachment[]): Promise<Attachment[]> }
export type AttachmentFetch = (input: string, init?: RequestInit) => Promise<{ ok: boolean; body: ReadableStream<Uint8Array> | null }>
export type CloudbaseStorageClient = {
  getFileInfo(options: { fileList: string[] }): Promise<{ fileList?: Array<{ fileID?: string; size?: number; mime?: string; contentType?: string }> }>
  getTempFileURL(options: { fileList: string[] }): Promise<{ fileList?: Array<{ fileID?: string; tempFileURL?: string }> }>
}

export function createAttachmentVerifier(deps: AttachmentInspector & AttachmentDownloader): AttachmentVerifier {
  return {
    async verify(userId, attachments) {
      const verified: Attachment[] = []
      for (const attachment of attachments) {
        verified.push(await verifyAttachment(userId, attachment, deps))
      }
      return verified
    },
  }
}

export function createCloudbaseAttachmentVerifier(app: CloudbaseStorageClient, fetcher: AttachmentFetch = globalThis.fetch as AttachmentFetch): AttachmentVerifier {
  return createAttachmentVerifier({
    async inspect(fileId) {
      try {
        const result = await app.getFileInfo({ fileList: [fileId] })
        const info = result.fileList?.find((item) => item.fileID === fileId) ?? result.fileList?.[0]
        const size = info?.size
        if (!info || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw new Error('ATTACHMENT_NOT_FOUND')
        return { size, mimeType: info.mime ?? info.contentType }
      } catch (error) {
        if (error instanceof Error && error.message === 'ATTACHMENT_NOT_FOUND') throw error
        throw new Error('ATTACHMENT_NOT_FOUND')
      }
    },
    async download(fileId) {
      try {
        const result = await app.getTempFileURL({ fileList: [fileId] })
        const url = result.fileList?.find((item) => item.fileID === fileId)?.tempFileURL ?? result.fileList?.[0]?.tempFileURL
        if (!url) throw new Error('ATTACHMENT_NOT_FOUND')
        return await downloadWithHardLimit(url, fetcher)
      } catch (error) {
        if (error instanceof Error && (error.message === 'ATTACHMENT_NOT_FOUND' || error.message === 'ATTACHMENT_TOO_LARGE')) throw error
        throw new Error('ATTACHMENT_NOT_FOUND')
      }
    },
  })
}

async function downloadWithHardLimit(url: string, fetcher: AttachmentFetch): Promise<Uint8Array> {
  const controller = new AbortController()
  const response = await fetcher(url, { signal: controller.signal })
  if (!response.ok || !response.body) throw new Error('ATTACHMENT_NOT_FOUND')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_IMAGE_SIZE_BYTES) {
        controller.abort()
        await reader.cancel()
        throw new Error('ATTACHMENT_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function verifyAttachment(userId: string, attachment: Attachment, deps: AttachmentInspector & AttachmentDownloader): Promise<Attachment> {
  const originalName = filenameForOwnedAttachment(attachment.fileId, userId)
  const info = await deps.inspect(attachment.fileId)
  if (info.size > MAX_IMAGE_SIZE_BYTES) throw new Error('ATTACHMENT_TOO_LARGE')
  if (info.size !== attachment.size) throw new Error('ATTACHMENT_SIZE_MISMATCH')
  if (!info.mimeType || info.mimeType !== attachment.mimeType) throw new Error('ATTACHMENT_MIME_MISMATCH')
  const bytes = await deps.download(attachment.fileId)
  if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) throw new Error('ATTACHMENT_TOO_LARGE')
  if (bytes.byteLength !== info.size) throw new Error('ATTACHMENT_SIZE_MISMATCH')
  const actualMimeType = detectImageMimeType(bytes)
  if (!actualMimeType || actualMimeType !== attachment.mimeType) throw new Error('ATTACHMENT_MIME_MISMATCH')
  return { fileId: attachment.fileId, mimeType: actualMimeType, size: bytes.byteLength, originalName }
}

function filenameForOwnedAttachment(fileId: string, userId: string): string {
  const objectPath = objectPathForCaseAttachment(fileId)
  const prefix = complaintAttachmentPathPrefix(userId)
  if (!objectPath.startsWith(prefix)) throw new Error('ATTACHMENT_NOT_OWNED')

  const encodedName = objectPath.slice(prefix.length)
  if (!encodedName || encodedName.includes('/')) throw new Error('ATTACHMENT_NOT_OWNED')
  let safeName: string
  try {
    safeName = decodeURIComponent(encodedName)
  } catch {
    throw new Error('ATTACHMENT_NOT_OWNED')
  }
  if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName === '.' || safeName === '..') {
    throw new Error('ATTACHMENT_NOT_OWNED')
  }
  return safeName.replace(/^[0-9a-f-]{36}-/i, '') || 'image'
}

function objectPathForCaseAttachment(fileId: string): string {
  if (!fileId.startsWith('cloud://') || /[?#]/.test(fileId)) throw new Error('ATTACHMENT_NOT_OWNED')
  const remainder = fileId.slice('cloud://'.length)
  const segments = remainder.split('/')
  const authority = segments.shift()
  if (!authority) throw new Error('ATTACHMENT_NOT_OWNED')
  return segments.join('/')
}

function detectImageMimeType(bytes: Uint8Array): Attachment['mimeType'] | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])) return 'image/webp'
  return undefined
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}
