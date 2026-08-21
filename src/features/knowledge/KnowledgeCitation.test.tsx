import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KnowledgeCitation } from './KnowledgeCitation'

describe('KnowledgeCitation', () => {
  it('shows a human-readable source, version and source section', () => {
    render(<KnowledgeCitation documentName="来料异常 SOP" version="v2" chunks={[{ sequence: 3, text: '先冻结疑似库存。' }]} />)
    expect(screen.getByText('来料异常 SOP v2 · 第 3 节')).toBeVisible()
    expect(screen.getByText('先冻结疑似库存。')).toBeVisible()
  })
})
