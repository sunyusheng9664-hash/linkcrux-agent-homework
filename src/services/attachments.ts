import { MAX_IMAGE_SIZE_BYTES, SAFE_IMAGE_MIME_TYPES } from '../contracts/case'

export { MAX_IMAGE_SIZE_BYTES }

const safeImageMimeTypes = new Set<string>(SAFE_IMAGE_MIME_TYPES)

export function validateImageAttachment(file: File): string | undefined {
  if (!safeImageMimeTypes.has(file.type)) return '仅支持图片文件'
  if (file.size > MAX_IMAGE_SIZE_BYTES) return '图片大小不能超过 5MB'
  return undefined
}
