import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

it('provides a DOM and jest-dom matchers for React component tests', () => {
  render(<p>客诉待人工确认</p>)

  expect(screen.getByText('客诉待人工确认')).toBeVisible()
})
