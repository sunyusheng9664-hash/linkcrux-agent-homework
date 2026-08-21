export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 2 * 1024 * 1024

export async function parseDocument(buffer: Buffer, mimeType: string): Promise<string> {
  if (!buffer.length) throw new Error('DOCUMENT_EMPTY')
  if (buffer.length > MAX_KNOWLEDGE_DOCUMENT_BYTES) throw new Error('DOCUMENT_TOO_LARGE')
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') return requireText(buffer)
  if (mimeType !== 'application/pdf') throw new Error('DOCUMENT_TYPE_UNSUPPORTED')
  if (/\/Encrypt\b/.test(buffer.toString('latin1'))) throw new Error('DOCUMENT_ENCRYPTED')

  try {
    installPdfTextCompatibilityGlobals()
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      return requireText(Buffer.from((await parser.getText()).text))
    } finally {
      await parser.destroy().catch(() => undefined)
    }
  } catch {
    throw new Error('DOCUMENT_PARSE_FAILED')
  }
}

function requireText(buffer: Buffer): string {
  const text = buffer.toString('utf8').replace(/\u0000/g, '').trim()
  if (!text) throw new Error('DOCUMENT_EMPTY')
  return text
}

function installPdfTextCompatibilityGlobals(): void {
  const globals = globalThis as unknown as Record<'DOMMatrix' | 'ImageData' | 'Path2D', unknown>
  globals.DOMMatrix ??= class DOMMatrix {}
  globals.ImageData ??= class ImageData {}
  globals.Path2D ??= class Path2D {}
}
