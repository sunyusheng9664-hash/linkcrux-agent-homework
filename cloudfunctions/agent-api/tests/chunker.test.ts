import { describe, expect, it } from 'vitest'

import { chunkText } from '../src/services/chunker'

describe('chunkText', () => {
  it('creates bounded chunks with a stable 120-character overlap and source offsets', () => {
    const text = Array.from({ length: 220 }, (_, index) => `段落${index.toString().padStart(3, '0')}：冻结库存并保留证据。`).join('\n')
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({ sequence: 1, charStart: 0 })
    expect(chunks[0].text.length).toBeLessThanOrEqual(800)
    expect(chunks[1].text).toContain(chunks[0].text.slice(-120))
    expect(chunks[1].charStart).toBe(chunks[0].charEnd - 120)
    expect(chunks.at(-1)?.sequence).toBe(chunks.length)
  })

  it('rejects empty text instead of creating an empty retrieval candidate', () => {
    expect(() => chunkText(' \n\t ')).toThrow('DOCUMENT_EMPTY')
  })
})
