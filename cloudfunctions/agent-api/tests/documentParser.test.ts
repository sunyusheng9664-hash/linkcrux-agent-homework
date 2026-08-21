import { describe, expect, it } from 'vitest'

import { parseDocument } from '../src/services/documentParser'

function makeOnePagePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

describe('parseDocument', () => {
  it('extracts readable Markdown and text without treating their contents as instructions', async () => {
    await expect(parseDocument(Buffer.from('# SOP\n冻结库存并保留证据'), 'text/markdown'))
      .resolves.toContain('冻结库存')
    await expect(parseDocument(Buffer.from('客户 FAQ\n先记录批次号'), 'text/plain'))
      .resolves.toContain('记录批次号')
  })

  it('extracts text from a supported PDF', async () => {
    await expect(parseDocument(makeOnePagePdf('Freeze inventory'), 'application/pdf'))
      .resolves.toContain('Freeze inventory')
  })

  it('fails closed for empty, oversized, unsupported, or encrypted documents', async () => {
    await expect(parseDocument(Buffer.alloc(0), 'application/pdf')).rejects.toThrow('DOCUMENT_EMPTY')
    await expect(parseDocument(Buffer.alloc(2 * 1024 * 1024 + 1, 'x'), 'text/plain')).rejects.toThrow('DOCUMENT_TOO_LARGE')
    await expect(parseDocument(Buffer.from('spreadsheet'), 'application/vnd.ms-excel')).rejects.toThrow('DOCUMENT_TYPE_UNSUPPORTED')
    await expect(parseDocument(Buffer.from('%PDF-1.4\n/Encrypt 7 0 R'), 'application/pdf')).rejects.toThrow('DOCUMENT_ENCRYPTED')
  })
})
